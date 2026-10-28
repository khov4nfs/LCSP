"""Provider-side response-schema compatibility for native structured output."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.structured_output import (
    AutoStrategy,
    ProviderStrategy,
    ToolStrategy,
)
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import BaseModel

from middleware.tool_contracts import ORIGINAL_REQUEST_TOOLS

GEMINI_MODULE_PREFIX = "langchain_google_genai."
GEMINI_DISABLE_AUTOMATIC_FUNCTION_CALLING = {"disable": True}
GEMINI_SPECIAL_TOOL_KEYS = frozenset(
    {
        "google_search_retrieval",
        "google_search",
        "google_maps",
        "code_execution",
        "url_context",
        "computer_use",
    }
)


def gemini_null_types(schema: Any) -> Any:
    """Preserve JSON null through the SDK converter's repeated property traversal."""
    if isinstance(schema, dict):
        return {
            key: "NULL" if key == "type" and value == "null" else gemini_null_types(value)
            for key, value in schema.items()
        }
    if isinstance(schema, list):
        return [gemini_null_types(value) for value in schema]
    return schema


def gemini_nullable_tools(model: Any, tools: list[Any]) -> list[Any] | None:
    """Translate only the provider dialect; keep canonical fields and bounds intact."""
    if not type(model).__module__.startswith(GEMINI_MODULE_PREFIX):
        return None
    converted = []
    changed = False
    for tool in tools:
        schema = tool if isinstance(tool, dict) else convert_to_openai_tool(tool)
        native = gemini_null_types(schema)
        converted.append(native if native != schema else tool)
        changed = changed or native != schema
    return converted if changed else None


def relax_array_upper_bounds(schema: Any) -> Any:
    """Return the provider-facing Gemini schema without unsupported constraints.

    Gemini expands positive `maxItems` bounds aggressively and the Google SDK warns
    that `additionalProperties` is unsupported. Both are removed only from the copy
    sent to Gemini. `maxItems: 0` is preserved because it is a structural "must be
    empty" contract, not an expansion-cost bound.

    The canonical Pydantic schema is never mutated, so LCSP still validates all array
    bounds and extra-field constraints after the provider returns structured output.
    """
    if isinstance(schema, dict):
        return {
            key: relax_array_upper_bounds(value)
            for key, value in schema.items()
            if key != "additionalProperties"
            and not (key == "maxItems" and value != 0)
        }
    if isinstance(schema, list):
        return [relax_array_upper_bounds(value) for value in schema]
    return schema


def gemini_compatible_tools(model: Any, tools: list[Any]) -> list[Any] | None:
    """Return Gemini-bound tool definitions without unsupported JSON Schema keys."""
    if not type(model).__module__.startswith(GEMINI_MODULE_PREFIX):
        return None
    if not tools:
        return None

    converted: list[Any] = []
    changed = False
    for tool in tools:
        if isinstance(tool, dict) and any(
            key in tool and tool.get(key) is not None
            for key in GEMINI_SPECIAL_TOOL_KEYS
        ):
            converted.append(tool)
            continue

        provider_tool = tool if isinstance(tool, dict) else convert_to_openai_tool(tool)
        relaxed = gemini_null_types(relax_array_upper_bounds(provider_tool))
        converted.append(relaxed)
        changed = changed or relaxed != provider_tool or not isinstance(tool, dict)

    return converted if changed else None


def _json_schema_of(schema: Any) -> dict[str, Any] | None:
    """Return the JSON schema of a structured-output schema, or None if unavailable."""
    if isinstance(schema, dict):
        return schema
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        return schema.model_json_schema()
    return None


def _rebuild_response_format(
    output_format: Any,
    relaxed: dict[str, Any],
    *,
    changed: bool,
) -> Any | None:
    """Build the provider-facing structured-output strategy for the relaxed schema.

    LangChain re-adds the original structured-output tools when a ToolStrategy reaches
    the final model binding step. That bypasses request.tools overrides and reintroduces
    unsupported keys such as ``additionalProperties`` into Gemini function schemas.
    Gemini supports native JSON-schema output, so switch only Gemini-facing
    ToolStrategy requests to ProviderStrategy after relaxation.
    """
    if isinstance(output_format, (AutoStrategy, ToolStrategy)):
        return ProviderStrategy(relaxed)
    if isinstance(output_format, ProviderStrategy):
        return ProviderStrategy(relaxed) if changed else None
    if isinstance(output_format, dict):
        return relaxed if changed else None
    if isinstance(output_format, type):
        return relaxed if changed else None
    return type(output_format)(relaxed) if changed else None


def gemini_compatible_response_format(model: Any, output_format: Any) -> Any | None:
    """Return a relaxed response format for Gemini, or None when nothing changes."""
    if not type(model).__module__.startswith(GEMINI_MODULE_PREFIX):
        return None
    if output_format is None:
        return None
    schema = getattr(output_format, "schema", output_format)
    json_schema = _json_schema_of(schema)
    if json_schema is None:
        return None
    relaxed = relax_array_upper_bounds(json_schema)
    return _rebuild_response_format(
        output_format,
        relaxed,
        changed=relaxed != json_schema,
    )


