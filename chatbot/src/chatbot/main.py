"""FastAPI assistant service.

Called by the Express gateway (`Backend/routes/chatRoute.js`) after it has
verified the user's JWT. Express sends the turn plus a little profile context,
but never the JWT itself, so this service never touches authentication.
"""

from typing import Literal

from fastapi import FastAPI
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from pydantic import BaseModel, Field

from chatbot.chat_model import DEFAULT_SYSTEM_PROMPT, get_reply

app = FastAPI(title="KinMel Assistant")


class ChatTurn(BaseModel):
    """One earlier turn, in the shape the frontend already keeps."""

    sender: Literal["user", "bot"]
    text: str = Field(min_length=1, max_length=2000)


class ChatUser(BaseModel):
    """Profile fields looked up by Express from the verified user id."""

    id: str | None = None
    name: str | None = None
    email: str | None = None


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    sessionId: str | None = None
    user: ChatUser | None = None


class ChatOut(BaseModel):
    reply: str


def _system_prompt(user: ChatUser | None) -> str:
    prompt = DEFAULT_SYSTEM_PROMPT
    if user and user.name:
        prompt += f" The signed-in customer's name is {user.name}."
    return prompt


def _to_messages(history: list[ChatTurn], message: str) -> list[BaseMessage]:
    """Convert the widget's turns into LangChain messages.

    The widget adds the user's message to its history before sending, so the
    last turn is usually the same text as `message`; drop it to avoid asking
    the same thing twice.
    """
    messages: list[BaseMessage] = [
        HumanMessage(content=turn.text) if turn.sender == "user" else AIMessage(content=turn.text)
        for turn in history
    ]

    if messages and isinstance(messages[-1], HumanMessage) and messages[-1].content == message:
        messages.pop()

    return messages


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/fastapi/v1/chat", response_model=ChatOut)
async def chat(body: ChatIn) -> ChatOut:
    message = body.message.strip()
    if not message:
        # Express trims too, but keep direct callers honest.
        return ChatOut(reply="Please type a message.")

    reply = await get_reply(
        message,
        history=_to_messages(body.history, message),
        system_prompt=_system_prompt(body.user),
    )
    return ChatOut(reply=reply)
