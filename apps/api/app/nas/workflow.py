"""Project Memory workflow: Planner -> Researcher -> Analyst -> Reviewer, over an expert adapter.

The smallest set of roles the use case needs, all deterministic. No model call is made, so results are reproducible
and the Reviewer's check is exact. Each role is timed; the trace is part of the answer.
The workflow never chooses a folder: it only sees what the adapter it was given can read.
"""
import time

from app.nas.adapters import LocalSimulationAdapter, Result
from app.nas.analysis import Item, conflicts, document_date, duplicates, extract
from app.nas.citations import review
from app.nas.evidence import injection_warnings
from app.nas.scope import AuthorizedFolder

INTENTS = {
    "decisions": ("decision", "decided", "decide", "chose", "choose", "agreed"),
    "tasks": ("task", "todo", "pending", "open", "action", "work", "next"),
    "owners": ("who", "owner", "responsible", "people", "assigned"),
    "deadlines": ("deadline", "due", "date", "when", "launch", "schedule"),
    "risks": ("risk", "blocker", "issue", "problem"),
    "requirements": ("requirement", "must", "scope"),
    "conflicts": ("conflict", "contradict", "changed", "outdated", "inconsistent", "replace"),
    "status": ("status", "progress", "state", "overview", "analyze", "summary"),
}
MAX_DOCUMENTS = 200


def plan(question: str) -> list[str]:
    q = question.lower()
    hit = [k for k, words in INTENTS.items() if any(w in q for w in words)]
    return list(INTENTS) if not hit or "status" in hit else hit


def _claim(kind: str, text: str, items: list[Item] | None = None, **extra) -> dict:
    c = {"kind": kind, "text": text, "sources": [i.source() for i in (items or [])]}
    c.update(extra)
    return c


def _ok(r: Result, what: str) -> object:
    if r.state != "completed":
        raise WorkflowStopped(what, r)
    return r.data


def _merge_duplicates(claims: list[dict]) -> list[dict]:
    """The same confirmed statement in several files becomes one claim with all its sources."""
    out, index = [], {}
    for c in claims:
        k = (c["kind"], c.get("category"), " ".join(c["text"].lower().split())) if c["kind"] == "confirmed" else None
        if k is not None and k in index:
            out[index[k]]["sources"].extend(c["sources"])
            continue
        if k is not None:
            index[k] = len(out)
        out.append(c)
    return out


class WorkflowStopped(RuntimeError):
    def __init__(self, step: str, result: Result):
        super().__init__(f"{step}: {result.state}")
        self.step, self.result = step, result


def run(adapter: LocalSimulationAdapter, question: str) -> dict:
    trace, t0 = [], time.perf_counter()

    def mark(agent: str, start: float, **info):
        trace.append({"agent": agent, "ms": round((time.perf_counter() - start) * 1000, 2), **info})

    s = time.perf_counter()
    intents = plan(question)
    mark("planner", s, intents=intents)

    # Researcher: discovery, then reading, through documented read actions only.
    s = time.perf_counter()
    found = _ok(adapter.invoke("ug-filesystem", "find", {"path": "", "type": "documents"}), "discover documents")
    docs, unreadable, partial = {}, [], len(found) > MAX_DOCUMENTS
    for e in found[:MAX_DOCUMENTS]:
        r = adapter.invoke("ug-filesystem", "cat", {"path": e["path"]})
        if r.state == "completed":
            docs[e["path"]] = r.data
        else:
            unreadable.append({"path": e["path"], "reason": (r.error or {}).get("message", r.state)})
    mark("researcher", s, calls=1 + min(len(found), MAX_DOCUMENTS), found=len(found), read=len(docs))

    # Analyst
    s = time.perf_counter()
    warnings = [w for p, t in docs.items() for w in injection_warnings(p, t)]
    items = [it for p, t in docs.items() for it in extract(p, t)]
    dates = {p: dict(zip(("date", "from"), document_date(p, t))) for p, t in docs.items()}
    conf, dup = conflicts(items), duplicates(items)
    claims: list[dict] = []
    want = set(intents)
    superseded = {(st["path"], st["line"]) for c in conf if c["current"] for st in c["statements"]
                  if (st["path"], st["line"]) != (c["current"]["path"], c["current"]["line"])}
    for it in items:
        cat = it.category
        if cat == "decision" and want & {"decisions", "status", "conflicts"}:
            tag = " (superseded)" if (it.path, it.line) in superseded else ""
            claims.append(_claim("confirmed", f"Decision{tag}: {it.text}", [it], category="decision",
                                 superseded=bool(tag)))
        elif cat == "task" and want & {"tasks", "owners", "deadlines", "status"}:
            f = it.fields
            claims.append(_claim("confirmed", f"Task: {it.text}", [it], category="task", owner=f["owner"],
                                 due=f["due"], done=f["done"]))
            if f["owner"] is None:
                claims.append(_claim("unknown", f"Owner of '{it.text}': not stated in the documents read.",
                                     category="owner"))
            if f["due"] is None:
                claims.append(_claim("unknown", f"Deadline of '{it.text}': not stated in the documents read.",
                                     category="deadline"))
        elif cat == "risk" and want & {"risks", "status"}:
            claims.append(_claim("confirmed", f"Risk: {it.text}", [it], category="risk"))
        elif cat == "requirement" and want & {"requirements", "status"}:
            claims.append(_claim("confirmed", it.text, [it], category="requirement"))
    for c in conf:
        if c["current"]:
            cur = c["current"]
            claims.append({"kind": "inference", "category": "current", "basis": c["basis"],
                           "text": f"Current {c['topic']}: {cur['value']} (stated {cur['doc_date']}).",
                           "sources": [{k: cur[k] for k in ("path", "line", "quote", "doc_date")}]})
    if want & {"status", "tasks"} and items:
        claims.append(_claim("unknown", "Completion of tasks: no document marks a task as done." if
                             not any(i.fields.get("done") for i in items if i.category == "task") else
                             "Completion of the remaining tasks: not stated.", category="status"))
    claims = _merge_duplicates(claims)
    mark("analyst", s, items=len(items), claims=len(claims))

    # Reviewer: every quote must exist in an in-scope file; failing claims are removed, never softened.
    s = time.perf_counter()
    issues = review({"claims": claims}, adapter.folder)
    bad = {i.claim for i in issues}
    kept = [c for n, c in enumerate(claims) if n not in bad]
    mark("reviewer", s, checked=len(claims), rejected=len(bad))

    return {
        "mode": adapter.mode,
        "question": question,
        "intents": intents,
        "documents": [{"path": p, **dates[p]} for p in sorted(docs)],
        "unreadable": unreadable,
        "partial": partial,
        "confirmed": [c for c in kept if c["kind"] == "confirmed"],
        "inferences": [c for c in kept if c["kind"] == "inference"],
        "unknowns": [c for c in kept if c["kind"] == "unknown"],
        "conflicts": conf if want & {"conflicts", "decisions", "status", "deadlines"} else [],
        "duplicates": dup,
        "warnings": warnings,
        "review": {"checked": len(claims), "rejected": [i.__dict__ for i in issues]},
        "trace": trace,
        "total_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def run_local(root: str, question: str) -> dict:
    return run(LocalSimulationAdapter(AuthorizedFolder(root)), question)
