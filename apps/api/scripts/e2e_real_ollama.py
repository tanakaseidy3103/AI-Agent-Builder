"""End-to-end check with a REAL local model: Ollama + the real pipeline + the real Docker sandbox. No mocks.

    .venv/Scripts/python.exe -u scripts/e2e_real_ollama.py [--model qwen2.5-coder:latest] [--only csv|files]

For each scenario it generates a Skill exactly as the Studio does (spec → cases → code → tests → static checks →
sandbox tests → eval cases → repair loop), then runs an INDEPENDENT ORACLE: hand-written inputs whose correct answers
are known, executed on the generated code in the sandbox. The oracle is how false positives are caught: a Skill whose
own (model-written) tests and evals pass but which gives wrong answers is reported as such.

The oracle has to map its inputs onto whatever input_schema the model chose. When the schema does not have the expected
shape (e.g. no string property for the CSV text) the oracle is reported as "not applicable", never as passed.

Throwaway SQLite DB + storage under test-results/e2e-real/<stamp>/ (Studio data untouched). Results are written to
docs/evidence/e2e-real-ollama-<stamp>.json and .md.
"""
import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
ROOT = Path(__file__).resolve().parents[3]
STAMP = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
WORK = ROOT / "test-results" / "e2e-real" / STAMP
WORK.mkdir(parents=True, exist_ok=True)

import os  # noqa: E402

os.environ["DATABASE_URL"] = f"sqlite:///{(WORK / 'db.sqlite').as_posix()}"  # forced: never the Studio DB
os.environ["STORAGE_DIR"] = str(WORK / "storage")  # forced: never the Studio data

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402, F401  (registers tables)
from app.config import settings  # noqa: E402
from app.db import Base  # noqa: E402
from app.llm import OllamaProvider  # noqa: E402
from app.models import GenerationJob, SkillVersion, ValidationRun  # noqa: E402
from app.skills import sandbox, storage  # noqa: E402
from app.skills.pipeline import run_generation  # noqa: E402

CSV_PROMPT = ("Create a Skill that validates the header row of a CSV file. Input: the CSV text and the list of required "
              "header names. Output: a structured report with the missing required headers, the headers found, and "
              "whether the file is valid (valid only when no required header is missing). An empty CSV text or a CSV "
              "without a header row must be reported as invalid with every required header missing, never crash.")
FILES_PROMPT = ("Create a Skill that finds TODO and FIXME comments in source files. Input: the project's files as "
                "data['files'] mapping path -> file text. Output: a list of findings with file, line (1-based) and "
                "the marker (TODO or FIXME), plus the total count.")


# ---------------- oracles: hand-written inputs with known answers ----------------

def _props(schema: dict) -> dict:
    return schema.get("properties", {}) if isinstance(schema, dict) else {}


def _strings(x, depth=0):
    """Every list of strings / string anywhere in the output (the model names the fields)."""
    if depth > 4:
        return
    if isinstance(x, dict):
        for k, v in x.items():
            yield from ((k + "." + kk, vv) for kk, vv in _strings(v, depth + 1))
            if isinstance(v, list) and all(isinstance(i, str) for i in v):
                yield k, v
    elif isinstance(x, list):
        for i in x:
            yield from _strings(i, depth + 1)


def csv_oracle(manifest: dict):
    props = _props(manifest.get("input_schema", {}))
    text_key = next((k for k, p in props.items() if p.get("type") == "string"), None)
    list_key = next((k for k, p in props.items() if p.get("type") == "array"), None)
    if not text_key or not list_key:
        return None, f"input_schema has no string property for the CSV and array for the headers: {sorted(props)}"
    required = ["id", "name", "email"]
    cases = [  # (name, csv text, expected missing set)
        ("all present", "id,name,email,age\n1,Ann,a@x.io,30\n", set()),
        ("one missing", "id,name,age\n1,Ann,30\n", {"email"}),
        ("all missing", "a,b\n1,2\n", {"id", "name", "email"}),
        ("empty csv", "", {"id", "name", "email"}),
        ("quoted header", '"id","name","email"\n1,Ann,a@x.io\n', set()),
        ("header only", "id,name,email\n", set()),  # a header row with no data rows still has every header
        ("spaces trimmed?", "id, name ,email\n1,Ann,a@x.io\n", None),  # whitespace policy is spec-dependent: recorded, not judged
    ]
    inputs = [{"name": n, "input": {text_key: t, list_key: required}} for n, t, _ in cases]

    def judge(name, out):
        exp = next(e for n, _, e in cases if n == name)
        if exp is None:
            return None, "not judged (spec-dependent)"
        if not isinstance(out, dict):
            return False, f"no dict output: {out!r}"
        lists = [(k, v) for k, v in _strings(out) if "miss" in k.lower()]
        if not lists:
            return False, f"no 'missing' list in output keys {sorted(out)}"
        key, got = lists[0]
        return set(got) == exp, f"{key}={sorted(got)} expected {sorted(exp)}"
    return inputs, judge


