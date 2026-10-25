"""Chat API contracts.

These mirror the payload the Express gateway sends. Express validates and
trims the same fields, but the service must not trust that boundary.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ChatTurn(BaseModel):
    """One earlier turn, in the shape the frontend keeps."""

    sender: Literal["user", "bot"]
    text: str = Field(min_length=1, max_length=2000)


class ChatUser(BaseModel):
    """Profile fields looked up by Express from the verified user id."""

    id: str | None = Field(default=None, max_length=100)
    name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=254)


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    session_id: str | None = Field(default=None, alias="sessionId", max_length=100)
    user: ChatUser | None = None


class ChatResponse(BaseModel):
    reply: str
