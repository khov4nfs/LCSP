"""Provider-side response-schema compatibility for native structured output."""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware
from pydantic import BaseModel

GEMINI_MODULE_PREFIX = "langchain_google_genai."


def relax_array_upper_bounds(schema: Any) -> Any:
    """Drop every `maxItems` from a response schema handed to Gemini.

    Gemini materialises a bounded array by expanding its item schema up to `maxItems`
    times, and rejects the whole request with an opaque 400 INVALID_ARGUMENT once the
    expanded schema exceeds an internal budget. `InvestigatorResult` crosses it: 200
    claims each carrying three 100-element reference arrays. No single bound is at fault,
    so only removing all of them makes the request valid.

    Only the provider-facing copy is relaxed. The Pydantic contract still validates the
    real bounds when the handoff is parsed, so nothing downstream becomes more permissive.
    """
    if isinstance(schema, dict):
        return {
            key: relax_array_upper_bounds(value)
            for key, value in schema.items()
            if key != "maxItems"
        }
    if isinstance(schema, list):
        return [relax_array_upper_bounds(value) for value in schema]
    return schema


def _json_schema_of(schema: Any) -> dict[str, Any] | None:
    """Return the JSON schema of a structured-output schema, or None if unavailable."""
    if isinstance(schema, dict):
        return schema
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        return schema.model_json_schema()
    return None


def _rebuild_response_format(output_format: Any, relaxed: dict[str, Any]) -> Any:
    """Rebuild the same structured-output strategy around the relaxed JSON schema."""
    if isinstance(output_format, (dict, type)):
        return relaxed
    return type(output_format)(relaxed)


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
    if relaxed == json_schema:
        return None
    return _rebuild_response_format(output_format, relaxed)


class ProviderSchemaCompatibilityMiddleware(AgentMiddleware):
    """Relax the provider-facing response schema where the provider cannot accept it."""

    def wrap_model_call(self, request, handler):
        replacement = gemini_compatible_response_format(
            request.model, request.response_format
        )
        if replacement is None:
            return handler(request)
        return handler(request.override(response_format=replacement))

    async def awrap_model_call(self, request, handler):
        replacement = gemini_compatible_response_format(
            request.model, request.response_format
        )
        if replacement is None:
            return await handler(request)
        return await handler(request.override(response_format=replacement))
