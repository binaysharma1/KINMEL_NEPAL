"""Tools the assistant can call.

Today this is a registry only. When the Express command endpoints are ready,
register a tool here and let the service expose it to the model.
"""

from chatbot.tools.registry import Tool, ToolRegistry

__all__ = ["Tool", "ToolRegistry"]
