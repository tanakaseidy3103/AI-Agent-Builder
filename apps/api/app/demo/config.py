"""Demo Mode settings (environment variables prefixed DEMO_, or apps/api/.env.demo). Nothing here affects local mode."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class DemoConfigError(RuntimeError):
    """Raised at startup when the demo would not be isolated from the owner's local data."""


class DemoSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DEMO_", env_file=".env.demo", extra="ignore")

    # isolation: required, no defaults, so the demo can never fall back to the local database or storage
    database_url: str = ""
    storage_dir: Path | None = None
    # browser origins allowed to call the demo API (the published frontend), comma separated, exact match
    allowed_origins: str = ""
    # Optional: serve the built demo frontend (apps/web dist, built with VITE_DEMO_MODE=true VITE_API_BASE=/) from this
    # same process, so ONE tunnel URL carries the site and its API (same origin: no CORS, no rebuild when a Quick
    # Tunnel URL changes). Empty = API only, as before.
    static_dir: Path | None = None
    # Optional shared code for presentations: when set, creating a Skill and re-running its tests (the actions that
    # run the model and the sandbox) need it in the X-Demo-Code header. Browsing and examples stay open.
    access_code: str = ""
    # Host headers accepted (the tunnel hostname); "*.trycloudflare.com" covers Cloudflare Quick Tunnels
    allowed_hosts: str = "*.trycloudflare.com,localhost,127.0.0.1"

    model: str = "qwen2.5-coder:latest"  # pinned: visitors cannot choose another (possibly larger) model
    max_prompt_chars: int = 1000
    max_request_bytes: int = 64_000
    max_concurrent_generations: int = 1  # local CPU/GPU runs one model at a time well
    queue_max: int = 5  # waiting + running generations; more are refused with 429
    generations_per_session: int = 3  # per visitor session lifetime
    sessions_per_ip_per_hour: int = 5
    rate_limit_per_minute: int = 240  # per IP and per session; the UI polls about twice per second during a run
    sandbox_concurrency: int = 2  # concurrent visitor-triggered validations
    job_timeout_s: int = 1200  # wall clock for one generation (LLM calls are refused after this)
    data_ttl_hours: int = 24  # sessions and their Skills are deleted afterwards
    seed_examples: bool = True  # import the human-written reference Skills as read-only examples at startup

    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]

    def hosts(self) -> list[str]:
        return [h.strip() for h in self.allowed_hosts.split(",") if h.strip()]

    def check_isolated(self) -> None:
        """Refuse to start unless the demo has its own database and storage. A shared database would expose the
        owner's Skills, prompts and audit log (which contains local paths) to anonymous visitors."""
        if not self.database_url:
            raise DemoConfigError("DEMO_DATABASE_URL is required (a separate database, e.g. aab_demo)")
        url = make_url(self.database_url)
        name = (url.database or "").lower()
        if "demo" not in Path(name).name:
            raise DemoConfigError(f"DEMO_DATABASE_URL must point to a dedicated demo database (name containing 'demo'), got {Path(name).name!r}")
        if self.storage_dir is None or Path(self.storage_dir).resolve() == Path("data").resolve():
            raise DemoConfigError("DEMO_STORAGE_DIR is required and must differ from the local storage directory")
        if self.static_dir is not None and not (Path(self.static_dir) / "index.html").is_file():
            raise DemoConfigError(f"DEMO_STATIC_DIR has no index.html: {self.static_dir} (build the demo frontend first)")
        if self.access_code and len(self.access_code) < 6:
            raise DemoConfigError("DEMO_ACCESS_CODE must have at least 6 characters")
        if any(o == "*" for o in self.origins()):
            raise DemoConfigError("DEMO_ALLOWED_ORIGINS must list exact origins; '*' is not allowed")
