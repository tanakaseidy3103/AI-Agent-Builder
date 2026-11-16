"""Demo routes (/demo/*). Response shapes mirror the Studio's so the same frontend renders them.

Every route except /demo/session and /demo/status requires a visitor session (header X-Demo-Session). Every query is
scoped to that session: a visitor sees only the jobs and Skill versions it created, plus read-only examples (the
human-written reference Skills). There is deliberately NO route for project install, folder analysis, API keys, the
audit log, deleting, seeding, model choice, /v1 or the event WebSocket.
"""
import hashlib
import hmac
import re
import secrets
from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import llm
from app.api.office import AGENTS
from app.api.studio import _job_out, _version_out
from app.demo.config import DemoSettings
from app.demo.limits import RateLimiter, Slots, client_ip
from app.demo.models import DemoJob, DemoSession, now
from app.demo.worker import GenerationWorker
from app.models import AgentEventRow, ExportRecord, GenerationJob, Skill, SkillVersion, ValidationRun, audit
from app.skills import adapters, storage
from app.skills.evaluation import full_validation
from app.skills.package import Manifest, safe_relpath

TOKEN_PREFIX = "demo_"
EXPORT_TARGETS = ("claude-code", "codex", "cursor", "canonical")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


_URL = re.compile(r"https?://\S+")
_WINPATH = re.compile(r"[A-Za-z]:\\[^\s'\"]+")


def public_error(text: str | None) -> str | None:
    """Job errors as visitors see them: no internal URLs or host paths."""
    if not text:
        return text
    if "Ollama" in text or "model output truncated" in text or "unexpected Ollama" in text:
        stage = text.split(":", 1)[0] if ":" in text else "generation"
        return f"{stage}: the AI model is not available right now. Try again later."
    return _WINPATH.sub("[path]", _URL.sub("[internal]", text))[:600]


def public_event(e: dict) -> dict:
    """A live event as visitors see it: its message goes through public_error (no internal URLs or host paths)."""
    return {**e, "message": public_error(e.get("message"))}


class GenerateIn(BaseModel):
    prompt: str = Field(min_length=10)
    kind: Literal["auto", "instructions", "code"] = "auto"


