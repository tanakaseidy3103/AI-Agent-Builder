"""Public Demo Mode (app.demo): admin routes absent, visitor isolation, limits, failure handling, CORS/Host, cleanup.
The model is FakeProvider (mechanism tests, not model quality); the sandbox is the same test double as test_pipeline."""
import io
import json
import threading
import zipfile
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.config import settings
from app.db import Base
from app.demo.cleanup import cleanup_expired
from app.demo.config import DemoConfigError, DemoSettings
from app.demo.factory import create_demo_app
from app.demo.limits import Slots
from app.demo.models import DemoBase, DemoJob, DemoSession
from app.demo.routes import public_error
from app.demo.worker import DeadlineProvider
from app.llm import FakeProvider, LLMError
from app.models import GenerationJob, Skill, SkillVersion, ValidationRun
from app.skills import sandbox, storage
from tests.fixtures import CODE_RESPONSES, code_package
from tests.test_pipeline import _evals_from_code, _pass_tests

ORIGIN = "https://aab-demo.pages.dev"
PROMPT = "Create an agent that finds inline arrow handlers in React files and counts them."


def _cfg(tmp_path, **kw) -> DemoSettings:
    base = dict(database_url="", storage_dir=tmp_path / "demo-storage", allowed_origins=ORIGIN,
                allowed_hosts="testserver,*.trycloudflare.com", seed_examples=False, generations_per_session=2,
                queue_max=5, rate_limit_per_minute=1000, sessions_per_ip_per_hour=50, job_timeout_s=600)
    return DemoSettings(**{**base, **kw})


@pytest.fixture
def make(tmp_path, monkeypatch):
    # the demo factory sets these process-wide settings; register them so they are restored after each test
    for k in ("storage_dir", "llm_model", "max_request_bytes"):
        monkeypatch.setattr(settings, k, getattr(settings, k))
    monkeypatch.setattr(sandbox, "run_tests", lambda *a: _pass_tests())
    monkeypatch.setattr(sandbox, "run_evals", _evals_from_code)
    built = {}

    def _make(provider_factory=None, ready=lambda: True, **kw):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        cfg = _cfg(tmp_path, **kw)
        app = create_demo_app(cfg, session_factory=factory, ollama_ready=ready, background=False,
                              provider_factory=provider_factory or (lambda: FakeProvider(list(CODE_RESPONSES))))
        built.update(app=app, factory=factory, cfg=cfg)
        return TestClient(app), app, factory
    return _make


def session(client) -> dict:
    r = client.post("/demo/session")
    assert r.status_code == 201, r.text
    return {"X-Demo-Session": r.json()["token"]}


def generate_and_wait(client, app, headers, prompt=PROMPT) -> dict:
    r = client.post("/demo/skills/generate", json={"prompt": prompt, "kind": "code"}, headers=headers)
    assert r.status_code == 202, r.text
    app.state.worker.join()
    return client.get(f"/demo/jobs/{r.json()['id']}", headers=headers).json()


# ------------------------------------------------------------------ admin surface is absent

ADMIN = [("GET", "/studio/skills"), ("POST", "/studio/skills/generate"), ("GET", "/studio/api-keys"), ("POST", "/studio/api-keys"),
         ("POST", "/studio/projects/analyze"), ("POST", "/studio/versions/x/project/apply"), ("GET", "/studio/audit"),
         ("POST", "/studio/reference/seed"), ("DELETE", "/studio/skills/x"), ("GET", "/studio/events"), ("GET", "/v1/skills"),
         ("POST", "/v1/skills/x/run"), ("GET", "/docs"), ("GET", "/openapi.json"), ("GET", "/redoc"),
         ("POST", "/demo/skills/plan"), ("GET", "/demo/api-keys"), ("POST", "/demo/projects/analyze"),
         ("POST", "/demo/versions/x/project/apply"), ("GET", "/demo/versions/x/install/claude-code"), ("DELETE", "/demo/skills/x")]


