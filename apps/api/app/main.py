from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.exc import OperationalError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api import office, public, studio
from app.config import settings
from app.db import SessionLocal
from app.skills.pipeline import fail_interrupted_jobs


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        with SessionLocal() as s:
            fail_interrupted_jobs(s)
    except OperationalError:
        pass  # DB not up yet: requests will report it; never block startup on the sweep
    yield


app = FastAPI(title="AI Agent Builder API", version="0.1.0", lifespan=lifespan)
# The Studio is unauthenticated and trusts loopback clients. Without a Host allowlist, a web page using DNS
# rebinding (evil.example -> 127.0.0.1) would reach it from the user's browser as a "local" client.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.include_router(studio.router)
app.include_router(public.router)
app.include_router(office.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
