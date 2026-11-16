"""ASGI entry point of the public demo:  uvicorn app.demo.app:app --host 127.0.0.1 --port 8100
Bind to 127.0.0.1 only; the tunnel (cloudflared) is the only intended client. Configuration: DEMO_* variables."""
from app.demo.config import DemoSettings
from app.demo.factory import create_demo_app

app = create_demo_app(DemoSettings())