@pytest.mark.parametrize("method,path", ADMIN)
def test_admin_and_local_routes_do_not_exist_in_demo(make, method, path):
    client, *_ = make()
    r = client.request(method, path, headers=session(client))
    assert r.status_code in (404, 405), (method, path, r.status_code)


def test_studio_websocket_does_not_exist(make):
    client, *_ = make()
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/studio/events/ws"):
            pass


# ------------------------------------------------------------------ sessions and isolation

@pytest.mark.parametrize("headers", [{}, {"X-Demo-Session": "demo_not-a-real-token"}, {"X-Demo-Session": "aab_wrongprefix"}])
def test_routes_require_a_valid_session(make, headers):
    client, *_ = make()
    for path in ("/demo/skills", "/demo/jobs", "/demo/evaluations", "/demo/models"):
        assert client.get(path, headers=headers).status_code == 401


def test_session_token_is_stored_hashed_only(make):
    client, _, factory = make()
    token = session(client)["X-Demo-Session"]
    with factory() as s:
        row = s.scalar(select(DemoSession))
    assert token not in row.token_hash and len(row.token_hash) == 64


def test_full_flow_and_visitor_isolation(make):
    client, app, _ = make()
    a, b = session(client), session(client)
    job = generate_and_wait(client, app, a)
    assert job["status"] == "completed", job
    vid = job["skill_version_id"]
    v = client.get(f"/demo/versions/{vid}", headers=a).json()
    assert v["status"] == "verified"
    assert client.get(f"/demo/versions/{vid}/files/SKILL.md", headers=a).status_code == 200
    z = client.get(f"/demo/versions/{vid}/export/claude-code", headers=a)
    assert z.status_code == 200 and zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert any(s["latest"]["id"] == vid for s in client.get("/demo/skills", headers=a).json())
    # visitor B sees nothing of A, and gets the same 404 as for an id that does not exist
    for path in (f"/demo/jobs/{job['id']}", f"/demo/versions/{vid}", f"/demo/versions/{vid}/files/SKILL.md",
                 f"/demo/versions/{vid}/export/claude-code", f"/demo/events?run_id={job['id']}"):
        assert client.get(path, headers=b).status_code == 404, path
    assert client.post(f"/demo/versions/{vid}/validate", headers=b).status_code == 404
    assert client.get("/demo/jobs", headers=b).json() == []
    assert client.get("/demo/skills", headers=b).json() == []
    assert client.get("/demo/evaluations", headers=b).json() == []
    assert all(ag["runs"] == 0 for ag in client.get("/demo/agents", headers=b).json())
    assert client.get(f"/demo/events?run_id={job['id']}", headers=a).json()  # the owner does see its events


def test_owner_can_rerun_tests_of_own_version(make):
    client, app, _ = make()
    a = session(client)
    vid = generate_and_wait(client, app, a)["skill_version_id"]
    r = client.post(f"/demo/versions/{vid}/validate", headers=a)
    assert r.status_code == 200 and r.json()["status"] == "verified"


def test_examples_are_visible_to_everyone_but_read_only(make, tmp_path):
    client, _, factory = make()
    files = code_package()
    manifest = json.loads(files["manifest.json"]) | {"origin": "reference"}
    with factory() as s:
        sk = Skill(slug="react-perf", name="React Perf", description="d")
        s.add(sk)
        s.flush()
        v = SkillVersion(skill_id=sk.id, version="1.0.0", kind="code", status="verified", manifest=manifest, storage_key="", file_count=len(files))
        s.add(v)
        s.flush()
        v.storage_key = v.id
        storage.write_package(v.id, files)
        s.commit()
        vid = v.id
    for h in (session(client), session(client)):
        assert client.get(f"/demo/versions/{vid}", headers=h).status_code == 200
        assert client.post(f"/demo/versions/{vid}/validate", headers=h).status_code == 403


# ------------------------------------------------------------------ limits

