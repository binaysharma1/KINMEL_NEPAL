"""Conversation orchestration.

The service owns message construction and provider calls. The API layer should
only validate the request and translate the result; tools, RAG, and persistence
will plug in here without touching the routes.
"""

import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from chatbot.core.exceptions import AssistantUnavailableError
from chatbot.llm.prompts import build_system_prompt
from chatbot.schemas.chat import ChatRequest

logger = logging.getLogger(__name__)


class ChatService:
    """Turn a chat request into one assistant reply."""

    def __init__(self, llm: BaseChatModel, *, max_history: int = 20) -> None:
        if max_history < 1:
            raise ValueError("max_history must be at least 1")
        self._llm = llm
        self._max_history = max_history

    async def reply(self, request: ChatRequest) -> str:
        message = request.message.strip()
        if not message:
            return "Please type a message."

        user_id = request.user.id if request.user else None
        logger.info("Chat turn received (user_id=%s, history=%d)", user_id, len(request.history))

        try:
            response = await self._llm.ainvoke(self._build_messages(request, message))
        except Exception as exc:
            logger.exception("Chat model invocation failed (user_id=%s)", user_id)
            raise AssistantUnavailableError(
                "The assistant is temporarily unavailable. Please try again."
            ) from exc

        return _message_text(response)

    def _build_messages(self, request: ChatRequest, message: str) -> list[BaseMessage]:
        """Build the prompt, trimming old turns and the duplicated current one.

        The widget adds the user's message to its history before sending, so the
        last turn is usually the same text as `message`.
        """
        recent = request.history[-self._max_history :]
        messages: list[BaseMessage] = [
            SystemMessage(content=build_system_prompt(request.user.name if request.user else None))
        ]

        messages.extend(
            HumanMessage(content=turn.text)
            if turn.sender == "user"
            else AIMessage(content=turn.text)
            for turn in recent
        )

        if (
            len(messages) > 1
            and isinstance(messages[-1], HumanMessage)
            and messages[-1].content == message
        ):
            messages.pop()

        messages.append(HumanMessage(content=message))
        return messages


def _message_text(message: BaseMessage) -> str:
    """Return plain text, ignoring non-text content blocks."""
    content = message.content
    if isinstance(content, str):
        return content

    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "".join(parts)