def gemini_structured_model_settings(model: Any, output_format: Any, current: Any) -> dict[str, Any] | None:
    """Return call-time settings that keep Gemini native JSON output text-only.

    Google GenAI enables Automatic Function Calling by default. Native structured output
    in LangChain still binds application tools, so Gemini can emit a function_call part
    instead of pure JSON. The SDK then concatenates only text parts, which corrupts the
    JSON response before Pydantic sees it. Disabling AFC is a request setting, not a
    constructor field on ChatGoogleGenerativeAI, so it must be applied through
    ModelRequest.model_settings.
    """
    if not type(model).__module__.startswith(GEMINI_MODULE_PREFIX):
        return None
    if output_format is None:
        return None
    settings = dict(current) if isinstance(current, dict) else {}
    settings.setdefault(
        "automatic_function_calling",
        dict(GEMINI_DISABLE_AUTOMATIC_FUNCTION_CALLING),
    )
    return settings


class GeminiToolNullabilityMiddleware(AgentMiddleware):
    """Retain explicit null alternatives without changing tool execution/validation."""

    def wrap_model_call(self, request, handler):
        tools = gemini_nullable_tools(request.model, request.tools)
        return handler(request.override(tools=tools) if tools is not None else request)

    async def awrap_model_call(self, request, handler):
        tools = gemini_nullable_tools(request.model, request.tools)
        return await handler(request.override(tools=tools) if tools is not None else request)


@contextmanager
def _publish_original_tools(request: Any, tools_replacement: list[Any] | None) -> Iterator[None]:
    """Business purpose: Preserve the model request's original tool contracts while provider compatibility middleware rewrites tools into a provider-specific form.

    Business rules:
    - Publish a context-local tuple of the incoming request tools only when a replacement is actually supplied.
    - Always restore the prior context value after the wrapped call, including when it raises.

    Execution flow:
    1. If no tool replacement exists, yield without changing context.
    2. Otherwise set ORIGINAL_REQUEST_TOOLS from the incoming request, yield to the wrapped call, and reset the context token in a finally block.

    Failure cases:
    - Exceptions from the wrapped call propagate after context restoration.

    Side effects:
    - Temporarily changes a context-local value for nested request validation; it does not mutate the request's tool list.
    """
    if tools_replacement is None:
        yield
        return
    token = ORIGINAL_REQUEST_TOOLS.set(tuple(getattr(request, "tools", None) or ()))
    try:
        yield
    finally:
        ORIGINAL_REQUEST_TOOLS.reset(token)


class ProviderSchemaCompatibilityMiddleware(AgentMiddleware):
    """Relax the provider-facing response schema where the provider cannot accept it."""

    @staticmethod
    def _override_request(request, replacement, tools_replacement):
        overrides: dict[str, Any] = {}
        if replacement is not None:
            overrides["response_format"] = replacement
        if tools_replacement is not None:
            overrides["tools"] = tools_replacement
        settings = gemini_structured_model_settings(
            request.model,
            replacement if replacement is not None else request.response_format,
            getattr(request, "model_settings", None),
        )
        if settings is not None:
            overrides["model_settings"] = settings
        return request.override(**overrides) if overrides else request

    def wrap_model_call(self, request, handler):
        """Business purpose: Make a synchronous model request's response format and tools compatible with the provider while preserving original tool contracts for inner governance checks.

        Business rules:
        - Compute only provider-compatible replacements supported for the request model.
        - Preserve call-time Gemini model settings and leave the request unchanged when no override is needed.

        Execution flow:
        1. Derive compatible response-format and tool replacements.
        2. Publish original tools within a context-local scope when tools are rewritten.
        3. Build the overridden request and pass it to the next handler.

        Failure cases:
        - Compatibility conversion or the downstream handler may fail; those errors propagate without being converted.

        Side effects:
        - Calls the downstream model handler and temporarily publishes original tools in context for nested validation.
        """
        replacement = gemini_compatible_response_format(
            request.model, request.response_format
        )
        tools_replacement = gemini_compatible_tools(
            request.model, getattr(request, "tools", [])
        )
        with _publish_original_tools(request, tools_replacement):
            return handler(
                self._override_request(request, replacement, tools_replacement)
            )

    async def awrap_model_call(self, request, handler):
        """Business purpose: Make an asynchronous model request's response format and tools compatible with the provider while preserving original tool contracts for inner governance checks.

        Business rules:
        - Compute only provider-compatible replacements supported for the request model.
        - Preserve call-time Gemini model settings and leave the request unchanged when no override is needed.

        Execution flow:
        1. Derive compatible response-format and tool replacements.
        2. Publish original tools within a context-local scope when tools are rewritten.
        3. Build the overridden request and await the next handler.

        Failure cases:
        - Compatibility conversion or the downstream handler may fail; those errors propagate after context restoration.

        Side effects:
        - Awaits the downstream model handler and temporarily publishes original tools in context for nested validation.
        """
        replacement = gemini_compatible_response_format(
            request.model, request.response_format
        )
        tools_replacement = gemini_compatible_tools(
            request.model, getattr(request, "tools", [])
        )
        with _publish_original_tools(request, tools_replacement):
            return await handler(
                self._override_request(request, replacement, tools_replacement)
            )
