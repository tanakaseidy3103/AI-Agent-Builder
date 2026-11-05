from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://aab:change-me@localhost:5433/aab"
    ollama_base_url: str = "http://localhost:11434"


settings = Settings()
