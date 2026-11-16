"""/health/ready: real SQLite database (test fixture); the Docker and model probes are replaced so the test is
deterministic (the real probes are exercised by the e2e scripts). /health stays a pure liveness probe."""
import pytest
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine

from app import readiness
from tests.test_demo import make  # noqa: F401  (demo app fixture)


@pytest.fixture(autouse=True)
def fresh_cache():
    readiness.clear_cache()
    yield
    readiness.clear_cache()


def test_ready_when_every_dependency_answers(client, monkeypatch):
    monkeypatch.setattr(readiness, "sandbox_ok", lambda: True)
    monkeypatch.setattr(readiness, "model_ok", lambda base_url=None: True)
    r = client.get("/health/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ready", "checks": {"database": True, "sandbox": True, "model": True}}


def test_degraded_without_sandbox_or_model_but_still_200(client, monkeypatch):
    monkeypatch.setattr(readiness, "sandbox_ok", lambda: False)
    monkeypatch.setattr(readiness, "model_ok", lambda base_url=None: (_ for _ in ()).throw(RuntimeError("refused")))
    r = client.get("/health/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "degraded", "checks": {"database": True, "sandbox": False, "model": False}}


def test_down_when_the_database_is_unreachable(monkeypatch):
    monkeypatch.setattr(readiness, "sandbox_ok", lambda: True)
    monkeypatch.setattr(readiness, "model_ok", lambda base_url=None: True)
    broken = sessionmaker(bind=create_engine("sqlite:///Z:/does/not/exist/db.sqlite"))
    code, body = readiness.readiness(broken)
    assert code == 503 and body["status"] == "down" and body["checks"]["database"] is False


def test_probes_are_cached_so_polling_cannot_spawn_work(client, monkeypatch):
    calls = []
    monkeypatch.setattr(readiness, "sandbox_ok", lambda: calls.append(1) or True)
    monkeypatch.setattr(readiness, "model_ok", lambda base_url=None: True)
    for _ in range(5):
        client.get("/health/ready")
    assert len(calls) == 1


def test_liveness_is_unchanged(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_demo_readiness_reports_booleans_only(make, monkeypatch):  # noqa: F811
    monkeypatch.setattr(readiness, "sandbox_ok", lambda: True)
    client, _, _ = make(ready=lambda: False)
    r = client.get("/health/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "degraded", "checks": {"database": True, "sandbox": True, "model": False}, "mode": "demo"}
