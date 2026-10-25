"""Groq-backed chat model factory.

Swapping providers later should only require another module in this package
that returns a LangChain `BaseChatModel`.
"""

from langchain_groq import ChatGroq

from chatbot.core.config import Settings, get_settings
from chatbot.core.exceptions import ConfigurationError


def create_chat_model(settings: Settings | None = None) -> ChatGroq:
    """Build the Groq chat client from application settings."""
    settings = settings or get_settings()
    api_key = settings.groq_api_key.get_secret_value().strip() if settings.groq_api_key else ""

    if not api_key:
        raise ConfigurationError(
            "GROQ_API_KEY is not configured. Add it to chatbot/.env (see .env.example)."
        )

    return ChatGroq(
        model=settings.groq_model,
        api_key=api_key,
        temperature=settings.groq_temperature,
        reasoning_effort=settings.groq_reasoning_effort,
        request_timeout=settings.llm_timeout_seconds,
        max_retries=settings.groq_max_retries,
    )
