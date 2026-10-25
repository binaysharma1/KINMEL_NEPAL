"""Shared test fixtures."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from chatbot.api.dependencies import get_chat_service
from chatbot.main import create_app
from chatbot.services.chat_service import ChatService


@pytest.fixture
def client() -> Iterator[TestClient]:
    """An app wired to a deterministic fake model."""
    app = create_app()
    app.dependency_overrides[get_chat_service] = lambda: ChatService(
        FakeListChatModel(responses=["Test reply"]),
    )
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
