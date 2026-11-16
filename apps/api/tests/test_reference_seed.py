"""Reference seeding is idempotent, including when two seeds race (found by parallel Playwright workers, 2026-11)."""
import json

from sqlalchemy import func, select

from app.models import Skill, SkillVersion
from app.skills import reference

MANIFEST = {"id": "race-skill", "name": "Race", "description": "d", "version": "1.0.0", "kind": "instructions",
            "origin": "reference"}


def _root(tmp_path):
    d = tmp_path / "ref" / "race-skill"
    d.mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")
    (d / "SKILL.md").write_text('---\nname: race-skill\ndescription: "d"\n---\n\n# Race\n\nDo it.\n', encoding="utf-8")
    return tmp_path / "ref"


def test_seed_is_idempotent(factory, tmp_path):
    root = _root(tmp_path)
    with factory() as s:
        first = reference.seed(s, root)
        again = reference.seed(s, root)
    assert first[0]["seeded"] is True and again[0]["seeded"] is False
    assert again[0]["version_id"] == first[0]["version_id"]


def test_concurrent_seed_of_the_same_version_reports_it_instead_of_failing(factory, tmp_path, monkeypatch):
    """Before the fix: both requests passed the existence check, the second hit UNIQUE(skills.slug) -> HTTP 500."""
    root = _root(tmp_path)
    real_validation = reference.full_validation
    winner = {}

    def validation_while_another_seed_commits(files, model):
        result = real_validation(files, model)
        if not winner:  # only the first caller simulates the competitor; the competitor itself validates normally
            winner["pending"] = True
            with factory() as other:  # the concurrent request finishes first
                winner.update(reference.seed(other, root)[0])
        return result

    monkeypatch.setattr(reference, "full_validation", validation_while_another_seed_commits)
    with factory() as s:
        out = reference.seed(s, root)
    monkeypatch.setattr(reference, "full_validation", real_validation)
    assert out == [{"slug": "race-skill", "version": "1.0.0", "status": winner["status"],
                    "version_id": winner["version_id"], "seeded": False}]
    with factory() as s:
        assert s.scalar(select(func.count()).select_from(Skill)) == 1
        assert s.scalar(select(func.count()).select_from(SkillVersion)) == 1
