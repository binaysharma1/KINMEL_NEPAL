"""Chat endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends

from chatbot.api.dependencies import get_chat_service
from chatbot.schemas.chat import ChatRequest, ChatResponse
from chatbot.services.chat_service import ChatService

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse, summary="Send one chat turn")
async def send_message(
    payload: ChatRequest,
    service: Annotated[ChatService, Depends(get_chat_service)],
) -> ChatResponse:
    """Return the assistant's reply to a single user message."""
    return ChatResponse(reply=await service.reply(payload))
