"""Official LangChain middleware shared by LCSP model-assisted boundaries."""

from __future__ import annotations

from langchain.agents import create_agent
from langchain.agents.middleware import (
    AgentMiddleware,
    ModelRetryMiddleware,
    PIIMiddleware,
)
import json
import re

from langchain.agents.middleware import ModelResponse
from langchain.agents.structured_output import (
    AutoStrategy,
    OutputToolBinding,
    ProviderStrategy,
    ToolStrategy,
)
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import BaseTool
from pydantic import ValidationError
from deepagents.middleware.subagents import GENERAL_PURPOSE_SUBAGENT
from middleware.provider_fallback import ProviderFallbackMiddleware
from middleware.provider_schema import ProviderSchemaCompatibilityMiddleware
from middleware.tool_contracts import request_tool_contracts
from middleware.token_fallback import TokenFallbackMiddleware
from middleware.usage_metering import (
    AgentRoleMiddleware,
    UsageMeteringMiddleware,
    output_token_limit,
    response_shape,
)
from middleware.failure_policy import (
    StructuredOutputRejected,
    MalformedToolCallSample,
    TerminalSchemaError,
    retry_model_error,
)

from tools.common.capabilities.platform.logging import get_logger

from middleware.redaction import (
    ANTHROPIC_KEY_PATTERN,
    AWS_ACCESS_KEY_PATTERN,
    BEARER_TOKEN_PATTERN,
    GENERIC_ASSIGNMENT_PATTERN,
    GITHUB_TOKEN_PATTERN,
)


_PYDANTIC_INPUT_VALUE = re.compile(r", input_value=.*?, input_type=", re.DOTALL)


def _rejection_detail(response) -> str:
    """Field paths and error types of the rejected structured output, without its values."""
    for message in response.result:
        if isinstance(message, ToolMessage) and isinstance(message.content, str):
            text = " ".join(_PYDANTIC_INPUT_VALUE.sub(", input_type=", message.content).split())
            return f": {text[:400]}"
    return ""


logger = get_logger(__name__)


class OneNativeSchemaRepair:
    """Explicit per-invocation opt-in; the shared guard permits one native correction."""

    def __init__(self):
        self.used = False

    def __call__(self, error):
        detail = " ".join(_PYDANTIC_INPUT_VALUE.sub(", input_type=", str(error)).split())
        return "Output contract rejected: " + detail[:400] + ". Correct the returned data to the supplied schema and identities."

    def allow_feedback(self):
        if self.used:
            return False
        self.used = True
        return True


class StopSchemaRepairMiddleware(AgentMiddleware):
    """Preserve native output and enforce the explicit request's schema repair policy."""

    @staticmethod
    def _check(request, response):
        # A sample whose tool calls cannot execute would otherwise reach the tool
        # node and end the whole run as a terminal schema error; discard it before
        # any tool runs so ModelRetry re-samples the same request instead.
        reason = _malformed_tool_call_reason(request, response)
        if reason is not None:
            logger.warning("MODEL_MALFORMED_TOOL_CALL_SAMPLE", reason=reason, sample=response_shape(response))
            raise MalformedToolCallSample(reason)
        output_format = request.response_format
        if output_format is None or isinstance(output_format, ProviderStrategy):
            return response
        if response.structured_response is not None:
            return response
        schema = output_format.schema if isinstance(output_format, (AutoStrategy, ToolStrategy)) else output_format
        strategy = output_format if isinstance(output_format, ToolStrategy) else ToolStrategy(schema)
        names = {spec.name for spec in strategy.schema_specs}
        if any(isinstance(message, ToolMessage) and message.name in names for message in response.result):
            if isinstance(strategy.handle_errors, OneNativeSchemaRepair) and strategy.handle_errors.allow_feedback():
                return response
            raise StructuredOutputRejected(
                "Structured output schema validation failed; automatic repair disabled"
                + _rejection_detail(response)
            )
        final = next(
            (message for message in reversed(response.result) if isinstance(message, AIMessage)),
            None,
        )
        if final is not None and not final.tool_calls:
            # Tool strategy forces tool_choice, so a text-only answer broke the contract
            # (some OpenAI-compatible gateway routes do this). Accept it only when the text is exactly one schema-valid
            # JSON object; otherwise reject it so provider fallback can try a provider with
            # native structured output instead of ending the agent with no handoff.
            parsed = _parse_text_structured_output(final, strategy)
            if parsed is None:
                raise StructuredOutputRejected(
                    "Model answered without the structured-output tool; automatic repair disabled"
                )
            return ModelResponse(result=response.result, structured_response=parsed)
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


_OUTPUT_CAP_FINISH_REASONS = frozenset({"length", "max_tokens", "MAX_TOKENS"})


