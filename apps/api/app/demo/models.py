"""Demo-only tables, on their own metadata so local mode's Alembic history is untouched.
Created with DemoBase.metadata.create_all() in the demo database only. No IP address or personal data is stored."""
import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class DemoBase(DeclarativeBase):
    pass


def _id() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(UTC)


class DemoSession(DemoBase):
    """An anonymous visitor. Only the SHA-256 of the bearer token is kept."""
    __tablename__ = "demo_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DemoJob(DemoBase):
    """Ownership: which visitor session started which generation job (and therefore owns its Skill version)."""
    __tablename__ = "demo_jobs"
    job_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("demo_sessions.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