def build_router(cfg: DemoSettings, factory: Callable[[], Session], worker: GenerationWorker,
                 limiter: RateLimiter, sandbox_slots: Slots, ollama_ready: Callable[[], bool]) -> APIRouter:
    router = APIRouter(prefix="/demo", tags=["demo"])

    def db():
        with factory() as s:
            yield s

    def ip_limited(request: Request) -> str:
        ip = client_ip(request)
        limiter.hit(f"ip:{ip}", cfg.rate_limit_per_minute, 60)
        return ip

    def visitor(request: Request, _ip: str = Depends(ip_limited), s: Session = Depends(db)) -> DemoSession:
        token = request.headers.get("x-demo-session", "")
        if not token.startswith(TOKEN_PREFIX):
            raise HTTPException(401, "demo session missing; reload the page to start a new one")
        sess = s.scalar(select(DemoSession).where(DemoSession.token_hash == _hash(token)))
        if sess is None or (now() - _aware(sess.created_at)).total_seconds() > cfg.data_ttl_hours * 3600:
            raise HTTPException(401, "demo session expired; reload the page to start a new one")
        limiter.hit(f"session:{sess.id}", cfg.rate_limit_per_minute, 60)
        return sess

    def access_code(request: Request, ip: str = Depends(ip_limited)) -> None:
        """Presentation mode (DEMO_ACCESS_CODE): actions that run the model or the sandbox need the shared code.
        Wrong codes are rate limited per IP, so the code cannot be guessed by trying."""
        if not cfg.access_code:
            return
        given = request.headers.get("x-demo-code", "")
        if not hmac.compare_digest(given.encode(), cfg.access_code.encode()):
            limiter.hit(f"code:{ip}", 10, 600, "access code attempts")
            raise HTTPException(403, "this action needs the access code given by the presenter")

    def own_job_ids(s: Session, sess: DemoSession) -> list[str]:
        return [j.job_id for j in s.scalars(select(DemoJob).where(DemoJob.session_id == sess.id))]

    def visible_versions(s: Session, sess: DemoSession) -> tuple[set[str], set[str]]:
        """(versions this visitor owns, read-only example versions)."""
        jobs = own_job_ids(s, sess)
        owned = {j.skill_version_id for j in s.scalars(select(GenerationJob).where(GenerationJob.id.in_(jobs))) if j.skill_version_id} if jobs else set()
        examples = {v.id for v in s.scalars(select(SkillVersion)) if v.manifest.get("origin") == "reference"}
        return owned, examples

    def get_visible(s: Session, sess: DemoSession, version_id: str) -> tuple[SkillVersion, bool]:
        owned, examples = visible_versions(s, sess)
        v = s.get(SkillVersion, version_id) if version_id in owned | examples else None
        if v is None:  # same answer for "does not exist" and "belongs to someone else"
            raise HTTPException(404, "skill version not found")
        return v, version_id in owned

    def job_out(j: GenerationJob) -> dict:
        # stage details carry the raw failure text too (e.g. the model server's address): same treatment as `error`
        stages = [{**st, "detail": public_error(st.get("detail"))} for st in (j.stages or [])]
        return {**_job_out(j), "error": public_error(j.error), "provider": j.provider, "stages": stages}

    @router.post("/session", status_code=201)
    def new_session(ip: str = Depends(ip_limited), s: Session = Depends(db)) -> dict:
        limiter.hit(f"new-session:{ip}", cfg.sessions_per_ip_per_hour, 3600, "new demo sessions")
        token = TOKEN_PREFIX + secrets.token_urlsafe(32)
        sess = DemoSession(token_hash=_hash(token))
        s.add(sess)
        s.commit()
        return {"token": token, "ttl_hours": cfg.data_ttl_hours, "limits": limits()}

    def limits() -> dict:
        return {"generations_per_session": cfg.generations_per_session, "max_prompt_chars": cfg.max_prompt_chars,
                "queue_max": cfg.queue_max, "data_ttl_hours": cfg.data_ttl_hours}

    @router.get("/status")
    def status(_ip: str = Depends(ip_limited)) -> dict:
        """Public, no session: whether the model is reachable and how busy the demo is. No internal details."""
        return {"model": cfg.model, "model_ready": ollama_ready(), "queue": worker.load(), "queue_max": cfg.queue_max,
                "limits": limits(), "access_code_required": bool(cfg.access_code)}

    @router.post("/skills/generate", status_code=202)
    def generate(body: GenerateIn, sess: DemoSession = Depends(visitor), s: Session = Depends(db),
                 _code: None = Depends(access_code)) -> dict:
        prompt = body.prompt.strip()
        if len(prompt) > cfg.max_prompt_chars:
            raise HTTPException(422, f"the request is too long ({len(prompt)} characters; the demo allows {cfg.max_prompt_chars})")
        used = len(own_job_ids(s, sess))
        if used >= cfg.generations_per_session:
            raise HTTPException(429, f"this demo session already used its {cfg.generations_per_session} generations")
        if worker.load() >= cfg.queue_max:
            raise HTTPException(429, "the demo queue is full; try again in a few minutes", headers={"Retry-After": "120"})
        if not ollama_ready():
            raise HTTPException(503, "the AI model is not available right now (the demo machine may be busy or offline)")
        job = GenerationJob(prompt=prompt, requested_kind=None if body.kind == "auto" else body.kind)
        s.add(job)
        s.flush()
        s.add(DemoJob(job_id=job.id, session_id=sess.id))
        audit(s, "demo.generate.requested", job.id)
        s.commit()
        ahead = worker.submit(job.id)
        return {**job_out(job), "queue_position": ahead}

    @router.get("/jobs")
    def jobs(sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> list[dict]:
        ids = own_job_ids(s, sess)
        if not ids:
            return []
        return [job_out(j) for j in s.scalars(select(GenerationJob).where(GenerationJob.id.in_(ids)).order_by(GenerationJob.created_at.desc()).limit(20))]

    @router.get("/jobs/{job_id}")
    def job(job_id: str, sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> dict:
        j = s.get(GenerationJob, job_id) if job_id in own_job_ids(s, sess) else None
        if j is None:
            raise HTTPException(404, "job not found")
        return {**job_out(j), "queue_position": worker.load() if j.status == "draft" else 0}

    @router.get("/events")
    def events(run_id: str = Query(..., max_length=32), after: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500),
               sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> list[dict]:
        if run_id not in own_job_ids(s, sess):
            raise HTTPException(404, "run not found")
        q = select(AgentEventRow).where(AgentEventRow.run_id == run_id, AgentEventRow.id > after).order_by(AgentEventRow.id).limit(limit)
        return [public_event(e.to_contract()) for e in s.scalars(q)]

    @router.get("/agents")
    def agents(sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> list[dict]:
        ids = own_job_ids(s, sess)
        out = []
        for aid, meta in AGENTS.items():
            rows = list(s.scalars(select(AgentEventRow).where(AgentEventRow.agent_id == aid, AgentEventRow.run_id.in_(ids))
                                  .order_by(AgentEventRow.id.desc()).limit(15))) if ids else []
            out.append({"id": aid, **meta, "state": rows[0].state if rows else "idle", "current_run": rows[0].run_id if rows else None,
                        "runs": len({r.run_id for r in rows}), "recent": [public_event(e.to_contract()) for e in rows]})
        return out

    @router.get("/skills")
    def skills(sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> list[dict]:
        owned, examples = visible_versions(s, sess)
        visible = owned | examples
        out = []
        for sk in s.scalars(select(Skill).order_by(Skill.created_at.desc())):
            vs = [v for v in sk.versions if v.id in visible]
            if vs:
                out.append({"id": sk.id, "slug": sk.slug, "name": sk.name, "description": sk.description,
                            "latest": _version_out(vs[-1]), "versions": len(vs)})
        return out

    @router.get("/versions/{version_id}")
    def version(version_id: str, sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> dict:
        v, _ = get_visible(s, sess, version_id)
        owned, examples = visible_versions(s, sess)
        files = storage.read_package(v.storage_key)
        last = s.scalar(select(ValidationRun).where(ValidationRun.skill_version_id == v.id).order_by(ValidationRun.created_at.desc()).limit(1))
        return {**_version_out(v), "manifest": v.manifest,
                "files": [{"path": p, "size": len(t.encode())} for p, t in files.items()],
                "validation": {"id": last.id, "status": last.status, "report": last.report, "created_at": last.created_at} if last else None,
                "versions": [_version_out(x) for x in v.skill.versions if x.id in owned | examples]}

    @router.get("/versions/{version_id}/files/{path:path}")
    def file(version_id: str, path: str, sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> Response:
        v, _ = get_visible(s, sess, version_id)
        try:
            rel = safe_relpath(path)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        files = storage.read_package(v.storage_key)
        if rel not in files:
            raise HTTPException(404, "file not found")
        return Response(files[rel], media_type="text/plain; charset=utf-8")

    @router.post("/versions/{version_id}/validate")
    def validate(version_id: str, sess: DemoSession = Depends(visitor), s: Session = Depends(db),
                 _code: None = Depends(access_code)) -> dict:
        v, own = get_visible(s, sess, version_id)
        if not own:
            raise HTTPException(403, "examples are read-only; create your own Skill to run its tests")
        limiter.hit(f"validate:{sess.id}", 5, 600, "test runs")
        with sandbox_slots:  # bounded concurrency: a busy sandbox answers 429 instead of starting more containers
            prev = s.scalar(select(ValidationRun).where(ValidationRun.skill_version_id == v.id).order_by(ValidationRun.created_at.desc()).limit(1))
            status, report = full_validation(storage.read_package(v.storage_key), prev.model if prev else None)
        run = ValidationRun.from_report(v.id, status, report)
        s.add(run)
        if report["sandbox"].get("status") == "unavailable" and v.kind == "code":
            s.commit()
            raise HTTPException(503, f"the sandbox is not available right now; status unchanged: {v.status}")
        v.status = status
        s.commit()
        return {"id": run.id, "status": status, "report": report, "created_at": run.created_at}

    @router.get("/versions/{version_id}/export/{target}")
    def export(version_id: str, target: str, sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> Response:
        v, _ = get_visible(s, sess, version_id)
        if target not in EXPORT_TARGETS:
            raise HTTPException(404, f"unknown target {target!r}")
        if v.status not in ("validated", "verified"):
            raise HTTPException(409, f"version is '{v.status}'; only validated or verified Skills can be exported")
        m = Manifest.model_validate(v.manifest)
        if target != "canonical" and target not in m.compatibility:
            raise HTTPException(409, f"Skill does not declare compatibility with {target}")
        data = adapters.build_zip(target, m, storage.read_package(v.storage_key))
        s.add(ExportRecord(skill_version_id=v.id, target=target))
        s.commit()
        return Response(data, media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{adapters.zip_name(target, m)}"'})

    @router.get("/evaluations")
    def evaluations(sess: DemoSession = Depends(visitor), s: Session = Depends(db)) -> list[dict]:
        owned, examples = visible_versions(s, sess)
        visible = owned | examples
        out = []
        for sk in s.scalars(select(Skill).order_by(Skill.slug)):
            rows = []
            for v in (x for x in sk.versions if x.id in visible):
                runs = list(s.scalars(select(ValidationRun).where(ValidationRun.skill_version_id == v.id).order_by(ValidationRun.created_at.desc())))
                if not runs:
                    continue
                r = runs[0]
                total, passed = r.tests_total + r.evals_total, r.tests_passed + r.evals_passed
                rows.append({"version_id": v.id, "version": v.version, "status": v.status, "kind": v.kind,
                             "origin": v.manifest.get("origin", "generated"), "model": r.model, "runs": len(runs),
                             "tests_total": r.tests_total, "tests_passed": r.tests_passed, "evals_total": r.evals_total,
                             "evals_passed": r.evals_passed, "success_rate": round(passed / total, 3) if total else None,
                             "duration_ms": r.duration_ms, "validated_at": r.created_at, "criteria": r.report.get("criteria", []),
                             "repair_rounds": r.report.get("repair_rounds")})
            if rows:
                out.append({"slug": sk.slug, "name": sk.name, "versions": rows})
        return out

    @router.get("/models")
    def models(_sess: DemoSession = Depends(visitor)) -> dict:
        ready = ollama_ready()
        return {"default": cfg.model, "installed": [cfg.model] if ready else [], "runtime": [],
                "error": None if ready else "the AI model is not available right now"}

    @router.get("/integrations")
    def integrations(_sess: DemoSession = Depends(visitor)) -> list[dict]:
        return [{"id": t.id, "label": t.label, "scope": t.scope, "notes": t.notes} for t in adapters.TARGETS.values() if t.id in EXPORT_TARGETS]

    return router


def _aware(dt):
    """SQLite returns naive datetimes; Postgres returns aware ones."""
    from datetime import UTC
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def ollama_checker(model: str, ttl_s: float = 20.0) -> Callable[[], bool]:
    """Cached reachability check: True when the local Ollama answers and has the pinned model."""
    import time
    state = {"at": -1e9, "ok": False}

    def ready() -> bool:
        if time.monotonic() - state["at"] > ttl_s:
            try:
                state["ok"] = model in llm.installed_models()
            except llm.LLMError:
                state["ok"] = False
            state["at"] = time.monotonic()
        return state["ok"]
    return ready
