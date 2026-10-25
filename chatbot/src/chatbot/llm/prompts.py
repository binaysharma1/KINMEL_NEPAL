"""System prompts.

Keeping prompts here makes them reviewable and easy to version separately from
the transport and orchestration layers.
"""

BASE_SYSTEM_PROMPT = (
    "You are KinMel's friendly shopping assistant for an e-commerce store. "
    "Keep answers short and helpful. "
    "You cannot look up live products, prices, stock, orders, or account data yet, "
    "so never invent them. If asked for store-specific facts you do not know, say "
    "you cannot check that yet and suggest contacting support."
)


def build_system_prompt(customer_name: str | None = None) -> str:
    """Return the system prompt, personalised when we know the customer."""
    if not customer_name:
        return BASE_SYSTEM_PROMPT
    return f"{BASE_SYSTEM_PROMPT} The signed-in customer's name is {customer_name}."
