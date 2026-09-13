"""Provider-side response-schema compatibility for native structured output."""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware
from pydantic import BaseModel

GEMINI_MODULE_PREFIX = "langchain_google_genai."
GEMINI_DISABLE_AUTOMATIC_FUNCTION_CALLING = {"disable": True}


def relax_array_upper_bounds(schema: Any) -> Any:
    """Drop every expansion-costly `maxItems` from a response schema handed to Gemini.

    Gemini materialises a bounded array by expanding its item schema up to `maxItems`
    times, and rejects the whole request with an opaque 400 INVALID_ARGUMENT once the
    expanded schema exceeds an internal budget. `InvestigatorResult` crosses it: 200
    claims each carrying three 100-element reference arrays. No single bound is at fault,
    so only removing all of them makes the request valid.

    `maxItems: 0` is kept. It costs Gemini nothing to expand (zero items, zero budget),
    and on the per-claim_type variant models it is not a size tuning bound at all — it is
    the structural "this claim shape must not carry this ref list" contract (e.g.
    RULE_SCOPE_NOT_APPLICABLE's evidence/graph/source refs). Stripping it here would
    silently reopen exactly the class of gap this module exists to close.

    Only the provider-facing copy is relaxed. The Pydantic contract still validates the
    real bounds when the handoff is parsed, so nothing downstream becomes more permissive.
    """
    if isinstance(schema, dict):
        return {
            key: relax_array_upper_bounds(value)
            for key, value in schema.items()
            if not (key == "maxItems" and value != 0)
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


class ProviderSchemaCompatibilityMiddleware(AgentMiddleware):
    """Relax the provider-facing response schema where the provider cannot accept it."""

    @staticmethod
    def _override_request(request, replacement):
        overrides: dict[str, Any] = {}
        if replacement is not None:
            overrides["response_format"] = replacement
        settings = gemini_structured_model_settings(
            request.model,
            replacement if replacement is not None else request.response_format,
            getattr(request, "model_settings", None),
        )
        if settings is not None:
            overrides["model_settings"] = settings
        return request.override(**overrides) if overrides else request

    def wrap_model_call(self, request, handler):
        replacement = gemini_compatible_response_format(
            request.model, request.response_format
        )
        return handler(self._override_request(request, replacement))

    async def awrap_model_call(self, request, handler):
        replacement = gemini_compatible_response_format(
            request.model, request.response_format
        )
        return await handler(self._override_request(request, replacement))
