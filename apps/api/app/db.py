from collections.abc import Callable, Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session_factory() -> Callable[[], Session]:
    """Overridden in tests. Background jobs need a factory, not a request-scoped session."""
    return SessionLocal


def get_session() -> Iterator[Session]:
    with SessionLocal() as s:
        yield s
