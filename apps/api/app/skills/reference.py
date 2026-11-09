"""Human-written reference Skills (skills/reference/*): the benchmark for the evaluation system.

They go through exactly the same validation and sandbox evaluation as generated Skills.
"""
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Skill, SkillVersion, ValidationRun, audit
from app.skills import storage
from app.skills.evaluation import full_validation
from app.skills.templates import CLI

REFERENCE_DIR = Path(__file__).resolve().parents[4] / "skills" / "reference"
REFERENCE_MODEL = "human (reference)"


def load_reference(path: Path) -> dict[str, str]:
    _SKIP = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".git"}
    files = {p.relative_to(path).as_posix(): p.read_text(encoding="utf-8")
             for p in sorted(path.rglob("*")) if p.is_file() and not _SKIP.intersection(p.parts)}
    if json.loads(files["manifest.json"]).get("kind") == "code":
        files.setdefault("scripts/cli.py", CLI)
    return files


def seed(s: Session, root: Path = REFERENCE_DIR) -> list[dict]:
    out = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        files = load_reference(d)
        m = json.loads(files["manifest.json"])
        skill = s.scalar(select(Skill).where(Skill.slug == m["id"]))
        if skill and any(v.version == m["version"] for v in skill.versions):
            v = next(v for v in skill.versions if v.version == m["version"])
            out.append({"slug": m["id"], "version": m["version"], "status": v.status, "version_id": v.id, "seeded": False})
            continue  # versions are immutable; bump the manifest version to re-seed
        status, report = full_validation(files, REFERENCE_MODEL)
        if skill is None:
            skill = Skill(slug=m["id"], name=m["name"], description=m["description"])
            s.add(skill)
            s.flush()
        v = SkillVersion(skill_id=skill.id, version=m["version"], kind=m["kind"], status=status, manifest=m,
                         storage_key="", file_count=len(files))
        s.add(v)
        s.flush()
        v.storage_key = v.id
        storage.write_package(v.storage_key, files)
        s.add(ValidationRun.from_report(v.id, status, report))
        audit(s, "skill.reference.seeded", v.id, slug=m["id"], status=status)
        s.commit()
        out.append({"slug": m["id"], "version": m["version"], "status": status, "version_id": v.id, "seeded": True,
                    "summary": report["summary"], "criteria": report["criteria"]})
    return out
