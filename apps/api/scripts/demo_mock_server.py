"""The REAL demo application (app.demo) for browser tests, with a MOCKED LLM. No Ollama, no network model calls.

    .venv/Scripts/python.exe scripts/demo_mock_server.py            # http://127.0.0.1:8100

Real: every demo route, sessions, isolation, limits, CORS/Host checks, the pipeline, static validation, the Docker
sandbox and the read-only examples (seeded at startup, needs Docker). Mocked: only the model's replies (the fixture
React-perf Skill used by the backend tests), named "fake:scripted (MOCKED LLM)" everywhere.
Data: a fresh SQLite database and storage under <repo>/test-results/demo-mock/ (deleted on start).
"""
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# A fresh folder per start: deleting the previous one in place failed on Windows when a sync client (OneDrive) held a
# handle on it (2026-11-14), which stopped the harness. Older runs are removed best-effort.
RUNS = ROOT / "test-results" / "demo-mock"
RUNS.mkdir(parents=True, exist_ok=True)
for old in RUNS.iterdir():
    shutil.rmtree(old, ignore_errors=True)
DATA = RUNS / f"run-{os.getpid()}"
DATA.mkdir()
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.demo.config import DemoSettings  # noqa: E402
from app.demo.factory import create_demo_app  # noqa: E402
from app.llm import FakeProvider  # noqa: E402
from tests.fixtures import CODE_RESPONSES  # noqa: E402


class MockedLLM(FakeProvider):
    name = "fake:scripted (MOCKED LLM)"


def main() -> None:
    port = int(os.environ.get("PORT", "8100"))
    origins = os.environ.get("DEMO_ALLOWED_ORIGINS", "http://127.0.0.1:4173,http://localhost:4173")
    cfg = DemoSettings(database_url=f"sqlite:///{(DATA / 'demo.sqlite').as_posix()}", storage_dir=DATA / "storage",
                       allowed_origins=origins, allowed_hosts="127.0.0.1,localhost", model="fake:scripted (MOCKED LLM)",
                       generations_per_session=int(os.environ.get("DEMO_GENERATIONS_PER_SESSION", "3")),
                       # every browser test comes from 127.0.0.1, so the per-IP session limit (5/h in production,
                       # covered by tests/test_demo.py) would block the suite itself; raise it for this harness only
                       sessions_per_ip_per_hour=int(os.environ.get("DEMO_SESSIONS_PER_IP_PER_HOUR", "200")),
                       # seeded below, before serving: see the comment there
                       seed_examples=False)
    cfg.check_isolated()
    engine = create_engine(cfg.database_url, connect_args={"check_same_thread": False})
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    # This harness starts from an empty database every time, so the examples must be validated in the sandbox on every
    # start. In the app that happens in a background thread after /health is up (right for production, where the
    # database persists and seeding is a no-op after the first start). Here the browser tests begin as soon as /health
    # answers, so on a slow machine they raced the seeding (2026-11-14: >120 s). Seed first, then serve.
    import time
    from app.db import Base  # tables must exist before seeding
    from app.demo.models import DemoBase
    from app.skills.reference import seed
    from app.config import settings
    settings.storage_dir = cfg.storage_dir
    Base.metadata.create_all(engine)
    DemoBase.metadata.create_all(engine)
    t0 = time.monotonic()
    with factory() as s:
        seeded = seed(s)
    print(f"examples seeded before serving: {[(x['slug'], x['status']) for x in seeded]} in {time.monotonic() - t0:.1f}s", flush=True)
    app = create_demo_app(cfg, session_factory=factory, provider_factory=lambda: MockedLLM(list(CODE_RESPONSES)),
                          ollama_ready=lambda: True)
    print(f"DEMO (MOCKED LLM) on http://127.0.0.1:{port} origins={origins} data={DATA}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
