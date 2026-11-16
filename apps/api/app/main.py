from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api import office, project_memory, public, studio
from app.config import settings
from app.db import SessionLocal, get_session_factory
from app.readiness import readiness
from app.skills.pipeline import fail_interrupted_jobs


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        with SessionLocal() as s:
            fail_interrupted_jobs(s)
    except OperationalError:
        pass  # DB not up yet: requests will report it; never block startup on the sweep
    yield


class BodyLimit:
    """Refuse request bodies above settings.max_request_bytes while they stream in (Content-Length or chunked).
    Without it a request is read fully into memory before any endpoint-level size check runs."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = settings.max_request_bytes
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            return await self._reject(send)
        # Read the body here (bounded), then replay it. Raising from inside receive() would not work: FastAPI turns
        # any error while reading the body into a 400.
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return  # client disconnected
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > limit:
                return await self._reject(send)
            chunks.append(chunk)
            if not message.get("more_body"):
                break
        body, replayed = b"".join(chunks), False

        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()  # after the body: wait for disconnect like the real channel

        await self.app(scope, replay, send)

    @staticmethod
    async def _reject(send):
        body = b'{"detail":"request body too large"}'
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


app = FastAPI(title="AI Agent Builder API", version="0.1.0", lifespan=lifespan)
app.add_middleware(BodyLimit)
# The Studio is unauthenticated and trusts loopback clients. Without a Host allowlist, a web page using DNS
# rebinding (evil.example -> 127.0.0.1) would reach it from the user's browser as a "local" client.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.include_router(studio.router)
app.include_router(public.router)
app.include_router(office.router)
app.include_router(project_memory.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready(factory=Depends(get_session_factory)) -> JSONResponse:
    """Dependencies of the pipeline (database, Docker sandbox image, local model). 503 only when the database is down."""
    code, body = readiness(factory)
    return JSONResponse(body, status_code=code)
