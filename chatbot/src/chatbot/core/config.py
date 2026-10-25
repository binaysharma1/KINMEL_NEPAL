"""Typed application settings.

All values come from environment variables, with `.env` as the development
default. Names are matched case-insensitively, so `GROQ_API_KEY` populates
`groq_api_key`.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "KinMel Assistant"
    environment: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    api_v1_prefix: str = "/fastapi/v1"

    # LLM provider
    groq_api_key: SecretStr | None = None
    groq_model: str = "openai/gpt-oss-120b"
    groq_temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    groq_reasoning_effort: Literal["low", "medium", "high"] = "low"
    groq_max_retries: int = Field(default=2, ge=0, le=10)
    llm_timeout_seconds: float = Field(default=30.0, gt=0)

    # Conversation
    chat_history_limit: int = Field(default=20, ge=1, le=40)


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
