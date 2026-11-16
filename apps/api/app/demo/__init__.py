"""Public Demo Mode: a SEPARATE FastAPI application for anonymous visitors (see docs/DEMO.md).

It never includes the local Studio (/studio/*), the public API (/v1/*) or the office routes, uses its own database and
storage directory, isolates visitors by an anonymous session token, and bounds every expensive operation.
Start it with:  uvicorn app.demo.app:app --host 127.0.0.1 --port 8100
"""
