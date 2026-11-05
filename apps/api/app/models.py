import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _id() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(UTC)


class Skill(Base):
    __tablename__ = "skills"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    versions: Mapped[list["SkillVersion"]] = relationship(back_populates="skill", order_by="SkillVersion.created_at")


class SkillVersion(Base):
    __tablename__ = "skill_versions"
    __table_args__ = (UniqueConstraint("skill_id", "version"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    skill_id: Mapped[str] = mapped_column(ForeignKey("skills.id"), index=True)
    version: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(16))  # instructions | code
    status: Mapped[str] = mapped_column(String(24))  # validation_failed | validated | verified (app/skills/evaluation.py)
    manifest: Mapped[dict] = mapped_column(JSON)
    storage_key: Mapped[str] = mapped_column(String(128))  # package dir under settings.storage_dir
    file_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    skill: Mapped[Skill] = relationship(back_populates="versions")


class GenerationJob(Base):
    __tablename__ = "generation_jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    prompt: Mapped[str] = mapped_column(Text)
    requested_kind: Mapped[str | None] = mapped_column(String(16))  # None = let the model decide
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | generating | completed | failed
    approved_spec: Mapped[dict | None] = mapped_column(JSON)  # plan reviewed by the user; skips the analyze LLM call
    stage: Mapped[str | None] = mapped_column(String(32))
    stages: Mapped[list] = mapped_column(JSON, default=list)  # [{name, status, detail, duration_ms}]
    error: Mapped[str | None] = mapped_column(Text)
    provider: Mapped[str | None] = mapped_column(String(80))
    skill_version_id: Mapped[str | None] = mapped_column(ForeignKey("skill_versions.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class ValidationRun(Base):
    __tablename__ = "validation_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    skill_version_id: Mapped[str] = mapped_column(ForeignKey("skill_versions.id"), index=True)
    status: Mapped[str] = mapped_column(String(24))  # resulting version status
    report: Mapped[dict] = mapped_column(JSON)  # static checks, tests, evals, criteria, sandbox info
    duration_ms: Mapped[int] = mapped_column(Integer)
    model: Mapped[str | None] = mapped_column(String(80))  # model that generated the code, or "human"
    tests_total: Mapped[int] = mapped_column(Integer, default=0)
    tests_passed: Mapped[int] = mapped_column(Integer, default=0)
    evals_total: Mapped[int] = mapped_column(Integer, default=0)
    evals_passed: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    @classmethod
    def from_report(cls, version_id: str, status: str, report: dict) -> "ValidationRun":
        sm = report.get("summary", {})
        return cls(skill_version_id=version_id, status=status, report=report, duration_ms=report.get("duration_ms", 0),
                   model=report.get("model"), tests_total=sm.get("tests_total", 0), tests_passed=sm.get("tests_passed", 0),
                   evals_total=sm.get("evals_total", 0), evals_passed=sm.get("evals_passed", 0))


class ExportRecord(Base):
    __tablename__ = "export_records"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    skill_version_id: Mapped[str] = mapped_column(ForeignKey("skill_versions.id"), index=True)
    target: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ApiKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(16))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # sha256 hex
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ExecutionLog(Base):
    __tablename__ = "execution_logs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    skill_version_id: Mapped[str] = mapped_column(ForeignKey("skill_versions.id"), index=True)
    api_key_id: Mapped[str] = mapped_column(ForeignKey("api_keys.id"), index=True)
    status: Mapped[str] = mapped_column(String(16))  # completed | failed
    output: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    action: Mapped[str] = mapped_column(String(48), index=True)
    target: Mapped[str | None] = mapped_column(String(128))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AgentEventRow(Base):
    """Persisted AgentEvent (packages/contracts). Emitted only when a pipeline stage really changes state."""
    __tablename__ = "agent_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)  # monotonic cursor for streaming
    run_id: Mapped[str] = mapped_column(String(32), index=True)  # generation job / repo task id
    agent_id: Mapped[str] = mapped_column(String(32))
    state: Mapped[str] = mapped_column(String(32))
    message: Mapped[str | None] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    def to_contract(self) -> dict:
        return {"id": self.id, "agent_id": self.agent_id, "run_id": self.run_id, "state": self.state,
                "message": self.message, "at": self.at.isoformat()}


SECRET_KEYS = ("key", "token", "password", "secret", "authorization")


def _redact(detail: dict) -> dict:
    return {k: ("[redacted]" if any(s in k.lower() for s in SECRET_KEYS) and k != "api_key_prefix" else v)
            for k, v in detail.items()}


def audit(session, action: str, target: str | None = None, **detail) -> None:
    session.add(AuditEvent(action=action, target=target, detail=_redact(detail)))


def emit_event(session, run_id: str, agent_id: str, state: str, message: str) -> None:
    session.add(AgentEventRow(run_id=run_id, agent_id=agent_id, state=state, message=message[:500]))
