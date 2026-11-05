"""Reproducible generation benchmark: real Ollama models + real Docker sandbox.

    .venv/Scripts/python.exe scripts/benchmark_generation.py --models llama3.2:3b qwen2.5-coder:latest --attempts 2

Uses a throwaway SQLite DB and storage dir, so Studio data is untouched. Writes raw results to
docs/benchmarks/<timestamp>.json and a summary table to docs/benchmarks/<timestamp>.md. Nothing is estimated:
each row is one full pipeline run.
"""
import argparse
import json
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import Base  # noqa: E402
from app.llm import OllamaProvider  # noqa: E402
from app.skills.pipeline import run_generation  # noqa: E402

PROMPTS = [
    "Create a Skill that finds TODO and FIXME comments in source files and reports file, line number and text.",
    "Create a Skill that checks Python files for functions longer than 40 lines and reports file, function name and length.",
    "Create a Skill that analyzes React projects, detects performance problems, identifies unnecessary renders, and recommends optimizations.",
]
OUT = Path(__file__).resolve().parents[3] / "docs" / "benchmarks"


def one(factory, provider, prompt):
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
        run = s.query(models.ValidationRun).filter_by(skill_version_id=job.skill_version_id).first() if job.skill_version_id else None
        v = s.get(models.SkillVersion, job.skill_version_id) if job.skill_version_id else None
        failed = [] if run is None else [c["id"] for c in run.report["static"]["checks"] if c["status"] == "fail"]
        return {"prompt": prompt, "model": provider.name, "seconds": secs, "job_status": job.status,
                "error": job.error, "status": v.status if v else None,
                "repair_rounds": run.report.get("repair_rounds") if run else None,
                "tests": f"{run.tests_passed}/{run.tests_total}" if run else None,
                "evals": f"{run.evals_passed}/{run.evals_total}" if run else None,
                "failed_checks": failed, "criteria": run.report["criteria"] if run else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", default=[settings.llm_model])
    ap.add_argument("--attempts", type=int, default=2)
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="aab-bench-"))
    settings.storage_dir = tmp / "data"
    engine = create_engine(f"sqlite:///{tmp / 'bench.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    rows = []
    for model in args.models:
        provider = OllamaProvider(settings.ollama_base_url, model, timeout=600)
        for prompt in PROMPTS:
            for a in range(args.attempts):
                r = one(factory, provider, prompt)
                rows.append(r)
                print(f"{model:24} {r['status'] or r['job_status']:18} {r['seconds']:6}s repairs={r['repair_rounds']} "
                      f"tests={r['tests']} evals={r['evals']} | {prompt[:50]}", flush=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"date": stamp, "max_repair_rounds": settings.max_repair_rounds, "sandbox_image": settings.sandbox_image,
            "attempts_per_prompt": args.attempts, "prompts": PROMPTS}
    (OUT / f"{stamp}.json").write_text(json.dumps({"meta": meta, "runs": rows}, indent=2, ensure_ascii=False), encoding="utf-8")
    lines = [f"# Generation benchmark {stamp}", "", f"kind=code forced · max repair rounds {settings.max_repair_rounds} · "
             f"{args.attempts} attempt(s) per prompt · real Ollama + Docker sandbox", "",
             "| Model | Runs | verified | validated | validation_failed | job failed | median s |", "|---|---|---|---|---|---|---|"]
    for model in args.models:
        rs = [r for r in rows if r["model"] == f"ollama:{model}"]
        secs = sorted(r["seconds"] for r in rs)
        count = lambda st: sum(r["status"] == st for r in rs)  # noqa: E731
        lines.append(f"| {model} | {len(rs)} | {count('verified')} | {count('validated')} | {count('validation_failed')} | "
                     f"{sum(r['job_status'] == 'failed' for r in rs)} | {secs[len(secs) // 2] if secs else '-'} |")
    lines += ["", "| Model | Prompt | Status | Repairs | Tests | Evals | Failed checks / error |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        why = ", ".join(r["failed_checks"]) or (r["error"] or "")[:80]
        lines.append(f"| {r['model']} | {r['prompt'][17:60]}… | {r['status'] or r['job_status']} | {r['repair_rounds']} | "
                     f"{r['tests']} | {r['evals']} | {why} |")
    (OUT / f"{stamp}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT / stamp}.json/.md")


if __name__ == "__main__":
    main()
