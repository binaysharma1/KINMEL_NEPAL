"""Combine the v1 endpoint routers."""

from fastapi import APIRouter

from chatbot.api.v1.endpoints import chat

api_router = APIRouter()
api_router.include_router(chat.router)
