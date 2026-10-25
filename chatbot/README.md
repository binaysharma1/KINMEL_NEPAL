# KinMel Chatbot

FastAPI + LangChain service behind the KinMel shopping assistant. The Express
gateway (`Backend/routes/chatRoute.js`) verifies the user's JWT and forwards the
turn here; this service never sees the token.

## Architecture

```
chatbot/
├── src/chatbot/
│   ├── main.py                 # create_app(), console entry point
│   ├── api/
│   │   ├── dependencies.py     # FastAPI dependency providers
│   │   └── v1/
│   │       ├── router.py       # combines endpoint routers
│   │       └── endpoints/
│   │           ├── chat.py     # POST /fastapi/v1/chat
│   │           └── health.py   # GET /health
│   ├── core/
│   │   ├── config.py           # typed settings from env / .env
│   │   ├── exceptions.py       # domain errors + HTTP status codes
│   │   └── logging.py          # one logging configuration
│   ├── llm/
│   │   ├── groq.py             # provider factory (swap providers here)
│   │   └── prompts.py          # versioned system prompts
│   ├── schemas/
│   │   └── chat.py             # request/response models
│   ├── services/
│   │   └── chat_service.py     # orchestration; no HTTP concerns
│   └── tools/
│       └── registry.py         # future Express-backed tools
├── tests/
│   ├── conftest.py             # app + fake model fixture
│   └── test_chat.py            # API and prompt-construction tests
├── .env.example
└── pyproject.toml
```

**Layering rule:** routes validate and translate, services orchestrate, and the
LLM package talks to providers. Add tools, RAG, or persistence in `services/`
and `tools/` without touching routes.

## Run

```bash
cd chatbot
uv sync
cp .env.example .env      # add GROQ_API_KEY
uv run uvicorn chatbot.main:app --reload --port 8000
```

Or use the console script:

```bash
uv run chatbot
```

The Express gateway expects `FASTAPI_URL=http://localhost:8000` (already set in
`Backend/.env`).

## Test and lint

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

Tests use a fake LangChain model, so they never call Groq or need an API key.

## Original planning notes

Today,I started working on some segment of it adn planning..

i decided the workflow will be like, when user try to chat with chatbot,it sends jwt token to express /api/chat then, express validate if user token is valid or not.

if user is authenticated,express route that request to the fastapi endpoint /fastapi/v1/chat ,then model give commadn to the particular designed endpoints within express.

we dont connect chatbot to all the mongodb table as it is not secure.then,express send to mongodb and extract data then ,it goes to model,model process it and give output.

this workflow is taking so much time and path,it might be slow as model has to take input ,think and generate output two time,

further in future,we can use jev like models to classify the request type from user request,then forward request in form of command to express and get result. Lets think what will happen with time..

working in real fullstack on different stack is a bit hard than i thought. but will complete slowly..no hurry LMAO>>
