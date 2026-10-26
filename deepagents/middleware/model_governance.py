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

    def __call__(self, error):
        """Business purpose: Give the model one safe, actionable correction message after native structured-output validation fails.

        Business rules:
        - Remove Pydantic input_value details, normalize whitespace, and cap the diagnostic at 400 characters.
        - Tell the model to correct its output against the supplied schema and identities.

        Execution flow:
        1. Convert the validation error to text and redact input values.
        2. Collapse whitespace, truncate the detail, and prefix it with the output-contract correction instruction.

        Failure cases:
        - The callback returns bounded feedback rather than raising when the error text contains no usable detail.

        Side effects:
        - Pure formatting; it does not change messages or invoke a model.
        """
        detail = " ".join(_PYDANTIC_INPUT_VALUE.sub(", input_type=", str(error)).split())
        return "Output contract rejected: " + detail[:400] + ". Correct the returned data to the supplied schema and identities."

    def allow_feedback(self, messages, names):
        # Native subagents reuse their compiled graph across concurrent task conversations.
        """Business purpose: Prevent repeated native schema-repair feedback within the same tool conversation.

        Business rules:
        - Feedback is disallowed when a ToolMessage from one of the governed tool names already starts with the repair prefix.
        - The decision is derived from the supplied conversation messages, so concurrent conversations do not share repair state.

        Execution flow:
        1. Scan messages for a matching ToolMessage name and repair-prefix content.
        2. Return false when prior repair feedback exists; otherwise return true.

        Failure cases:
        - Messages without a matching tool feedback message allow the single repair path.

        Side effects:
        - Pure conversation inspection; it does not mutate messages or persist a repair counter.
        """
        return not any(
            isinstance(message, ToolMessage)
            and message.name in names
            and isinstance(message.content, str)
            and message.content.startswith("Output contract rejected:")
            for message in messages
        )


