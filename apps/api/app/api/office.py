"""Office view backend: pipeline roles ("agents") and the real event stream that drives them.

Every event is a persisted AgentEventRow written by the pipeline at an actual stage transition.
Nothing here synthesizes activity.
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import LOOPBACK, require_local
from app.config import settings
from app.db import get_session, get_session_factory
from app.models import AgentEventRow, GenerationJob

router = APIRouter(prefix="/studio", tags=["office"])

AGENTS = {
    "architect": {"name": "Architect", "role": "Analyzes the request and writes the Skill spec and plan",
                  "tools": ["LLM (structured JSON)"], "stages": ["analyze", "specify", "plan"]},
    "coder": {"name": "Coder", "role": "Writes scripts/main.py and repairs it from failures",
              "tools": ["LLM (code blocks)"], "stages": ["generate_files"]},
    "reviewer": {"name": "Reviewer", "role": "Runs deterministic static checks and writes the report",
                 "tools": ["AST policy checker", "schema validator"], "stages": ["static_validation", "report"]},
    "tester": {"name": "Tester", "role": "Writes tests and runs tests + eval cases in the Docker sandbox",
               "tools": ["LLM (tests)", "Docker sandbox (no network)"], "stages": ["test_generation", "sandbox_tests", "evaluate"]},
    "packager": {"name": "Packager", "role": "Stores the immutable version and prepares exports",
                 "tools": ["package storage", "export adapters"], "stages": ["package"]},
}


@router.get("/agents", dependencies=[Depends(require_local)])
def agents(s: Session = Depends(get_session)) -> list[dict]:
    out = []
    for aid, meta in AGENTS.items():
        last = s.scalar(select(AgentEventRow).where(AgentEventRow.agent_id == aid).order_by(AgentEventRow.id.desc()).limit(1))
        recent = s.scalars(select(AgentEventRow).where(AgentEventRow.agent_id == aid).order_by(AgentEventRow.id.desc()).limit(15))
        runs = s.scalar(select(func.count(func.distinct(AgentEventRow.run_id))).where(AgentEventRow.agent_id == aid)) or 0
        out.append({"id": aid, **meta, "state": last.state if last else "idle", "current_run": last.run_id if last else None,
                    "runs": runs, "recent": [e.to_contract() for e in recent]})
    return out


@router.get("/events", dependencies=[Depends(require_local)])
def events(after: int = 0, run_id: str | None = None, limit: int = 200, s: Session = Depends(get_session)) -> list[dict]:
    q = select(AgentEventRow).where(AgentEventRow.id > after)
    if run_id:
        q = q.where(AgentEventRow.run_id == run_id)
    return [e.to_contract() for e in s.scalars(q.order_by(AgentEventRow.id).limit(min(limit, 500)))]


@router.get("/runs/{run_id}/events", dependencies=[Depends(require_local)])
def run_events(run_id: str, s: Session = Depends(get_session)) -> dict:
    job = s.get(GenerationJob, run_id)
    if job is None:
        raise HTTPException(404, "run not found")
    return {"prompt": job.prompt, "status": job.status, "events": events(0, run_id, 500, s)}


@router.websocket("/events/ws")
async def events_ws(ws: WebSocket, after: int = 0):
    # Same local-only rule as the REST routes.
    host = ws.client.host if ws.client else None
    if settings.studio_local_only and host not in LOOPBACK:
        await ws.close(code=1008)
        return
    await ws.accept()
    factory = ws.app.dependency_overrides.get(get_session_factory, get_session_factory)()
    cursor = after
    try:
        while True:
            with factory() as s:
                rows = list(s.scalars(select(AgentEventRow).where(AgentEventRow.id > cursor).order_by(AgentEventRow.id).limit(200)))
            for r in rows:
                await ws.send_json(r.to_contract())
                cursor = r.id
            await asyncio.sleep(0.5)  # DB-cursor polling: works across threads/processes, survives restarts
    except WebSocketDisconnect:
        return
