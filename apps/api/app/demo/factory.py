"""Builds the demo FastAPI application. Kept separate from app.demo.app so tests can build it with their own database."""
import threading
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import models  # noqa: F401  (registers the shared tables on Base.metadata)
from app.config import settings
from app.db import Base
from app.readiness import readiness
from app.demo.cleanup import cleanup_expired
from app.demo.config import DemoSettings
from app.demo.limits import RateLimiter, Slots
from app.demo.models import DemoBase
from app.demo.routes import build_router, ollama_checker
from app.demo.worker import GenerationWorker
from app.llm import LLMProvider, OllamaProvider
from app.main import BodyLimit
from app.skills.pipeline import fail_interrupted_jobs


def create_demo_app(cfg: DemoSettings, *, session_factory: Callable[[], Session] | None = None,
                    provider_factory: Callable[[], LLMProvider] | None = None,
                    ollama_ready: Callable[[], bool] | None = None, create_tables: bool = True,
                    background: bool = True) -> FastAPI:
    if session_factory is None:
        cfg.check_isolated()  # never start against the owner's local database or storage
        engine = create_engine(cfg.database_url, pool_pre_ping=True)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    if cfg.storage_dir is not None:
        settings.storage_dir = cfg.storage_dir  # this process serves only the demo
    settings.llm_model = cfg.model
    settings.max_request_bytes = cfg.max_request_bytes
    if create_tables:
        bind = session_factory().get_bind()
        Base.metadata.create_all(bind)  # shared Skill tables (fresh demo database) — never run against the local one
        DemoBase.metadata.create_all(bind)

    provider_factory = provider_factory or (lambda: OllamaProvider(settings.ollama_base_url, cfg.model))
    ollama_ready = ollama_ready or ollama_checker(cfg.model)
    worker = GenerationWorker(session_factory, provider_factory, cfg.max_concurrent_generations, cfg.job_timeout_s)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if background:
            with session_factory() as s:
                fail_interrupted_jobs(s)
            threading.Thread(target=_maintenance, args=(cfg, session_factory), daemon=True, name="demo-maintenance").start()
        yield

    app = FastAPI(title="AI Agent Builder — public demo", version="0.1.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)  # no public API schema
    app.state.worker, app.state.session_factory = worker, session_factory
    app.add_middleware(BodyLimit)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=cfg.hosts())
    # CORS last = outermost, so even 4xx/429 answers carry the headers the browser needs to show the message
    app.add_middleware(CORSMiddleware, allow_origins=cfg.origins(), allow_credentials=False,
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Demo-Session", "X-Demo-Code"],
                       expose_headers=["Retry-After", "Content-Disposition"], max_age=600)
    app.include_router(build_router(cfg, session_factory, worker, RateLimiter(), Slots(cfg.sandbox_concurrency), ollama_ready))

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "mode": "demo"}

    if cfg.static_dir is not None:
        # same-origin site (homelab): the built frontend at "/", after every API route so /demo/* and /health win.
        # Anything else (e.g. /studio/*, /v1/*, /docs) is not a file here and answers 404.
        from fastapi.staticfiles import StaticFiles

        @app.middleware("http")
        async def security_headers(request, call_next):
            response = await call_next(request)
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "no-referrer")
            response.headers.setdefault("X-Frame-Options", "DENY")
            return response

    @app.get("/health/ready")
    def health_ready() -> JSONResponse:
        """Booleans only (public endpoint): database, sandbox image, model. Cached, so it cannot be used to spawn work."""
        code, body = readiness(session_factory, ollama_ready)
        return JSONResponse({**body, "mode": "demo"}, status_code=code)

    if cfg.static_dir is not None:
        app.mount("/", StaticFiles(directory=str(cfg.static_dir), html=True), name="frontend")
    return app


def _maintenance(cfg: DemoSettings, factory: Callable[[], Session]) -> None:
    """Seed the read-only examples once, then remove expired visitor data every hour."""
    import time

    if cfg.seed_examples:
        try:
            from app.skills.reference import seed
            with factory() as s:
                seed(s)
        except Exception as e:  # Docker may be off; the demo still serves, without examples
            print(f"[demo] example seeding skipped: {type(e).__name__}: {e}", flush=True)
    while True:
        try:
            cleanup_expired(factory, cfg.data_ttl_hours)
        except Exception as e:
            print(f"[demo] cleanup failed: {type(e).__name__}: {e}", flush=True)
        time.sleep(3600)