class StopSchemaRepairMiddleware(AgentMiddleware):
    """Preserve native output and enforce the explicit request's schema repair policy."""

    @staticmethod
    def _check(request, response):
        # A sample whose tool calls cannot execute would otherwise reach the tool
        # node and end the whole run as a terminal schema error; discard it before
        # any tool runs so ModelRetry re-samples the same request instead.
        """Business purpose: Enforce structured-output and tool-call contracts before malformed model samples reach tool execution or assessment logic.

        Business rules:
        - Malformed tool-call samples are rejected first; requests without a governed response format and provider-native strategies pass through.
        - A native schema repair is allowed only for the explicit OneNativeSchemaRepair strategy and only before prior repair feedback.
        - Text-only output for a tool strategy is accepted only when it parses as one schema-valid JSON object.

        Execution flow:
        1. Inspect the response for capped or malformed tool calls and reject such a sample before tool execution.
        2. Pass through ungoverned formats or an already populated structured response.
        3. Detect schema-tool validation feedback; allow the one opted-in repair or raise a structured-output rejection.
        4. For a final text-only response, parse and validate the JSON object, returning it as structured output only when a schema matches.
        5. Pass through responses that do not violate these conditions.

        Failure cases:
        - Raise MalformedToolCallSample for an unusable tool-call sample and StructuredOutputRejected for disabled repair or invalid text-only structured output.
        - Log a warning for malformed tool-call samples with the reason and response shape before raising.

        Side effects:
        - Reads the request and response and may emit a malformed-sample warning; it does not execute tools or call a model.
        """
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
            if isinstance(strategy.handle_errors, OneNativeSchemaRepair) and strategy.handle_errors.allow_feedback(request.messages, names):
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
    """Business purpose: Identify unusable tool-call samples before the tool node executes them.

    Business rules:
    - Validate against the original request tool contracts even when provider middleware rewrites their representation.
    - Do not discard arguments that the tool itself handles through handle_validation_error.
    - Report only token-cap, parse, field-path, and error-kind information; never include argument values.

    Execution flow:
    1. Build normalized contracts from the request's original tools when available.
    2. Inspect AI messages containing tool calls, first checking output-cap metadata and then unparseable calls.
    3. Validate each known contract unless the tool handles invalid arguments, and return the first issue found.
    4. Return None when no governed tool-call defect is found.

    Failure cases:
    - Tool names without an available contract are not independently rejected here; the authoritative tool boundary remains responsible for them.

    Side effects:
    - Pure inspection and validation; it does not execute tools, log, or mutate the response.
    """
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
        """Business purpose: Extract the model response that Deep Agents' governed internal operation expects.

        Business rules:
        - Select the last AIMessage from a dictionary result's messages collection.
        - Do not treat non-AI messages or non-dictionary results as a successful model answer.

        Execution flow:
        1. Read the messages list when the result is a dictionary.
        2. Search it in reverse for the final AIMessage and return that message.

        Failure cases:
        - Raise RuntimeError when no AIMessage is present so summarization cannot continue with an empty or unrelated result.

        Side effects:
        - Pure result projection; it does not call a model or change the result.
        """
        messages = result.get("messages", []) if isinstance(result, dict) else []
        message = next(
            (item for item in reversed(messages) if isinstance(item, AIMessage)), None
        )
        if message is None:
            raise RuntimeError("governed internal model call returned no AI message")
        return message

    def invoke(self, prompt, config=None, **_kwargs):
        """Business purpose: Route a synchronous framework-owned internal prompt through the LCSP-governed agent stack.

        Business rules:
        - Internal prompts must be text; inference runs through the compiled agent configured with the supplied role and governance middleware.
        - Return the final AIMessage rather than exposing the agent result envelope.

        Execution flow:
        1. Reject non-string prompts.
        2. Wrap the text in a HumanMessage and invoke the governed agent with the caller's config.
        3. Extract and return the final AIMessage.

        Failure cases:
        - Raise TypeError for non-text prompts and propagate agent or missing-response failures.

        Side effects:
        - Performs a governed model inference, including the configured runtime's provider routing, metering, and audit effects.
        """
        if not isinstance(prompt, str):
            raise TypeError("governed internal model prompt must be text")
        result = self._agent.invoke(
            {"messages": [HumanMessage(content=prompt)]}, config=config
        )
        return self._message(result)

    async def ainvoke(self, prompt, config=None, **_kwargs):
        """Business purpose: Route an asynchronous framework-owned internal prompt through the LCSP-governed agent stack.

        Business rules:
        - Internal prompts must be text; inference runs through the compiled agent configured with the supplied role and governance middleware.
        - Return the final AIMessage rather than exposing the agent result envelope.

        Execution flow:
        1. Reject non-string prompts.
        2. Wrap the text in a HumanMessage and await the governed agent with the caller's config.
        3. Extract and return the final AIMessage.

        Failure cases:
        - Raise TypeError for non-text prompts and propagate agent or missing-response failures.

        Side effects:
        - Performs governed asynchronous inference, including configured provider routing, metering, and audit effects.
        """
        if not isinstance(prompt, str):
            raise TypeError("governed internal model prompt must be text")
        result = await self._agent.ainvoke(
            {"messages": [HumanMessage(content=prompt)]}, config=config
        )
        return self._message(result)


def governed_summarization_middleware(model, *, backend, role: str):
    """Business purpose: Route Deep Agents' framework-owned summarization inference through LCSP model governance.

    Business rules:
    - Preserve Deep Agents' summarization middleware behavior while replacing its direct summary model with the governed internal runnable.
    - Fail closed if the installed Deep Agents helper no longer exposes the summary-model integration point.

    Execution flow:
    1. Construct the standard summarization middleware for the requested model and backend.
    2. Verify that its internal helper exposes _summary_model.
    3. Replace that model with a governed runnable marked for the requested role and SUMMARIZATION operation.
    4. Return the configured middleware.

    Failure cases:
    - Raise RuntimeError when the framework integration point is absent so summaries cannot silently bypass governance.

    Side effects:
    - Mutates the newly constructed middleware's summary-model configuration; future summarization invokes the governed model stack.
    """
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
