"""Skill Studio API (local-only until user auth exists)."""
from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_key, new_key, require_local
from app.db import get_session, get_session_factory
from app.llm import LLMProvider, get_provider
from app.llm import LLMError
from app.models import (ApiKey, AuditEvent, ExportRecord, GenerationJob, Skill, SkillVersion, ValidationRun, audit, now)
from app.skills import adapters, storage
from app.skills.evaluation import full_validation
from app.skills.package import Manifest, safe_relpath, slugify
from app.skills.pipeline import build_manifest, plan_spec, run_generation

router = APIRouter(prefix="/studio", tags=["studio"], dependencies=[Depends(require_local)])


class GenerateIn(BaseModel):
    prompt: str = Field(min_length=10, max_length=4000)
    kind: Literal["auto", "instructions", "code"] = "auto"
    spec: dict | None = None  # plan from POST /skills/plan, possibly edited by the user


def _plan_preview(spec: dict) -> dict:
    """What the user reviews before generation: kind, permissions, tools, files, contract."""
    try:
        m = build_manifest(spec, slugify(str(spec.get("name") or "skill")), "0.1.0")
    except (ValueError, TypeError) as e:
        raise HTTPException(422, f"invalid plan: {e}") from e
    files = ["SKILL.md", "manifest.json", "README.md"] + (
        ["scripts/main.py", "scripts/cli.py", "tests/test_main.py", "evals/cases.json", "docs/usage.md"] if m.kind == "code" else [])
    warnings = []
    if "network" in m.permissions:
        warnings.append("Needs network/external services: the sandbox cannot grant this, so the Skill cannot be verified.")
    if m.kind == "instructions":
        warnings.append("Instruction-only: can reach 'validated' at most; nothing executable to verify.")
    return {"slug": m.id, "kind": m.kind, "name": m.name, "description": m.description, "permissions": m.permissions,
            "tools": m.tools, "external_services": spec.get("external_services") or [], "files": files,
            "input_schema": m.input_schema, "output_schema": m.output_schema, "warnings": warnings}


@router.post("/skills/plan")
def plan(body: GenerateIn, provider: LLMProvider = Depends(get_provider)) -> dict:
    """Step 1 of creation: let the model propose a plan; nothing is generated or stored yet."""
    try:
        spec = plan_spec(provider, body.prompt.strip(), None if body.kind == "auto" else body.kind)
    except LLMError as e:
        raise HTTPException(503, f"model unavailable: {e}") from e
    spec.pop("_schema_repaired", None)
    return {"spec": spec, "preview": _plan_preview(spec), "provider": provider.name}


def _job_out(j: GenerationJob) -> dict:
    return {"id": j.id, "prompt": j.prompt, "requested_kind": j.requested_kind, "status": j.status, "stage": j.stage, "stages": j.stages,
            "error": j.error, "provider": j.provider, "skill_version_id": j.skill_version_id,
            "approved_plan": j.approved_spec is not None,
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
    if body.spec is not None:
        _plan_preview(body.spec)  # reject an invalid edited plan before queueing
    job = GenerationJob(prompt=body.prompt.strip(), requested_kind=None if body.kind == "auto" else body.kind,
                        approved_spec=body.spec)
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
    prev = s.scalar(select(ValidationRun).where(ValidationRun.skill_version_id == v.id).order_by(ValidationRun.created_at.desc()).limit(1))
    status, report = full_validation(storage.read_package(v.storage_key), prev.model if prev else None)
    run = ValidationRun.from_report(v.id, status, report)
    if report["sandbox"].get("status") == "unavailable" and v.kind == "code":
        # infrastructure outage is not evidence about the Skill: record the run, keep the status
        s.add(run)
        audit(s, "skill.validated", v.id, status=v.status, sandbox="unavailable")
        s.commit()
        raise HTTPException(503, f"sandbox unavailable ({report['sandbox'].get('error')}); status unchanged: {v.status}")
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


@router.post("/reference/seed")
def seed_reference(s: Session = Depends(get_session)) -> list[dict]:
    """Import the human-written reference Skills and evaluate them in the sandbox (real runs)."""
    from app.skills.reference import seed
    return seed(s)


@router.get("/evaluations")
def evaluations(s: Session = Depends(get_session)) -> list[dict]:
    """Per Skill and version: latest real validation run numbers. Nothing here is estimated."""
    out = []
    for sk in s.scalars(select(Skill).order_by(Skill.slug)):
        versions = []
        for v in sk.versions:
            runs = list(s.scalars(select(ValidationRun).where(ValidationRun.skill_version_id == v.id)
                                  .order_by(ValidationRun.created_at.desc())))
            if not runs:
                continue
            r = runs[0]
            total = r.tests_total + r.evals_total
            passed = r.tests_passed + r.evals_passed
            versions.append({
                "version_id": v.id, "version": v.version, "status": v.status, "kind": v.kind,
                "origin": v.manifest.get("origin", "generated"), "model": r.model, "runs": len(runs),
                "tests_total": r.tests_total, "tests_passed": r.tests_passed,
                "evals_total": r.evals_total, "evals_passed": r.evals_passed,
                "success_rate": round(passed / total, 3) if total else None,
                "duration_ms": r.duration_ms, "validated_at": r.created_at,
                "criteria": r.report.get("criteria", []), "repair_rounds": r.report.get("repair_rounds"),
            })
        if versions:
            out.append({"slug": sk.slug, "name": sk.name, "versions": versions})
    return out
