"""Reproducible generation benchmark: real Ollama models + real Docker sandbox.

    .venv/Scripts/python.exe -u scripts/benchmark_generation.py --models llama3.2:3b qwen2.5-coder:latest --attempts 3

Each row is one full pipeline run (spec → code → tests → repair loop → sandbox → evals) with kind=code forced.
Uses a throwaway SQLite DB + storage dir (Studio data untouched). Results are appended to
docs/benchmarks/<stamp>.json after every run (a crash keeps finished rows) and summarized in <stamp>.md.
These are GENERATED Skills; the human-written reference Skills are evaluated separately.
"""
import argparse
import hashlib
import json
import math
import platform
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import Base  # noqa: E402
from app.llm import OllamaProvider  # noqa: E402
from app.skills import storage  # noqa: E402
from app.skills.pipeline import run_generation  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "benchmarks"
TASKS = [
    ("easy", "project-docs", "Create a Skill that generates a README draft from a project's files: count source files per "
     "language by extension, list the npm scripts from package.json, and list folders that contain tests."),
    ("medium", "python-analyzer", "Create a Skill that analyzes Python source files and reports bare except clauses, mutable "
     "default arguments and unused imports, each with file, line and rule name."),
    ("medium", "api-test-plan", "Create a Skill that takes an OpenAPI 3 JSON document and produces an API test plan: one "
     "happy-path test per operation with its expected 2xx status, plus a 404 test for every path with parameters."),
    ("hard", "react-a11y", "Create a Skill that finds accessibility problems in React JSX/TSX files: img without alt, clickable "
     "div or span without role or keyboard handler, and anchors without href. Report file, line and rule."),
    ("hard", "laravel-bugs", "Create a Skill that detects Laravel bugs in PHP and Blade files: SQL built from variables in "
     "DB::select or whereRaw, protected $guarded = [], env() outside config/, leftover dd(), and POST forms without @csrf."),
]
LLM_STAGES = {"analyze", "generate_files", "test_generation"}
VALIDATION_STAGES = {"static_validation", "sandbox_tests", "evaluate"}


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def attempt_seed(attempt_index: int) -> int:
    return settings.llm_seed + attempt_index


def _cmd(args: list[str]) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return "unavailable"


