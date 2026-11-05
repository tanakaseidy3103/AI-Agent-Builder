"""Public developer API (/v1). Requires an API key. Execution is isolated from this process."""
import json
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_api_key
from app.config import settings
from app.db import get_session
from app.llm import LLMError, LLMProvider, get_provider
from app.models import ApiKey, ExecutionLog, Skill, SkillVersion, audit
from app.skills import sandbox, storage
from app.skills.jsonschema_lite import validate as schema_validate
from app.skills.package import Manifest, instructions_body

router = APIRouter(prefix="/v1", tags=["public"])

# Code Skills must pass sandbox tests; instruction-only Skills cannot be tested that way.
RUNNABLE = {"code": {"verified"}, "instructions": {"validated", "verified"}}


class RunIn(BaseModel):
    input: dict
    version: str | None = None


def check_input(schema: dict, data: dict) -> list[str]:
    return schema_validate(schema, data)


def _runnable_version(s: Session, slug: str, version: str | None) -> SkillVersion:
    sk = s.scalar(select(Skill).where(Skill.slug == slug))
    if sk is None:
        raise HTTPException(404, f"skill '{slug}' not found")
    candidates = [v for v in reversed(sk.versions) if v.status in RUNNABLE[v.kind]]
    if version:
        candidates = [v for v in candidates if v.version == version]
    if not candidates:
        raise HTTPException(409, f"no runnable version of '{slug}'" + (f" @{version}" if version else "")
                            + " (code Skills must be verified; instruction Skills validated)")
    return candidates[0]


def _public(v: SkillVersion) -> dict:
    m = v.manifest
    return {"slug": m["id"], "name": m["name"], "description": m["description"], "version": v.version,
            "kind": v.kind, "status": v.status, "input_schema": m["input_schema"], "output_schema": m["output_schema"],
            "permissions": m.get("permissions", [])}


@router.get("/skills")
def list_skills(_: ApiKey = Depends(require_api_key), s: Session = Depends(get_session)) -> list[dict]:
    out = []
    for sk in s.scalars(select(Skill).order_by(Skill.slug)):
        try:
            out.append(_public(_runnable_version(s, sk.slug, None)))
        except HTTPException:
            continue
    return out


@router.get("/skills/{slug}")
def get_skill(slug: str, version: str | None = None, _: ApiKey = Depends(require_api_key),
              s: Session = Depends(get_session)) -> dict:
    return _public(_runnable_version(s, slug, version))


@router.post("/skills/{slug}/run")
def run_skill(slug: str, body: RunIn, key: ApiKey = Depends(require_api_key), s: Session = Depends(get_session),
              provider: LLMProvider = Depends(get_provider)) -> dict:
    if len(json.dumps(body.input)) > settings.max_run_input_bytes:
        raise HTTPException(413, "input too large")
    v = _runnable_version(s, slug, body.version)
    m = Manifest.model_validate(v.manifest)
    errors = check_input(m.input_schema, body.input)
    if errors:
        raise HTTPException(422, {"message": "input does not match input_schema", "errors": errors})

    t0, output, error = time.monotonic(), None, None
    files = storage.read_package(v.storage_key)
    if m.kind == "code":
        try:
            r = sandbox.run_entrypoint(files, m.execution.entrypoint, body.input, m.execution.timeout_seconds, m.execution.memory_mb)
        except sandbox.SandboxUnavailable as e:
            raise HTTPException(503, f"sandbox unavailable: {e}") from e
        if r.ok and r.data.get("ok"):
            output = r.data["output"]
            bad = schema_validate(m.output_schema, output)
            if bad:  # a verified Skill still must honour its contract at run time
                output, error = None, f"output does not match output_schema: {bad[:3]}"
        else:
            error = r.error or r.data.get("error", "execution failed")
    else:
        try:
            text = provider.complete(instructions_body(files["SKILL.md"]),
                                     f"Input (JSON):\n{json.dumps(body.input, ensure_ascii=False)}")
            output = {"text": text}
        except LLMError as e:
            error = f"model unavailable: {e}"

    status = "completed" if error is None else "failed"
    log = ExecutionLog(skill_version_id=v.id, api_key_id=key.id, status=status, output=output, error=error,
                       duration_ms=int((time.monotonic() - t0) * 1000))
    s.add(log)
    s.flush()
    audit(s, "skill.run", v.id, run_id=log.id, status=status, api_key_prefix=key.prefix)
    s.commit()
    return {"run_id": log.id, "status": status, "skill": slug, "version": v.version,
            "output": output, "error": error, "duration_ms": log.duration_ms}


@router.get("/runs/{run_id}")
def get_run(run_id: str, key: ApiKey = Depends(require_api_key), s: Session = Depends(get_session)) -> dict:
    log = s.get(ExecutionLog, run_id)
    if log is None or log.api_key_id != key.id:  # a key only sees its own runs
        raise HTTPException(404, "run not found")
    return {"run_id": log.id, "status": log.status, "output": log.output, "error": log.error,
            "duration_ms": log.duration_ms, "created_at": log.created_at}
