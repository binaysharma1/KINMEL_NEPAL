
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from chatbot import __version__
from chatbot.api.v1.endpoints.health import router as health_router
from chatbot.api.v1.router import api_router
from chatbot.core.config import get_settings
from chatbot.core.exceptions import ChatbotError
from chatbot.core.logging import configure_logging

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
   
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description="KinMel's shopping assistant, called by the Express gateway.",
    )
    app.include_router(health_router)
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.exception_handler(ChatbotError)
    async def handle_chatbot_error(_request: Request, exc: ChatbotError) -> JSONResponse:
        logger.error("Chatbot error: %s", exc)
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    return app


app = create_app()


def run() -> None:

    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "chatbot.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "development",
    )
