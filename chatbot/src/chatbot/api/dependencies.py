"""FastAPI dependency providers."""

from functools import lru_cache

from chatbot.core.config import get_settings
from chatbot.llm.groq import create_chat_model
from chatbot.services.chat_service import ChatService


@lru_cache
def get_chat_service() -> ChatService:
    """Return the process-wide chat service.

    Cached so the model client is created once. Tests override this dependency
    with a fake model.
    """
    settings = get_settings()
    return ChatService(
        create_chat_model(settings),
        max_history=settings.chat_history_limit,
    )
