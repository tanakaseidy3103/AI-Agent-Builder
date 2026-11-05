from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://aab:change-me@127.0.0.1:5433/aab"
    ollama_base_url: str = "http://127.0.0.1:11434"
    llm_model: str = "llama3.2:3b"
    storage_dir: Path = Path("data")
    sandbox_image: str = "python:3.12-slim"
    rate_limit_per_minute: int = 30
    studio_local_only: bool = True
    max_run_input_bytes: int = 1_000_000
    max_repair_rounds: int = 3


settings = Settings()