def meta(models_: list[str], attempts: int) -> dict:
    base = settings.ollama_base_url
    digests = {}
    for m in models_:
        try:
            info = httpx.post(f"{base}/api/show", json={"model": m}, timeout=30).json()
            tags = {t["name"]: t["digest"] for t in httpx.get(f"{base}/api/tags", timeout=30).json()["models"]}
            digests[m] = {"digest": tags.get(m), "parameter_size": info.get("details", {}).get("parameter_size"),
                          "quantization": info.get("details", {}).get("quantization_level")}
        except (httpx.HTTPError, KeyError, ValueError) as e:
            digests[m] = {"error": str(e)}
    return {
        "started_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "git_commit": _cmd(["git", "-C", str(ROOT), "rev-parse", "HEAD"]),
        "ollama_version": httpx.get(f"{base}/api/version", timeout=10).json().get("version"),
        "models": digests,
        "options": {**OllamaProvider(base, "x").options, "seed": f"{settings.llm_seed} + attempt index (0-based)"},
        "llm_timeout_s": settings.llm_timeout_s,
        "max_repair_rounds": settings.max_repair_rounds,
        "sandbox_image": settings.sandbox_image,
        "sandbox_image_id": _cmd(["docker", "image", "inspect", "--format", "{{.Id}}", settings.sandbox_image]),
        "gpu": _cmd(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"]),
        "host": f"{platform.system()} {platform.release()} / {platform.processor()}",
        "attempts_per_task": attempts,
        "kind": "code (forced)",
        "tasks": [{"difficulty": d, "id": i, "prompt": p} for d, i, p in TASKS],
    }


def first_failure(job, run) -> str:
    if job.status == "failed":
        return "llm: " + (job.error or "")[:120]
    if run is None:
        return "no report"
    for c in run.report["static"]["checks"]:
        if c["status"] == "fail":
            return c["id"]
    for c in run.report["criteria"]:
        if not c["passed"]:
            return c["id"]
    return ""


def one(factory, provider, difficulty, task_id, prompt) -> dict:
    with factory() as s:
        job = models.GenerationJob(prompt=prompt, requested_kind="code")
        s.add(job)
        s.commit()
        jid = job.id
    t0 = time.monotonic()
    run_generation(jid, factory, provider)
    secs = round(time.monotonic() - t0, 1)
    with factory() as s:
        job = s.get(models.GenerationJob, jid)
        v = s.get(models.SkillVersion, job.skill_version_id) if job.skill_version_id else None
        run = s.query(models.ValidationRun).filter_by(skill_version_id=v.id).first() if v else None
        stage_ms = {}
        for st in job.stages:
            stage_ms[st["name"]] = stage_ms.get(st["name"], 0) + (st.get("duration_ms") or 0)
        return {
            "model": provider.name, "difficulty": difficulty, "task": task_id, "seconds_total": secs,
            "seconds_llm_stages": round(sum(v_ for k, v_ in stage_ms.items() if k in LLM_STAGES) / 1000, 1),
            "seconds_validation_last_round": round(sum(v_ for k, v_ in stage_ms.items() if k in VALIDATION_STAGES) / 1000, 1),
            "job_status": job.status, "status": v.status if v else None,
            "first_failure": first_failure(job, run),
            "repair_rounds": run.report.get("repair_rounds") if run else None,
            "tests_rewritten_in_repair": run.report.get("tests_rewritten_in_repair") if run else None,
            "tests": f"{run.tests_passed}/{run.tests_total}" if run else None,
            "evals": f"{run.evals_passed}/{run.evals_total}" if run else None,
            "eval_failures": [e["reasons"] for e in run.report.get("evals", []) if e["status"] != "pass"][:3] if run else None,
            "criteria": run.report["criteria"] if run else None,
            "code_sha": _code_sha(v),
        }


def _code_sha(v) -> str | None:
    if v is None:
        return None
    files = storage.read_package(v.storage_key)
    src = files.get("scripts/main.py", "") + "\0" + files.get("tests/test_main.py", "")
    return hashlib.sha256(src.encode()).hexdigest()[:16]


def independent(rows: list[dict]) -> list[dict]:
    """One row per distinct (model, task, generated code). Identical outputs are one observation, not several."""
    seen, out = set(), []
    for r in rows:
        key = (r["model"], r["task"], r.get("code_sha") or f"no-package:{r.get('error') or r.get('first_failure')}")
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def write(stamp: str, m: dict, rows: list[dict], models_: list[str]) -> None:
    (OUT / f"{stamp}.json").write_text(json.dumps({"meta": m, "runs": rows}, indent=2, ensure_ascii=False), encoding="utf-8")
    L = [f"# Generation benchmark {stamp}", "",
         f"Real Ollama {m['ollama_version']} + Docker sandbox · commit `{m['git_commit'][:7]}` · kind=code forced · "
         f"{m['attempts_per_task']} attempts × {len(TASKS)} tasks per model · options `{json.dumps(m['options'])}` · "
         f"max repair rounds {m['max_repair_rounds']} · GPU {m['gpu']}", "",
         "Generated Skills only. Reference (human-written) Skills are not part of these numbers.", "",
         "Rates use independent samples only: runs that produced byte-identical code+tests for the same task count once.", "",
         "| Model | Runs | Independent samples | verified | validated | validation_failed | job failed | verified rate (95% Wilson CI, independent n) | median s |",
         "|---|---|---|---|---|---|---|---|---|"]
    for model in models_:
        rs = [r for r in rows if r["model"] == f"ollama:{model}"]
        if not rs:
            continue
        ind = independent(rs)
        k = sum(r["status"] == "verified" for r in ind)
        lo, hi = wilson(k, len(ind))
        secs = sorted(r["seconds_total"] for r in rs)
        cnt = lambda st: sum(r["status"] == st for r in rs)  # noqa: E731
        L.append(f"| {model} | {len(rs)} | {len(ind)} | {sum(r['status'] == 'verified' for r in rs)} | {cnt('validated')} | "
                 f"{cnt('validation_failed')} | {sum(r['job_status'] == 'failed' for r in rs)} | "
                 f"{k}/{len(ind)} ({lo:.2f}–{hi:.2f}) | {secs[len(secs) // 2]} |")
    L += ["", "## By task", "", "| Model | Difficulty | Task | verified / runs |", "|---|---|---|---|"]
    for model in models_:
        for d, tid, _ in TASKS:
            rs = [r for r in rows if r["model"] == f"ollama:{model}" and r["task"] == tid]
            if rs:
                L.append(f"| {model} | {d} | {tid} | {sum(r['status'] == 'verified' for r in rs)}/{len(rs)} |")
    L += ["", "## Every run", "", "| Model | Task | Status | First failure | Repairs | Tests | Evals | LLM s | Validation s | Total s |",
          "|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        L.append(f"| {r['model']} | {r['task']} | {r['status'] or r['job_status']} | {r['first_failure'] or '—'} | "
                 f"{r['repair_rounds']} | {r['tests']} | {r['evals']} | {r['seconds_llm_stages']} | "
                 f"{r['seconds_validation_last_round']} | {r['seconds_total']} |")
    (OUT / f"{stamp}.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", default=[settings.llm_model])
    ap.add_argument("--attempts", type=int, default=3)
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="aab-bench-"))
    settings.storage_dir = tmp / "data"
    engine = create_engine(f"sqlite:///{tmp / 'bench.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    m = meta(args.models, args.attempts)
    rows: list[dict] = []
    for model in args.models:
        for a in range(args.attempts):  # attempt-major order: a late crash still covers every task
            # independent sample per attempt: a fixed seed made baseline 20261105-121419 repeat identical outputs
            provider = OllamaProvider(settings.ollama_base_url, model, seed=attempt_seed(a))
            for d, tid, prompt in TASKS:
                r = one(factory, provider, d, tid, prompt)
                r["attempt"], r["seed"] = a + 1, provider.options["seed"]
                rows.append(r)
                write(stamp, m, rows, args.models)
                print(f"{model:22} #{a + 1} {tid:16} {r['status'] or r['job_status']:18} {r['seconds_total']:7}s "
                      f"repairs={r['repair_rounds']} tests={r['tests']} evals={r['evals']} {r['first_failure']}", flush=True)
    print(f"wrote {OUT / stamp}.json/.md", flush=True)


if __name__ == "__main__":
    main()