def _malformed_tool_call_reason(request, response) -> str | None:
    # Tool contracts are read through one normalizer, so a sample is judged the same way whether the
    # request carries native tools or the dicts a provider middleware rewrote them into (Gemini). A
    # tool that answers invalid arguments itself (``handle_validation_error``) gives the model
    # correction feedback; discarding its sample would only re-roll a mistake that feedback fixes.
    contracts = request_tool_contracts(request)
    for message in response.result:
        if not isinstance(message, AIMessage):
            continue
        if not (message.tool_calls or message.invalid_tool_calls):
            continue
        metadata = message.response_metadata or {}
        finish = metadata.get("finish_reason") or metadata.get("stop_reason")
        # Some gateways (APX) report a truncated answer as ``end_turn``; the used output tokens still show it.
        used = (message.usage_metadata or {}).get("output_tokens") or 0
        if str(finish) in _OUTPUT_CAP_FINISH_REASONS or used >= output_token_limit(request.model):
            return "Model output hit the output-token cap while emitting tool calls"
        if message.invalid_tool_calls:
            return "Model emitted unparseable tool-call arguments"
        for call in message.tool_calls:
            contract = contracts.get(call["name"])
            if contract is None or contract.answers_invalid_arguments:
                continue
            problems = contract.problems(call["args"])
            if problems:
                # Field paths and error kinds only: never the model's argument values.
                return f"Model emitted invalid arguments for tool {call['name']} ({'; '.join(problems)})"
    return None


def _parse_text_structured_output(message: AIMessage, strategy: ToolStrategy):
    """Parse a text-only answer that is exactly one JSON object valid for the schema."""
    content = message.content
    if isinstance(content, list):
        content = "".join(
            block.get("text", "") if isinstance(block, dict) else str(block) for block in content
        )
    if not isinstance(content, str):
        return None
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        payload = json.loads(text)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    for spec in strategy.schema_specs:
        try:
            return OutputToolBinding.from_schema_spec(spec).parse(payload)
        except Exception:
            continue
    return None


def _redacting_pii(pii_type: str, detector: str | None = None) -> PIIMiddleware:
    """Create the standard LangChain PII guardrail for model data surfaces."""
    return PIIMiddleware(
        pii_type,
        detector=detector,
        strategy="redact",
        apply_to_output=True,
        apply_to_tool_results=True,
    )


# Extra samples of one request after a transient or malformed answer. The APX gateway returns
# `task` calls with empty arguments for roughly half of the samples of the same request, so two
# retries (three samples) failed a preparation run about one time in four.
MODEL_RETRIES = 5

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
    ModelRetryMiddleware(max_retries=MODEL_RETRIES, on_failure="error", retry_on=retry_model_error),
    # Provider fallback wraps same-provider key rotation. A provider is not left
    # until its configured credential pool has been exhausted.
    ProviderFallbackMiddleware(),
    TokenFallbackMiddleware(),
    # Runs inside token fallback so every retried model instance gets the same
    # provider-compatible response schema.
    ProviderSchemaCompatibilityMiddleware(),
    StopSchemaRepairMiddleware(),
    # Keep metering innermost so provider retry, key rotation and fallback each
    # expose their actual downstream response to one governed billing boundary.
    UsageMeteringMiddleware(),
)



class _GovernedInternalModelRunnable:
    """Runnable for framework-owned LLM work through the exact LCSP agent stack."""

    def __init__(self, model, *, role: str, operation_type: str) -> None:
        # Use LangChain's own agent middleware composer rather than reimplementing
        # wrap/before/after hook semantics. This graph has no tools and therefore
        # performs exactly one governed model operation per summary request.
        self._agent = create_agent(
            model,
            tools=[],
            middleware=[
                AgentRoleMiddleware(role, operation_type=operation_type),
                *MODEL_GOVERNANCE_MIDDLEWARE,
            ],
            name=f"lcsp-internal-{operation_type.lower()}",
        )

    @staticmethod
    def _message(result) -> AIMessage:
        messages = result.get("messages", []) if isinstance(result, dict) else []
        message = next(
            (item for item in reversed(messages) if isinstance(item, AIMessage)), None
        )
        if message is None:
            raise RuntimeError("governed internal model call returned no AI message")
        return message

    def invoke(self, prompt, config=None, **_kwargs):
        if not isinstance(prompt, str):
            raise TypeError("governed internal model prompt must be text")
        result = self._agent.invoke(
            {"messages": [HumanMessage(content=prompt)]}, config=config
        )
        return self._message(result)

    async def ainvoke(self, prompt, config=None, **_kwargs):
        if not isinstance(prompt, str):
            raise TypeError("governed internal model prompt must be text")
        result = await self._agent.ainvoke(
            {"messages": [HumanMessage(content=prompt)]}, config=config
        )
        return self._message(result)


def governed_summarization_middleware(model, *, backend, role: str):
    """Route Deep Agents' framework-owned summary call through LCSP governance."""
    from deepagents.middleware.summarization import create_summarization_middleware

    middleware = create_summarization_middleware(model, backend)
    helper = getattr(middleware, "_lc_helper", None)
    if helper is None or not hasattr(helper, "_summary_model"):
        raise RuntimeError(
            "Deep Agents summarization internals changed; governance cannot be guaranteed"
        )
    # LangChain normally installs model.with_retry() here. Replace that direct
    # provider runnable with the complete LCSP stack; ModelRetryMiddleware now owns
    # bounded retry together with credential/provider fallback and usage metering.
    helper._summary_model = _GovernedInternalModelRunnable(
        model, role=role, operation_type="SUMMARIZATION"
    )
    return middleware



def governed_general_purpose_subagent(model, *, role: str) -> dict:
    """Replace Deep Agents' auto-added `general-purpose` subagent with a governed one.

    The default spec inherits only parent middleware that overrides its own slots,
    so its model calls would bypass credential rotation, provider fallback, retry
    and billing metering. An explicit spec with the same name overrides it.
    """
    return {
        **GENERAL_PURPOSE_SUBAGENT,
        "model": model,
        "middleware": [AgentRoleMiddleware(role), *MODEL_GOVERNANCE_MIDDLEWARE],
    }