def test_generation_quota_per_session(make):
    client, app, _ = make(generations_per_session=1)
    a = session(client)
    generate_and_wait(client, app, a)
    r = client.post("/demo/skills/generate", json={"prompt": PROMPT}, headers=a)
    assert r.status_code == 429 and "1 generations" in r.json()["detail"]


def test_queue_full_is_refused(make):
    release = threading.Event()

    class Blocking(FakeProvider):
        def complete_json(self, *a, **k):
            release.wait(10)
            return super().complete_json(*a, **k)

    client, app, _ = make(provider_factory=lambda: Blocking(list(CODE_RESPONSES)), queue_max=1, generations_per_session=5)
    a = session(client)
    assert client.post("/demo/skills/generate", json={"prompt": PROMPT}, headers=a).status_code == 202
    r = client.post("/demo/skills/generate", json={"prompt": PROMPT}, headers=a)
    assert r.status_code == 429 and r.headers["Retry-After"] == "120"
    release.set()
    app.state.worker.join()


def test_prompt_and_body_size_limits(make):
    client, *_ = make(max_prompt_chars=50, max_request_bytes=2000)
    a = session(client)
    assert client.post("/demo/skills/generate", json={"prompt": "x" * 51}, headers=a).status_code == 422
    assert client.post("/demo/skills/generate", json={"prompt": "x" * 5000}, headers=a).status_code == 413


