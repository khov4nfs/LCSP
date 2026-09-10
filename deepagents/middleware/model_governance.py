"""Official LangChain middleware shared by LCSP model-assisted boundaries."""

from __future__ import annotations

from langchain.agents.middleware import (
    AgentMiddleware,
    ModelCallLimitMiddleware,
    ModelRetryMiddleware,
    PIIMiddleware,
)
from langchain.agents.structured_output import AutoStrategy, ProviderStrategy, ToolStrategy
from langchain_core.messages import ToolMessage
from middleware.provider_schema import ProviderSchemaCompatibilityMiddleware
from middleware.token_fallback import TokenFallbackMiddleware
from middleware.failure_policy import TerminalSchemaError, retry_model_error

from middleware.redaction import (
    ANTHROPIC_KEY_PATTERN,
    AWS_ACCESS_KEY_PATTERN,
    BEARER_TOKEN_PATTERN,
    GENERIC_ASSIGNMENT_PATTERN,
    GITHUB_TOKEN_PATTERN,
)


class StopSchemaRepairMiddleware(AgentMiddleware):
    """Stop auto-strategy repair before another model call, preserving native output."""

    @staticmethod
    def _check(request, response):
        output_format = request.response_format
        if output_format is None or isinstance(output_format, ProviderStrategy):
            return response
        if response.structured_response is not None:
            return response
        schema = output_format.schema if isinstance(output_format, (AutoStrategy, ToolStrategy)) else output_format
        strategy = output_format if isinstance(output_format, ToolStrategy) else ToolStrategy(schema)
        names = {spec.name for spec in strategy.schema_specs}
        if any(isinstance(message, ToolMessage) and message.name in names for message in response.result):
            raise TerminalSchemaError("Structured output schema validation failed; automatic repair disabled")
        return response

    @staticmethod
    def _check_tool(response):
        # ToolNode converts argument ValidationError into this error ToolMessage.
        # Stop before it becomes another model prompt; ordinary tool results pass.
        if (isinstance(response, ToolMessage) and response.status == "error"
                and isinstance(response.content, str)
                and response.content.startswith("Error invoking tool '")):
            raise TerminalSchemaError("Tool argument schema validation failed; automatic repair disabled")
        return response

    def wrap_tool_call(self, request, handler):
        return self._check_tool(handler(request))

    async def awrap_tool_call(self, request, handler):
        return self._check_tool(await handler(request))

    def wrap_model_call(self, request, handler):
        return self._check(request, handler(request))

    async def awrap_model_call(self, request, handler):
        return self._check(request, await handler(request))


def _redacting_pii(pii_type: str, detector: str | None = None) -> PIIMiddleware:
    """Create the standard LangChain PII guardrail for model data surfaces."""
    return PIIMiddleware(
        pii_type,
        detector=detector,
        strategy="redact",
        apply_to_output=True,
        apply_to_tool_results=True,
    )


# These are framework middleware instances, not a second policy engine. Domain
# guardrails stay at their deterministic persistence boundaries.
MODEL_GOVERNANCE_MIDDLEWARE = (
    _redacting_pii("email"),
    _redacting_pii("credit_card"),
    _redacting_pii("github_token", GITHUB_TOKEN_PATTERN.pattern),
    _redacting_pii("bearer_token", BEARER_TOKEN_PATTERN.pattern),
    _redacting_pii("aws_access_key", AWS_ACCESS_KEY_PATTERN.pattern),
    _redacting_pii("anthropic_key", ANTHROPIC_KEY_PATTERN.pattern),
    _redacting_pii("credential_assignment", GENERIC_ASSIGNMENT_PATTERN.pattern),
    # A synthetic error message has no structured handoff and hides the cause.
    ModelRetryMiddleware(max_retries=2, on_failure="error", retry_on=retry_model_error),
    TokenFallbackMiddleware(),
    # Runs inside token fallback so every retried model instance gets the same
    # provider-compatible response schema.
    ProviderSchemaCompatibilityMiddleware(),
    StopSchemaRepairMiddleware(),
    ModelCallLimitMiddleware(run_limit=2, exit_behavior="error"),
)

TRIAGE_MODEL_GOVERNANCE_MIDDLEWARE = (
    *MODEL_GOVERNANCE_MIDDLEWARE[:-1],
    # Read/persist up to 500 claimed rules, then finish and return the handoff.
    ModelCallLimitMiddleware(run_limit=1100, exit_behavior="error"),
)
