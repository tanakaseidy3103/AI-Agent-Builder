import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.config import settings
from app.db import Base, get_session, get_session_factory
from app.llm import FakeProvider, get_provider
from app.main import app


@pytest.fixture
def factory(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", tmp_path)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def fake():
    return FakeProvider([])


@pytest.fixture
def client(factory, fake):
    def session():
        with factory() as s:
            yield s
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_session_factory] = lambda: factory
    app.dependency_overrides[get_provider] = lambda: fake
    yield TestClient(app)
    app.dependency_overrides.clear()
