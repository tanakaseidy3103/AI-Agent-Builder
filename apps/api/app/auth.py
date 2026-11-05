"""API keys for the public /v1 API, and the local-only guard for Studio routes."""
import hashlib
import secrets
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.models import ApiKey

KEY_PREFIX = "aab_"


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def new_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


# shortcut: in-process sliding window, per worker; move to Redis/Postgres when running >1 worker.
_hits: dict[str, deque] = defaultdict(deque)


def _rate_limit(key_id: str) -> None:
    now, q = time.monotonic(), _hits[key_id]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.rate_limit_per_minute:
        raise HTTPException(429, "rate limit exceeded", headers={"Retry-After": "60"})
    q.append(now)


def require_api_key(request: Request, s: Session = Depends(get_session)) -> ApiKey:
    header = request.headers.get("authorization", "")
    raw = header[7:] if header.lower().startswith("bearer ") else ""
    if not raw.startswith(KEY_PREFIX):
        raise HTTPException(401, "missing or malformed API key", headers={"WWW-Authenticate": "Bearer"})
    key = s.scalar(select(ApiKey).where(ApiKey.key_hash == hash_key(raw)))
    if key is None or key.revoked_at is not None:
        raise HTTPException(401, "invalid or revoked API key", headers={"WWW-Authenticate": "Bearer"})
    _rate_limit(key.id)
    return key


LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def require_local(request: Request) -> None:
    # Studio has no user accounts yet (Phase 1). Until then it only serves the local machine.
    if settings.studio_local_only and (request.client is None or request.client.host not in LOOPBACK):
        raise HTTPException(403, "Studio API is local-only until user authentication exists")
