"""Readiness for operators and load balancers: is each dependency of the pipeline usable right now?

`/health` stays a pure liveness probe (the process answers). `/health/ready` checks:
  database  SELECT 1                                (required: 503 when down)
  sandbox   the sandbox image exists in Docker      (generation still runs; Skills cannot reach `verified` without it)
  model     the local model server answers          (generation cannot start without it)
Only booleans are returned: no hostnames, versions or error text on a possibly public endpoint. Results are cached
for a few seconds, so polling it cannot spawn a `docker` process per request.
"""
import subprocess
import threading
import time
from collections.abc import Callable

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings

TTL_S = 10.0
_cache: dict[str, tuple[float, bool]] = {}
_lock = threading.Lock()


def _cached(key: str, check: Callable[[], bool]) -> bool:
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < TTL_S:
            return hit[1]
    try:
        ok = bool(check())
    except Exception:  # a probe must never raise into the endpoint
        ok = False
    with _lock:
        _cache[key] = (now, ok)
    return ok


def database_ok(session_factory: Callable[[], Session]) -> bool:
    with session_factory() as s:
        return s.execute(text("SELECT 1")).scalar() == 1


def sandbox_ok() -> bool:
    r = subprocess.run(["docker", "image", "inspect", settings.sandbox_image], capture_output=True, timeout=5)
    return r.returncode == 0


def model_ok(base_url: str | None = None) -> bool:
    from app.llm import ollama_auth
    r = httpx.get(f"{(base_url or settings.ollama_base_url).rstrip('/')}/api/tags", timeout=2, **ollama_auth())
    return r.status_code == 200


def readiness(session_factory: Callable[[], Session], model_check: Callable[[], bool] | None = None) -> tuple[int, dict]:
    checks = {
        "database": _cached(f"db:{id(session_factory)}", lambda: database_ok(session_factory)),
        "sandbox": _cached("sandbox", sandbox_ok),
        "model": _cached("model", model_check or model_ok),
    }
    status = "down" if not checks["database"] else "ready" if all(checks.values()) else "degraded"
    return (503 if status == "down" else 200), {"status": status, "checks": checks}


def clear_cache() -> None:
    with _lock:
        _cache.clear()
