from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://aab:change-me@localhost:5433/aab"
    ollama_base_url: str = "http://localhost:11434"
    llm_model: str = "llama3.2:3b"
    storage_dir: Path = Path("data")
    sandbox_image: str = "python:3.12-slim"
    rate_limit_per_minute: int = 30


settings = Settings()
