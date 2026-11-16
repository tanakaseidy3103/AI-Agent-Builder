"""Delete visitor data after DEMO_DATA_TTL_HOURS: sessions, their jobs, events, Skill versions, reports and packages.
Read-only examples (origin 'reference') are never deleted."""
from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.demo.models import DemoJob, DemoSession, now
from app.models import AgentEventRow, ExecutionLog, ExportRecord, GenerationJob, Skill, SkillVersion, ValidationRun
from app.skills import storage


def cleanup_expired(factory: Callable[[], Session], ttl_hours: float) -> int:
    """Returns the number of sessions removed."""
    cutoff = now() - timedelta(hours=ttl_hours)
    with factory() as s:
        sessions = [x.id for x in s.scalars(select(DemoSession).where(DemoSession.created_at < cutoff))]
        if not sessions:
            return 0
        job_ids = [j.job_id for j in s.scalars(select(DemoJob).where(DemoJob.session_id.in_(sessions)))]
        jobs = list(s.scalars(select(GenerationJob).where(GenerationJob.id.in_(job_ids)))) if job_ids else []
        version_ids = [j.skill_version_id for j in jobs if j.skill_version_id]
        keys = []
        if version_ids:
            versions = list(s.scalars(select(SkillVersion).where(SkillVersion.id.in_(version_ids))))
            versions = [v for v in versions if v.manifest.get("origin") != "reference"]
            ids = [v.id for v in versions]
            keys = [v.storage_key for v in versions]
            s.execute(update(GenerationJob).where(GenerationJob.skill_version_id.in_(ids)).values(skill_version_id=None))
            for model in (ValidationRun, ExportRecord, ExecutionLog):
                s.execute(delete(model).where(model.skill_version_id.in_(ids)))
            s.execute(delete(SkillVersion).where(SkillVersion.id.in_(ids)))
        if job_ids:
            s.execute(delete(AgentEventRow).where(AgentEventRow.run_id.in_(job_ids)))
            s.execute(delete(GenerationJob).where(GenerationJob.id.in_(job_ids)))
            s.execute(delete(DemoJob).where(DemoJob.job_id.in_(job_ids)))
        s.execute(delete(DemoSession).where(DemoSession.id.in_(sessions)))
        s.flush()
        for sk in s.scalars(select(Skill)):  # Skills left without any version
            if not sk.versions:
                s.delete(sk)
        s.commit()
    for key in keys:  # files last: a failed commit must not leave rows pointing at deleted packages
        storage.delete_package(key)
    return len(sessions)
