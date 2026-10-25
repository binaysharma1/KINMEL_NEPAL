"""Liveness endpoint.

Kept at the root (not under the versioned prefix) so orchestrators can probe it
without knowing the API version.
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness probe")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "chatbot"}
