"""Deterministic project analysis: decisions, tasks, owners, deadlines, risks, requirements, conflicts, duplicates.

Rules, not a model. Every item keeps the exact line it came from, so the Reviewer can check it. What the rules cannot
establish is reported as unknown instead of guessed. Lines flagged as text addressed to an AI are never turned into
items. Heuristics are tuned for Markdown/plain-text project notes; other layouts yield fewer items, not wrong ones.
"""
import re
from dataclasses import dataclass, field

from app.nas.evidence import injection_warnings

ISO = re.compile(r"\b(20\d\d-[01]\d-[0-3]\d)\b")
SECTIONS = {"decision": "decision", "decisions": "decision", "task": "task", "tasks": "task", "action items": "task",
            "todo": "task", "to do": "task", "risk": "risk", "risks": "risk", "requirement": "requirement",
            "requirements": "requirement", "open questions": "question"}
_ID = re.compile(r"^\s*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?(?:[A-Z]{1,3}\d{1,3}\s*:\s*)?")
_OWNER = re.compile(r"^(?P<owner>[A-Z][\w'.-]+(?: [A-Z][\w'.-]+){0,3})\s+[—–-]\s+(?P<rest>.+)$")
_NO_OWNER = re.compile(r"\((?:no owner|owner (?:not )?(?:assigned|tbd|unknown))[^)]*\)", re.I)
_DUE = re.compile(r"\b(?:by|due|before|until)\s+(20\d\d-[01]\d-[0-3]\d)", re.I)
_DONE = re.compile(r"^\s*[-*+]\s*\[[xX]\]|\b(done|completed|finished)\b", re.I)
_TOPIC = re.compile(r"^(?:the\s+)?(?P<topic>[a-z][a-z0-9 \-]{2,40}?)\s+(?P<verb>is|are|will be|changes to|moves to|"
                    r"becomes|is now|stays)\s+(?P<value>.+?)(?:\.|$)", re.I)
_CHANGE = re.compile(r"\b(changes to|moves to|replaces|instead of|no longer|is now)\b", re.I)
_REQ = re.compile(r"^\s*Requirement\s+(?P<id>[A-Z]{1,3}\d{1,3})\s*:", re.I)


def _plain(s: str) -> str:
    return re.sub(r"[*_`]", "", s).strip()


def _key(s: str) -> str:
    return re.sub(r"\s+", " ", _plain(s).lower()).strip(" .")


@dataclass
class Item:
    category: str
    text: str  # cleaned statement
    path: str
    line: int
    quote: str  # exact line from the file
    doc_date: str | None
    fields: dict = field(default_factory=dict)

    def source(self) -> dict:
        return {"path": self.path, "line": self.line, "quote": self.quote, "doc_date": self.doc_date}


def document_date(path: str, text: str) -> tuple[str | None, str]:
    m = ISO.search(path.rsplit("/", 1)[-1]) or ISO.search(path)
    if m:
        return m.group(1), "file name"
    head = next((ln for ln in text.splitlines() if ln.strip()), "")
    m = ISO.search(head)
    return (m.group(1), "first line") if m else (None, "not stated")


def extract(path: str, text: str) -> list[Item]:
    flagged = {w["line"] for w in injection_warnings(path, text)}
    date, _ = document_date(path, text)
    section, items, in_comment = None, [], False
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if "<!--" in line:
            in_comment = "-->" not in line
            continue
        if in_comment:
            in_comment = "-->" not in line
            continue
        if n in flagged or not line.strip():
            continue
        h = re.match(r"^#{1,6}\s+(.*)$", line)
        if h:
            section = SECTIONS.get(_plain(h.group(1)).lower().strip(": "))
            continue
        body = _plain(_ID.sub("", line, count=1))
        if _REQ.match(line):
            items.append(Item("requirement", body, path, n, line.strip(), date, {"id": _REQ.match(line).group("id")}))
            continue
        if section is None or not re.match(r"^\s*(?:[-*+]|\d+[.)])\s", line):
            continue
        it = Item(section, body, path, n, line.strip(), date)
        if section == "task":
            om = _OWNER.match(body)
            it.fields["owner"] = None if _NO_OWNER.search(body) or not om else om.group("owner")
            dm = _DUE.search(body)
            it.fields["due"] = dm.group(1) if dm else None
            it.fields["done"] = bool(_DONE.search(line))
        elif section == "decision":
            tm = _TOPIC.match(body)
            if tm:
                it.fields["topic"] = _key(tm.group("topic"))
                it.fields["value"] = _plain(tm.group("value")).split(" because ")[0].strip()
            it.fields["states_change"] = bool(_CHANGE.search(body))
        items.append(it)
    return items


def conflicts(items: list[Item]) -> list[dict]:
    """Decisions on the same topic with different values. Ordered by document date; the latest is 'current' only
    when it has a later date than every other statement (otherwise the conflict stays unresolved)."""
    by_topic: dict[str, list[Item]] = {}
    for it in items:
        if it.category == "decision" and it.fields.get("topic"):
            by_topic.setdefault(it.fields["topic"], []).append(it)
    out = []
    for topic, group in sorted(by_topic.items()):
        if len({_key(i.fields["value"]) for i in group}) < 2:
            continue
        dated = sorted(group, key=lambda i: (i.doc_date or "", i.path, i.line))
        last = dated[-1]
        resolved = last.doc_date is not None and all(i.doc_date and i.doc_date < last.doc_date for i in dated[:-1])
        out.append({"topic": topic, "statements": [{"value": i.fields["value"], **i.source()} for i in dated],
                    "current": ({"value": last.fields["value"], **last.source()} if resolved else None),
                    "basis": ("later document date" + ("; the later line states the change" if last.fields["states_change"] else "")
                              if resolved else "documents are undated or share a date: unresolved")})
    return out


def duplicates(items: list[Item]) -> list[dict]:
    seen: dict[str, list[Item]] = {}
    for it in items:
        if len(it.text) >= 20:
            seen.setdefault(_key(it.text), []).append(it)
    return [{"text": g[0].text, "sources": [i.source() for i in g]}
            for g in seen.values() if len({i.path for i in g}) > 1]
