"""API and service behaviour.

The HTTP tests use a fake model so they never touch Groq; the service tests use
a recording model so prompt construction can be asserted directly.
"""

import asyncio
from collections.abc import Sequence

from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from chatbot.schemas.chat import ChatRequest, ChatTurn, ChatUser
from chatbot.services.chat_service import ChatService


class RecordingChatModel:
    """Stands in for a LangChain chat model and records the prompt it saw."""

    def __init__(self, reply: str = "ok") -> None:
        self.reply = reply
        self.messages: Sequence[BaseMessage] = []

    async def ainvoke(self, messages: Sequence[BaseMessage], config: object = None) -> AIMessage:
        self.messages = list(messages)
        return AIMessage(content=self.reply)


def test_health(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_chat_returns_model_reply(client: TestClient) -> None:
    response = client.post(
        "/fastapi/v1/chat",
        json={
            "message": "Hi",
            "history": [],
            "sessionId": "user-1",
            "user": {"id": "user-1", "name": "Sam"},
        },
    )

    assert response.status_code == 200
    assert response.json() == {"reply": "Test reply"}


def test_empty_message_is_rejected(client: TestClient) -> None:
    response = client.post("/fastapi/v1/chat", json={"message": ""})

    assert response.status_code == 422


def test_history_is_mapped_and_current_turn_deduped() -> None:
    llm = RecordingChatModel()
    service = ChatService(llm)  # type: ignore[arg-type]
    request = ChatRequest(
        message="What is my name?",
        history=[
            ChatTurn(sender="user", text="My name is Sam."),
            ChatTurn(sender="bot", text="Nice to meet you, Sam!"),
            ChatTurn(sender="user", text="What is my name?"),
        ],
        user=ChatUser(id="user-1", name="Sam"),
    )

    reply = asyncio.run(service.reply(request))

    assert reply == "ok"
    assert [type(message) for message in llm.messages] == [
        SystemMessage,
        HumanMessage,
        AIMessage,
        HumanMessage,
    ]
    assert "Sam" in llm.messages[0].content
    assert llm.messages[-1].content == "What is my name?"
    # The duplicated current turn was dropped, not sent twice.
    assert sum(message.content == "What is my name?" for message in llm.messages) == 1


def test_old_history_is_trimmed() -> None:
    llm = RecordingChatModel()
    service = ChatService(llm, max_history=2)  # type: ignore[arg-type]
    history = [
        ChatTurn(sender="user" if index % 2 == 0 else "bot", text=f"turn {index}")
        for index in range(10)
    ]

    asyncio.run(service.reply(ChatRequest(message="latest", history=history)))

    # System prompt, the two most recent turns, and the current message.
    assert len(llm.messages) == 4
    assert llm.messages[-2].content == "turn 9"
    assert llm.messages[-1].content == "latest"
