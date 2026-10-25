"""Domain errors and their HTTP status codes."""

from http import HTTPStatus


class ChatbotError(Exception):
    """Base error for failures that should be reported to the gateway."""

    status_code: int = HTTPStatus.INTERNAL_SERVER_ERROR


class ConfigurationError(ChatbotError):
    """The service is misconfigured (for example, a missing API key)."""

    status_code = HTTPStatus.INTERNAL_SERVER_ERROR


class AssistantUnavailableError(ChatbotError):
    """The model provider could not produce a reply."""

    status_code = HTTPStatus.BAD_GATEWAY
