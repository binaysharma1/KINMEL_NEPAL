"""Groq-backed chat model.

Simple conversational boilerplate built on LangChain. This is the starting
point; tool calling and the Express command loop can be added later.

Setup:
    1. Copy `.env.example` to `.env`
    2. Set `GROQ_API_KEY` (get one at https://console.groq.com/keys)

Usage:
    from chatbot.chat_model import ChatModel, get_reply

    # Stateful, multi-turn conversation
    chat = ChatModel()
    reply = await chat.ainvoke("Hello!")

    # One-off reply (pass `history` to keep context)
    reply = await get_reply("Hello!")
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Sequence

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_groq import ChatGroq

load_dotenv()

DEFAULT_MODEL = "openai/gpt-oss-120b"
DEFAULT_SYSTEM_PROMPT = (
    "You are KinMel's friendly shopping assistant for an e-commerce store. "
    "Keep answers short and helpful. "
    "You cannot look up live products, prices, stock, orders, or account data yet, "
    "so never invent them. If asked for store-specific facts you do not know, say "
    "you cannot check that yet and suggest contacting support."
)


def _build_llm() -> ChatGroq:
    """Create the Groq client from environment configuration."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Add it to chatbot/.env (see "
            ".env.example) or export it in your shell."
        )

    return ChatGroq(
        model=os.getenv("GROQ_MODEL", DEFAULT_MODEL),
        api_key=api_key,
        temperature=float(os.getenv("GROQ_TEMPERATURE", "0.7")),
        # GPT-OSS is a reasoning model; "low" keeps replies fast. Use
        # "medium"/"high" in GROQ_REASONING_EFFORT for harder questions.
        reasoning_effort=os.getenv("GROQ_REASONING_EFFORT", "low"),
    )


def _text(message: BaseMessage) -> str:
    """Return the plain text of a message, ignoring non-text content blocks."""
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


class ChatModel:
    """A single, stateful conversation with the model."""

    def __init__(
        self,
        system_prompt: str | None = DEFAULT_SYSTEM_PROMPT,
        llm: ChatGroq | None = None,
    ) -> None:
        self.llm = llm or _build_llm()
        self.history: list[BaseMessage] = []
        if system_prompt:
            self.history.append(SystemMessage(content=system_prompt))

    async def ainvoke(self, message: str) -> str:
        """Send a user message and return the assistant's reply."""
        self.history.append(HumanMessage(content=message))
        response = await self.llm.ainvoke(self.history)
        self.history.append(response)
        return _text(response)

    async def astream(self, message: str) -> AsyncIterator[str]:
        """Send a user message and yield the reply in chunks."""
        self.history.append(HumanMessage(content=message))
        chunks: list[str] = []
        async for chunk in self.llm.astream(self.history):
            text = _text(chunk)
            if text:
                chunks.append(text)
                yield text
        self.history.append(AIMessage(content="".join(chunks)))

    def reset(self) -> None:
        """Clear the conversation, keeping the system prompt."""
        self.history = self.history[:1]


async def get_reply(
    message: str,
    history: Sequence[BaseMessage] | None = None,
    system_prompt: str | None = DEFAULT_SYSTEM_PROMPT,
) -> str:
    """Stateless one-off reply.

    Pass already-existing `history` (e.g. from the request) to keep context
    without holding server-side state.
    """
    messages: list[BaseMessage] = []
    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    if history:
        messages.extend(history)
    messages.append(HumanMessage(content=message))

    response = await _build_llm().ainvoke(messages)
    return _text(response)
