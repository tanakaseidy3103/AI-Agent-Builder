from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://aab:change-me@127.0.0.1:5433/aab"
    ollama_base_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen2.5-coder:latest"  # benchmark 20261106-075956: 17/35 tests vs 1/44 for llama3.2:3b
    llm_timeout_s: float = 300
    llm_seed: int = 42
    llm_num_ctx: int = 8192
    llm_num_predict: int = 3072
    storage_dir: Path = Path("data")
    sandbox_image: str = "python:3.12-slim"
    rate_limit_per_minute: int = 30
    studio_local_only: bool = True
    # Host header allowlist (DNS-rebinding defence). "testserver" is FastAPI TestClient's host.
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "[::1]", "testserver"]
    max_run_input_bytes: int = 1_000_000
    max_repair_rounds: int = 3
    max_concurrent_generations: int = 2


settings = Settings()
