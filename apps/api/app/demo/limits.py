"""In-process limits for the demo: sliding-window rate limits and non-blocking concurrency slots.
The demo runs as one process on one machine, so in-memory state is sufficient (and lost on restart, by design)."""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class RateLimiter:
    def __init__(self, clock=time.monotonic):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()
        self._clock = clock

    def hit(self, key: str, limit: int, window_s: float, what: str = "requests") -> None:
        """Count one event for `key`; raise 429 with Retry-After when more than `limit` happened within `window_s`."""
        now = self._clock()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                retry = max(1, int(window_s - (now - q[0])) + 1)
                raise HTTPException(429, f"too many {what}; try again in {retry} s", headers={"Retry-After": str(retry)})
            q.append(now)


class Slots:
    """At most `n` concurrent holders; acquiring never blocks (a busy demo answers 429 instead of piling up threads)."""

    def __init__(self, n: int):
        self._sem = threading.BoundedSemaphore(n)

    def __enter__(self):
        if not self._sem.acquire(blocking=False):
            raise HTTPException(429, "the sandbox is busy with other visitors; try again in a minute", headers={"Retry-After": "60"})
        return self

    def __exit__(self, *exc):
        self._sem.release()


def client_ip(request: Request) -> str:
    """The visitor address. The demo listens on 127.0.0.1 only, so the only direct client is the local tunnel
    (cloudflared); uvicorn's proxy-header handling (trusted for 127.0.0.1 by default) replaces it with the
    X-Forwarded-For address the tunnel supplies. Without a tunnel (local testing) this is 127.0.0.1."""
    return request.client.host if request.client else "unknown"
