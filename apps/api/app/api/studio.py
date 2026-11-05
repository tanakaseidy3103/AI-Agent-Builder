"""Skill Studio API (local-only until user auth exists)."""
from collections.abc import Callable

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_key, new_key, require_local
from app.db import get_session, get_session_factory
from app.llm import LLMProvider, get_provider
from app.models import (ApiKey, AuditEvent, ExportRecord, GenerationJob, Skill, SkillVersion, ValidationRun, audit, now)
from app.skills import adapters, storage
from app.skills.package import Manifest, safe_relpath
from app.skills.pipeline import full_validation, run_generation

router = APIRouter(prefix="/studio", tags=["studio"], dependencies=[Depends(require_local)])


class GenerateIn(BaseModel):
    prompt: str = Field(min_length=10, max_length=4000)


def _job_out(j: GenerationJob) -> dict:
    return {"id": j.id, "prompt": j.prompt, "status": j.status, "stage": j.stage, "stages": j.stages,
            "error": j.error, "provider": j.provider, "skill_version_id": j.skill_version_id,
            "created_at": j.created_at, "updated_at": j.updated_at}


def _version_out(v: SkillVersion) -> dict:
    return {"id": v.id, "skill_id": v.skill_id, "slug": v.manifest["id"], "version": v.version, "kind": v.kind,
            "status": v.status, "file_count": v.file_count, "created_at": v.created_at}


def _get_version(s: Session, version_id: str) -> SkillVersion:
    v = s.get(SkillVersion, version_id)
    if v is None:
        raise HTTPException(404, "skill version not found")
    return v


@router.post("/skills/generate", status_code=202)
def generate(body: GenerateIn, bg: BackgroundTasks, s: Session = Depends(get_session),
             factory: Callable[[], Session] = Depends(get_session_factory),
             provider: LLMProvider = Depends(get_provider)) -> dict:
    job = GenerationJob(prompt=body.prompt.strip())
    s.add(job)
    audit(s, "skill.generate.requested", job.id, provider=provider.name)
    s.commit()
    bg.add_task(run_generation, job.id, factory, provider)
    return _job_out(job)


@router.get("/jobs/{job_id}")
def get_job(job_id: str, s: Session = Depends(get_session)) -> dict:
    j = s.get(GenerationJob, job_id)
    if j is None:
        raise HTTPException(404, "job not found")
    return _job_out(j)


@router.get("/jobs")
def list_jobs(s: Session = Depends(get_session)) -> list[dict]:
    return [_job_out(j) for j in s.scalars(select(GenerationJob).order_by(GenerationJob.created_at.desc()).limit(20))]


@router.get("/skills")
def list_skills(s: Session = Depends(get_session)) -> list[dict]:
    out = []
    for sk in s.scalars(select(Skill).order_by(Skill.created_at.desc())):
        latest = sk.versions[-1] if sk.versions else None
        out.append({"id": sk.id, "slug": sk.slug, "name": sk.name, "description": sk.description,
                    "latest": _version_out(latest) if latest else None, "versions": len(sk.versions)})
    return out


@router.get("/versions/{version_id}")
def get_version(version_id: str, s: Session = Depends(get_session)) -> dict:
    v = _get_version(s, version_id)
    files = storage.read_package(v.storage_key)
    last = s.scalar(select(ValidationRun).where(ValidationRun.skill_version_id == v.id)
                    .order_by(ValidationRun.created_at.desc()).limit(1))
    return {**_version_out(v), "manifest": v.manifest,
            "files": [{"path": p, "size": len(t.encode())} for p, t in files.items()],
            "validation": {"id": last.id, "status": last.status, "report": last.report, "created_at": last.created_at} if last else None,
            "versions": [_version_out(x) for x in v.skill.versions]}


@router.get("/versions/{version_id}/files/{path:path}")
def get_file(version_id: str, path: str, s: Session = Depends(get_session)) -> Response:
    v = _get_version(s, version_id)
    try:
        rel = safe_relpath(path)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    files = storage.read_package(v.storage_key)
    if rel not in files:
        raise HTTPException(404, "file not found")
    return Response(files[rel], media_type="text/plain; charset=utf-8")


@router.post("/versions/{version_id}/validate")
def validate(version_id: str, s: Session = Depends(get_session)) -> dict:
    v = _get_version(s, version_id)
    status, report = full_validation(storage.read_package(v.storage_key))
    run = ValidationRun(skill_version_id=v.id, status=status, report=report, duration_ms=report["duration_ms"])
    v.status = status
    s.add(run)
    audit(s, "skill.validated", v.id, status=status)
    s.commit()
    return {"id": run.id, "status": status, "report": report, "created_at": run.created_at}


@router.get("/integrations")
def integrations() -> list[dict]:
    return [{"id": t.id, "label": t.label, "scope": t.scope, "notes": t.notes} for t in adapters.TARGETS.values()]


def _exportable(v: SkillVersion, target: str) -> Manifest:
    if target not in adapters.TARGETS:
        raise HTTPException(404, f"unknown target {target!r}")
    if v.status not in ("validated", "verified"):
        raise HTTPException(409, f"version is '{v.status}'; only validated or verified Skills can be exported")
    m = Manifest.model_validate(v.manifest)
    if target != "canonical" and target not in m.compatibility:
        raise HTTPException(409, f"Skill does not declare compatibility with {target}")
    return m


@router.get("/versions/{version_id}/export/{target}")
def export(version_id: str, target: str, s: Session = Depends(get_session)) -> Response:
    v = _get_version(s, version_id)
    m = _exportable(v, target)
    data = adapters.build_zip(target, m, storage.read_package(v.storage_key))
    s.add(ExportRecord(skill_version_id=v.id, target=target))
    audit(s, "skill.exported", v.id, integration=target, bytes=len(data))
    s.commit()
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{adapters.zip_name(target, m)}"'})


@router.get("/versions/{version_id}/install/{target}")
def install(version_id: str, target: str, s: Session = Depends(get_session)) -> dict:
    v = _get_version(s, version_id)
    return {**adapters.install_instructions(target, _exportable(v, target)), "status": v.status}


class KeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.post("/api-keys", status_code=201)
def create_key(body: KeyIn, s: Session = Depends(get_session)) -> dict:
    raw = new_key()
    k = ApiKey(name=body.name, prefix=raw[:10], key_hash=hash_key(raw))
    s.add(k)
    s.flush()
    audit(s, "api_key.created", k.id, name=body.name)
    s.commit()
    return {"id": k.id, "name": k.name, "prefix": k.prefix, "key": raw,
            "note": "Shown once. Store it in your backend's environment, never in browser code."}


@router.get("/api-keys")
def list_keys(s: Session = Depends(get_session)) -> list[dict]:
    return [{"id": k.id, "name": k.name, "prefix": k.prefix, "created_at": k.created_at, "revoked_at": k.revoked_at}
            for k in s.scalars(select(ApiKey).order_by(ApiKey.created_at.desc()))]


@router.delete("/api-keys/{key_id}", status_code=204)
def revoke_key(key_id: str, s: Session = Depends(get_session)) -> Response:
    k = s.get(ApiKey, key_id)
    if k is None:
        raise HTTPException(404, "key not found")
    if k.revoked_at is None:
        k.revoked_at = now()
        audit(s, "api_key.revoked", k.id)
        s.commit()
    return Response(status_code=204)


@router.get("/audit")
def audit_log(s: Session = Depends(get_session)) -> list[dict]:
    rows = s.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(100))
    return [{"action": a.action, "target": a.target, "detail": a.detail, "created_at": a.created_at} for a in rows]