def test_rate_limit_per_ip_answers_429_with_retry_after(make):
    client, *_ = make(rate_limit_per_minute=5)
    codes = [client.get("/demo/status").status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


def test_new_sessions_per_ip_are_limited(make):
    client, *_ = make(sessions_per_ip_per_hour=2)
    assert [client.post("/demo/session").status_code for _ in range(3)] == [201, 201, 429]


def test_sandbox_slots_never_block():
    slots = Slots(1)
    with slots:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as e:
            with slots:
                pass
        assert e.value.status_code == 429
    with slots:  # released again
        pass


def test_model_is_pinned_and_client_cannot_choose(make):
    client, *_ = make(model="pinned-model:1b")
    a = session(client)
    m = client.get("/demo/models", headers=a).json()
    assert m["default"] == "pinned-model:1b" and m["installed"] == ["pinned-model:1b"]


# ------------------------------------------------------------------ failures

def test_model_offline_is_reported_before_queueing(make):
    client, _, factory = make(ready=lambda: False)
    a = session(client)
    r = client.post("/demo/skills/generate", json={"prompt": PROMPT}, headers=a)
    assert r.status_code == 503 and "not available" in r.json()["detail"]
    assert client.get("/demo/status").json()["model_ready"] is False
    assert client.get("/demo/models", headers=a).json()["error"]
    with factory() as s:
        assert s.scalar(select(GenerationJob)) is None  # nothing queued, no quota used


def test_model_failure_during_generation_is_shown_without_internal_details(make):
    client, app, _ = make(provider_factory=lambda: FakeProvider([LLMError("Ollama unreachable at http://localhost:11434: ConnectError")]))
    job = generate_and_wait(client, app, session(client))
    assert job["status"] == "failed"
    assert "localhost" not in job["error"] and "http" not in job["error"] and "not available" in job["error"]


def test_job_time_limit_ends_the_job_as_failed(make):
    client, app, _ = make(job_timeout_s=0)
    job = generate_and_wait(client, app, session(client))
    assert job["status"] == "failed" and "time limit" in job["error"]


def test_deadline_provider_refuses_calls_after_the_deadline():
    t = {"now": 0.0}
    p = DeadlineProvider(FakeProvider(["a", "b"]), deadline=10, clock=lambda: t["now"])
    assert p.complete("s", "u") == "a"
    t["now"] = 10
    with pytest.raises(LLMError, match="time limit"):
        p.complete("s", "u")


def test_public_error_strips_urls_and_paths():
    assert "C:\\" not in public_error(r"package: FileExistsError C:\Users\me\data\skills\x")
    assert "[internal]" in public_error("x: see https://example.invalid/a")


# ------------------------------------------------------------------ CORS and Host

def test_cors_allows_only_the_configured_origin(make):
    client, *_ = make()
    ok = client.options("/demo/status", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == ORIGIN
    bad = client.options("/demo/status", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers
    simple = client.get("/demo/status", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in simple.headers
    assert client.get("/demo/status", headers={"Origin": ORIGIN}).headers.get("access-control-allow-origin") == ORIGIN


def test_host_header_allowlist(make):
    client, *_ = make()
    assert client.get("/health", headers={"Host": "random-words.trycloudflare.com"}).status_code == 200
    assert client.get("/health", headers={"Host": "evil.example"}).status_code == 400


# ------------------------------------------------------------------ isolation config

@pytest.mark.parametrize("kw,msg", [
    (dict(database_url=""), "required"),
    (dict(database_url="postgresql+psycopg://aab:x@127.0.0.1:5434/aab"), "dedicated demo database"),
    (dict(database_url="postgresql+psycopg://aab:x@127.0.0.1:5434/aab_demo", storage_dir=None), "DEMO_STORAGE_DIR"),
    (dict(database_url="postgresql+psycopg://aab:x@127.0.0.1:5434/aab_demo", storage_dir="data"), "DEMO_STORAGE_DIR"),
    (dict(database_url="postgresql+psycopg://aab:x@127.0.0.1:5434/aab_demo", storage_dir="data-demo", allowed_origins="*"), "exact origins"),
])
def test_demo_refuses_to_start_without_isolation(kw, msg):
    with pytest.raises(DemoConfigError, match=msg):
        DemoSettings(**{"storage_dir": "data-demo", **kw}).check_isolated()


def test_isolated_config_is_accepted():
    DemoSettings(database_url="postgresql+psycopg://aab:x@127.0.0.1:5434/aab_demo", storage_dir="data-demo",
                 allowed_origins=ORIGIN).check_isolated()


# ------------------------------------------------------------------ retention

def test_cleanup_removes_expired_visitor_data_and_packages(make):
    client, app, factory = make()
    a = session(client)
    vid = generate_and_wait(client, app, a)["skill_version_id"]
    with factory() as s:
        key = s.get(SkillVersion, vid).storage_key
        for row in s.scalars(select(DemoSession)):
            row.created_at = row.created_at - timedelta(hours=48)
        s.commit()
    assert cleanup_expired(factory, 24) == 1
    with factory() as s:
        assert s.get(SkillVersion, vid) is None
        assert s.scalar(select(DemoJob)) is None and s.scalar(select(GenerationJob)) is None
        assert s.scalar(select(ValidationRun)) is None and s.scalar(select(Skill)) is None
    with pytest.raises(FileNotFoundError):
        storage.read_package(key) or (_ for _ in ()).throw(FileNotFoundError())
    assert client.get("/demo/skills", headers=a).status_code == 401  # the session itself is gone


def test_model_failure_never_reveals_the_model_server_in_stages_or_events(make):
    """2026-11-14: `error` was sanitized, but the failed stage's `detail` and the live events carried the raw message,
    e.g. "Ollama unreachable at http://<model server>". With a remote model server that address must stay private."""
    import json as _json
    client, app, _ = make(provider_factory=lambda: FakeProvider([LLMError("Ollama unreachable at http://gpu-secret.example:11434: ConnectError")]))
    a = session(client)
    job = generate_and_wait(client, app, a)
    assert job["status"] == "failed"
    events = client.get("/demo/events", params={"run_id": job["id"]}, headers=a).json()
    agents = client.get("/demo/agents", headers=a).json()
    for name, payload in (("job", job), ("events", events), ("agents", agents)):
        text = _json.dumps(payload)
        assert "gpu-secret" not in text and "11434" not in text, name
    assert any("not available" in (e["message"] or "") for e in events)
