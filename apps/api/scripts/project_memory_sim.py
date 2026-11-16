"""Run the NAS Project Memory workflow on a local folder and print the answer. SIMULATION: no UGREEN NAS is used.

    cd apps/api
    python scripts/project_memory_sim.py                                  # the Apollo fixture, Round 2 question
    python scripts/project_memory_sim.py --folder PATH --question "What are the risks?" [--json]

Read-only. The folder given here is the only one read; nothing is written, sent or executed.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.nas.workflow import run_local  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[3] / "hackathons" / "ugreen-2026" / "tests" / "fixtures" / "apollo-project"
QUESTION = ("Analyze this project and tell me the current development status, completed decisions, pending tasks, "
            "responsible people, deadlines, risks, and contradictions between documents.")


def src(c: dict) -> str:
    return "; ".join(f"{s['path']}:{s['line']}" for s in c["sources"])


def render(r: dict) -> str:
    out = [f"# Project Memory — {r['mode']} (local folder, not a UGREEN NAS)", "", f"Question: {r['question']}", "",
           f"Documents read: {len(r['documents'])}" + (f"; not readable: {len(r['unreadable'])}" if r["unreadable"] else ""), ""]
    out += ["## Confirmed (quoted)"] + [f"- {c['text']}  [{src(c)}]" for c in r["confirmed"]] + [""]
    out += ["## Inferences"] + [f"- {c['text']}  basis: {c['basis']}  [{src(c)}]" for c in r["inferences"]] + [""]
    out += ["## Unknown"] + [f"- {c['text']}" for c in r["unknowns"]] + [""]
    out += ["## Conflicts and superseded statements"]
    for c in r["conflicts"]:
        vals = " -> ".join(f"{s['value']} ({s['path']}:{s['line']}, {s['doc_date'] or 'undated'})" for s in c["statements"])
        out.append(f"- {c['topic']}: {vals}. Current: {c['current']['value'] if c['current'] else 'unresolved'} ({c['basis']})")
    out += ["", "## Duplicates"] + [f"- {d['text']}  [{'; '.join(s['path'] + ':' + str(s['line']) for s in d['sources'])}]"
                                   for d in r["duplicates"]]
    out += ["", "## Warnings (document text treated as data)"] + [f"- {w['path']}:{w['line']} {w['reason']}" for w in r["warnings"]]
    out += ["", f"Reviewer: {r['review']['checked']} claims checked, {len(r['review']['rejected'])} rejected.",
            "Timing: " + ", ".join(f"{t['agent']} {t['ms']} ms" for t in r["trace"]) + f"; total {r['total_ms']} ms"]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--folder", default=str(FIXTURE))
    ap.add_argument("--question", default=QUESTION)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    r = run_local(a.folder, a.question)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(r, indent=2, ensure_ascii=False) if a.json else render(r))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