def files_oracle(manifest: dict):
    props = _props(manifest.get("input_schema", {}))
    if "files" not in props:
        return None, f"input_schema has no 'files' property: {sorted(props)}"
    src_py = "x = 1\n# TODO: refactor this\ny = 2  # FIXME broken\n"
    src_js = "// nothing here\nconst a = 1;\n// TODO later\n"
    cases = [
        ("two files", {"a.py": src_py, "b.js": src_js}, {("a.py", 2), ("a.py", 3), ("b.js", 3)}),
        ("none", {"c.py": "print('TODOS are fine in strings? no: not a comment')\n"}, None),  # spec-dependent
        ("empty", {}, set()),
        ("clean", {"d.py": "z = 3\n"}, set()),
    ]
    inputs = [{"name": n, "input": {"files": f}} for n, f, _ in cases]

    def judge(name, out):
        exp = next(e for n, _, e in cases if n == name)
        if exp is None:
            return None, "not judged (spec-dependent)"
        if not isinstance(out, dict):
            return False, f"no dict output: {out!r}"
        found = set()
        for v in out.values():
            if isinstance(v, list):
                for f in v:
                    if isinstance(f, dict) and "line" in f:
                        found.add((f.get("file") or f.get("path"), f.get("line")))
        return found == exp, f"found {sorted(found, key=str)} expected {sorted(exp)}"
    return inputs, judge


SCENARIOS = {"csv": (CSV_PROMPT, csv_oracle), "files": (FILES_PROMPT, files_oracle)}


def run_oracle(files: dict, manifest: dict, oracle) -> dict:
    inputs, judge = oracle(manifest)
    if inputs is None:
        return {"status": "not_applicable", "reason": judge}
    entry = manifest.get("execution", {}).get("entrypoint", "scripts/main.py")
    try:
        r = sandbox.run_evals(files, entry, inputs, 10, 256)
    except sandbox.SandboxUnavailable as e:
        return {"status": "not_run", "reason": str(e)}
    if not r.ok or r.data.get("load_error"):
        return {"status": "fail", "reason": r.error or r.data.get("load_error")}
    rows = []
    for rec in r.data["cases"]:
        out = rec["outputs"][0] if rec["outputs"] else None
        ok, why = (False, f"raised {rec['error']}") if rec["error"] else judge(rec["name"], out)
        rows.append({"case": rec["name"], "passed": ok, "detail": why, "output": out})
    judged = [x for x in rows if x["passed"] is not None]
    return {"status": "pass" if judged and all(x["passed"] for x in judged) else "fail",
            "passed": sum(1 for x in judged if x["passed"]), "judged": len(judged), "cases": rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=settings.llm_model)
    ap.add_argument("--only", choices=sorted(SCENARIOS))
    ap.add_argument("--attempts", type=int, default=1)
    args = ap.parse_args()

    engine = create_engine(os.environ["DATABASE_URL"])
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    # one provider per run: OllamaProvider accumulates per-call usage, so a shared one would add earlier runs to later ones
    out_json = ROOT / "docs" / "evidence" / f"e2e-real-ollama-{STAMP}.json"
    rows = []
    for key in [args.only] if args.only else list(SCENARIOS):
        prompt, oracle = SCENARIOS[key]
        for attempt in range(1, args.attempts + 1):
            with factory() as s:
                job = GenerationJob(prompt=prompt, requested_kind="code")
                s.add(job)
                s.commit()
                jid = job.id
            t0 = time.monotonic()
            print(f"[{key} #{attempt}] generating with {args.model} …", flush=True)
            run_generation(jid, factory, OllamaProvider(settings.ollama_base_url, args.model))
            secs = round(time.monotonic() - t0, 1)
            with factory() as s:
                job = s.get(GenerationJob, jid)
                row = {"scenario": key, "attempt": attempt, "model": args.model, "seconds": secs, "job_status": job.status,
                       "job_error": job.error, "stages": job.stages}
                if job.skill_version_id:
                    v = s.get(SkillVersion, job.skill_version_id)
                    rep = s.query(ValidationRun).filter_by(skill_version_id=v.id).one().report
                    files = storage.read_package(v.storage_key)
                    sm = rep["summary"]
                    row |= {"skill": f"{v.manifest['id']}@{v.version}", "status": v.status,
                            "tests": f"{sm['tests_passed']}/{sm['tests_total']}", "evals": f"{sm['evals_passed']}/{sm['evals_total']}",
                            "sandbox": rep["sandbox"], "failure_category": rep.get("failure_category"),
                            "repair_rounds": rep.get("repair_rounds"), "tests_rewritten_in_repair": rep.get("tests_rewritten_in_repair"),
                            "repair_history": rep.get("repair_history"),
                            "failing_static": [f"{c['id']}: {c['message']}" for c in rep["static"]["checks"] if c["status"] == "fail"],
                            "failing_tests": [f"{t['name']}: {t['status']}: {t['detail'][-300:]}" for t in rep["tests"] if t["status"] != "pass"],
                            "failing_evals": [f"{e['name']}: {'; '.join(e['reasons'])}" for e in rep["evals"] if e["status"] != "pass"],
                            "llm": rep.get("llm"), "input_schema": v.manifest.get("input_schema"),
                            "output_schema": v.manifest.get("output_schema"), "files": files}
                    print(f"  → {row['skill']} status={v.status} tests {row['tests']} evals {row['evals']} "
                          f"repairs={row['repair_rounds']} in {secs}s; running the independent oracle…", flush=True)
                    row["oracle"] = run_oracle(files, v.manifest, oracle)
                    o = row["oracle"]
                    print(f"  → oracle: {o['status']}" + (f" {o.get('passed')}/{o.get('judged')}" if "judged" in o else f" ({o.get('reason')})"), flush=True)
                else:
                    print(f"  → job {job.status}: {job.error}", flush=True)
            rows.append(row)
            out_json.write_text(json.dumps({"stamp": STAMP, "model": args.model, "ollama": settings.ollama_base_url,
                                            "sandbox_image": settings.sandbox_image, "rows": rows}, indent=1, ensure_ascii=False, default=str),
                                encoding="utf-8")
    print(f"results: {out_json}")


if __name__ == "__main__":
    main()
