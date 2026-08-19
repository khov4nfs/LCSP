"""Normalize safe, budgeted text/tool completion calls across supported LLM providers."""

import os
import json
import logging
import re
import tiktoken
from dataclasses import dataclass
from typing import Any, Optional

from lcsp_workers.llm.prompt_safety import check_prompt_safety
from lcsp_workers.llm.budget_tracker import BudgetTracker
from lcsp_workers.platform.redaction import redact_string
from lcsp_workers.platform.tracing import get_current_run_tree, traceable

logger = logging.getLogger(__name__)


@dataclass
class LLMResponse:
    """Provider-neutral text completion response and usage metadata."""

    content: str
    input_tokens: int
    output_tokens: int
    model: str
    provider: str
    request_id: Optional[str] = None


@dataclass(frozen=True)
class LLMToolDefinition:
    """Provider-neutral definition for one manually dispatched model tool.

    ``tool_choice_required`` is a catalog-level hint: if any supplied tool sets it,
    the provider must return at least one declared native function call instead of
    falling back to plain text. With a single declared tool this also forces that
    exact function, which is used by the EngineeringRule terminal ``finish`` round.
    """

    name: str
    description: str
    input_schema: dict[str, Any]
    tool_choice_required: bool = False


@dataclass(frozen=True)
class LLMToolCall:
    """Structured model-requested tool call awaiting registry validation/dispatch."""

    name: str
    arguments: dict[str, Any]
    call_id: str | None = None


@dataclass
class LLMToolResponse(LLMResponse):
    """Completion response that may include unexecuted structured tool calls."""

    tool_calls: tuple[LLMToolCall, ...] = ()


DEFAULT_MODEL_PRICING = {
    "gpt-4o": (5.0, 15.0),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4-turbo": (10.0, 30.0),
    "gpt-3.5-turbo": (0.5, 1.5),
    "claude-3-opus-20240229": (15.0, 75.0),
    "claude-3-sonnet-20240229": (3.0, 15.0),
    "claude-3-haiku-20240307": (0.25, 1.25),
    "claude-sonnet-5": (2.0, 10.0),
    "gemini-2.5-pro": (1.5, 9.0),
    "gemini-2.5-flash": (0.30, 2.5),
    "gemini-2.5-flash-lite": (0.15, 1.25),
    "gemini-1.5-pro": (1.25, 5.0),
    "gemini-1.5-flash": (0.075, 0.30),
    "gemini-3.5-flash": (0.075, 0.30),
    "gemini-3.1-flash-lite": (0.15, 1.25),
}

_TOOL_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def get_model_pricing() -> dict[str, tuple[float, float]]:
    """Load optional per-million-token pricing overrides or return safe defaults."""
    pricing_env = os.environ.get("LLM_MODEL_PRICING")
    if pricing_env:
        try:
            parsed = json.loads(pricing_env)
            pricing: dict[str, tuple[float, float]] = {}
            for key, value in parsed.items():
                if isinstance(value, dict):
                    pricing[key] = (
                        float(value["input"]),
                        float(value["output"]),
                    )
                    continue
                if isinstance(value, (list, tuple)) and len(value) == 2:
                    pricing[key] = (float(value[0]), float(value[1]))
                    continue
                raise ValueError(f"Invalid pricing entry for model: {key}")
            return pricing
        except Exception as exc:
            logger.warning(
                "Failed to parse LLM_MODEL_PRICING env var, using defaults.",
                exc_info=exc,
            )
    return DEFAULT_MODEL_PRICING


def estimate_tokens(text: str) -> int:
    """Estimate token count with tiktoken and fall back to a conservative heuristic."""
    try:
        encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except Exception:
        return len(text) // 4


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate call cost from configured model input/output token pricing."""
    pricing = get_model_pricing()
    in_price, out_price = pricing.get(model, (10.0, 30.0))
    return (input_tokens / 1_000_000 * in_price) + (
        output_tokens / 1_000_000 * out_price
    )


class LLMGatewayClient:
    """Provider-neutral LLM boundary enforcing prompt safety, redaction, and budget.

    The gateway never executes model-requested tools automatically. Tool calls are
    returned as data so the agentic registry can schema-check, authorize, budget,
    and dispatch them explicitly.
    """

    def __init__(
        self,
        provider: str,
        api_key: str,
        model: str,
        budget_tracker: BudgetTracker,
        max_tokens_per_call: int = 4096,
        timeout_seconds: float = 30.0,
    ):
        """Create a provider-specific SDK client behind the common gateway interface.

        Args:
            provider: Supported provider name (OpenAI, Anthropic, or Google/Gemini).
            api_key: Provider credential used only by the SDK client.
            model: Provider model identifier.
            budget_tracker: Shared/process-local budget enforcement adapter.
            max_tokens_per_call: Hard maximum output tokens for one call.
            timeout_seconds: Provider request timeout.

        Raises:
            ValueError: If the provider is unsupported or the token limit is invalid.
        """
        if max_tokens_per_call < 1:
            raise ValueError("max_tokens_per_call must be >= 1")
        self.provider = provider.lower()
        self.api_key = api_key
        self.model = model
        self.max_tokens_per_call = max_tokens_per_call
        self.timeout_seconds = timeout_seconds
        self.budget_tracker = budget_tracker

        if self.provider == "openai":
            import openai

            self._openai_client = openai.OpenAI(
                api_key=self.api_key,
                timeout=self.timeout_seconds,
            )
        elif self.provider == "anthropic":
            import anthropic

            self._anthropic_client = anthropic.Anthropic(
                api_key=self.api_key,
                timeout=self.timeout_seconds,
            )
        elif self.provider in ("google", "google-genai", "gemini"):
            from google import genai

            self._gemini_client = genai.Client(api_key=self.api_key)
        else:
            raise ValueError(f"Unsupported LLM_PROVIDER: {self.provider}")

    @traceable(run_type="llm", name="LLMGatewayClient.complete")
    def complete(
        self,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: Optional[int] = None,
        correlationId: Optional[str] = None,
    ) -> LLMResponse:
        """Execute one safe budgeted text completion and normalize provider usage.

        Args:
            prompt: Structured prompt that must pass source-code safety checks.
            workflow_run_id: Workflow identifier propagated to provider metadata.
            node_name: Graph/orchestration node issuing the call.
            max_tokens: Optional output-token request bounded by max_tokens_per_call.
            correlationId: Optional end-to-end trace identifier.

        Returns:
            Redacted provider-neutral completion response.
        """
        context = self._prepare_request(
            prompt=prompt,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            correlationId=correlationId,
        )
        safe_prompt, max_tokens_to_use, extra_headers = context

        content = ""
        input_tokens = 0
        output_tokens = 0
        request_id = None

        if self.provider == "openai":
            response = self._openai_client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": safe_prompt}],
                max_tokens=max_tokens_to_use,
                extra_headers=extra_headers if extra_headers else None,
            )
            content = response.choices[0].message.content or ""
            request_id = getattr(response, "id", None)
            if response.usage:
                input_tokens = response.usage.prompt_tokens
                output_tokens = response.usage.completion_tokens

        elif self.provider == "anthropic":
            response = self._anthropic_client.messages.create(
                model=self.model,
                messages=[{"role": "user", "content": safe_prompt}],
                max_tokens=max_tokens_to_use,
                extra_headers=extra_headers if extra_headers else None,
            )
            text_blocks = [
                block.text for block in response.content if hasattr(block, "text")
            ]
            content = "".join(text_blocks)
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            request_id = getattr(response, "id", None)

        elif self.provider in ("google", "google-genai", "gemini"):
            from google.genai import types

            response = self._gemini_client.models.generate_content(
                model=self.model,
                contents=safe_prompt,
                config=types.GenerateContentConfig(
                    max_output_tokens=max_tokens_to_use,
                    http_options=types.HttpOptions(headers=extra_headers),
                ),
            )
            content = response.text or ""
            request_id = getattr(response, "response_id", None)
            usage_metadata = getattr(response, "usage_metadata", None)
            if usage_metadata:
                input_tokens = usage_metadata.prompt_token_count or 0
                output_tokens = usage_metadata.candidates_token_count or 0

        self._record_actual_usage(input_tokens, output_tokens)

        run_tree = get_current_run_tree()
        if run_tree:
            run_tree.metadata["ls_provider"] = self.provider
            run_tree.metadata["ls_model_name"] = self.model
            run_tree.metadata["usage"] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            }

        return LLMResponse(
            content=redact_string(content),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=self.model,
            provider=self.provider,
            request_id=request_id,
        )

    @traceable(run_type="llm", name="LLMGatewayClient.complete_with_tools")
    def complete_with_tools(
        self,
        prompt: str,
        *,
        tools: list[LLMToolDefinition],
        workflow_run_id: str,
        node_name: str,
        max_tokens: Optional[int] = None,
        correlationId: Optional[str] = None,
    ) -> LLMToolResponse:
        """Request manual tool calls without allowing a provider SDK to execute them.

        The caller must pass every returned call through the agentic registry before
        dispatch. Tool definitions are fail-closed validated and undeclared calls
        returned by a provider are rejected. If any definition sets
        ``tool_choice_required``, provider AUTO mode is disabled for that request so
        a native function call is mandatory.
        """
        self._validate_tool_definitions(tools)
        require_tool_call = any(tool.tool_choice_required for tool in tools)
        safe_prompt, max_tokens_to_use, extra_headers = self._prepare_request(
            prompt=prompt,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            correlationId=correlationId,
        )

        content = ""
        calls: list[LLMToolCall] = []
        input_tokens = 0
        output_tokens = 0
        request_id = None

        if self.provider == "openai":
            response = self._openai_client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": safe_prompt}],
                max_tokens=max_tokens_to_use,
                tools=[
                    {
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema,
                        },
                    }
                    for tool in tools
                ],
                tool_choice="required" if require_tool_call else "auto",
                extra_headers=extra_headers if extra_headers else None,
            )
            message = response.choices[0].message
            content = message.content or ""
            request_id = getattr(response, "id", None)
            if response.usage:
                input_tokens = response.usage.prompt_tokens
                output_tokens = response.usage.completion_tokens

            if message.tool_calls:
                for call in message.tool_calls:
                    calls.append(
                        LLMToolCall(
                            call_id=call.id,
                            name=call.function.name,
                            arguments=self._parse_json_arguments(
                                call.function.arguments
                            ),
                        )
                    )

        elif self.provider == "anthropic":
            response = self._anthropic_client.messages.create(
                model=self.model,
                messages=[{"role": "user", "content": safe_prompt}],
                max_tokens=max_tokens_to_use,
                tools=[
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.input_schema,
                    }
                    for tool in tools
                ],
                tool_choice=(
                    {"type": "any"} if require_tool_call else {"type": "auto"}
                ),
                extra_headers=extra_headers if extra_headers else None,
            )
            request_id = getattr(response, "id", None)
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens

            text_blocks: list[str] = []
            for block in response.content:
                if block.type == "text":
                    text_blocks.append(block.text)
                elif block.type == "tool_use":
                    calls.append(
                        LLMToolCall(
                            call_id=block.id,
                            name=block.name,
                            arguments=block.input
                            if isinstance(block.input, dict)
                            else self._parse_json_arguments(str(block.input)),
                        )
                    )
            content = "".join(text_blocks)

        elif self.provider in ("google", "google-genai", "gemini"):
            from google.genai import types

            gemini_tools = [
                types.Tool(
                    function_declarations=[
                        types.FunctionDeclaration(
                            name=tool.name,
                            description=tool.description,
                            parameters=tool.input_schema,
                        )
                        for tool in tools
                    ]
                )
            ]
            config_kwargs: dict[str, Any] = {
                "max_output_tokens": max_tokens_to_use,
                "tools": gemini_tools,
                "automatic_function_calling": types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
                "http_options": types.HttpOptions(headers=extra_headers),
            }
            if require_tool_call:
                config_kwargs["tool_config"] = types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(
                        mode=types.FunctionCallingConfigMode.ANY
                    )
                )

            response = self._gemini_client.models.generate_content(
                model=self.model,
                contents=safe_prompt,
                config=types.GenerateContentConfig(**config_kwargs),
            )
            request_id = getattr(response, "response_id", None)
            content = getattr(response, "text", None) or ""
            for call in getattr(response, "function_calls", None) or []:
                raw_arguments = getattr(call, "args", {}) or {}
                if not isinstance(raw_arguments, dict):
                    raw_arguments = dict(raw_arguments)
                calls.append(
                    LLMToolCall(
                        name=str(call.name),
                        arguments=dict(raw_arguments),
                        call_id=getattr(call, "id", None),
                    )
                )
            if not calls and getattr(response, "candidates", None):
                candidate = response.candidates[0]
                if getattr(candidate, "content", None) and getattr(candidate.content, "parts", None):
                    for part in candidate.content.parts:
                        if getattr(part, "text", None):
                            content += part.text
                        if getattr(part, "function_call", None):
                            calls.append(
                                LLMToolCall(
                                    name=part.function_call.name,
                                    arguments=dict(part.function_call.args)
                                    if part.function_call.args
                                    else {},
                                    call_id=getattr(part.function_call, "id", None),
                                )
                            )

            usage_metadata = getattr(response, "usage_metadata", None)
            if usage_metadata:
                input_tokens = usage_metadata.prompt_token_count or 0
                output_tokens = usage_metadata.candidates_token_count or 0

        allowed_names = {tool.name for tool in tools}
        if any(call.name not in allowed_names for call in calls):
            raise ValueError("LLM returned an undeclared tool call")
        if require_tool_call and not calls:
            raise ValueError("LLM provider returned no tool call in required mode")

        self._record_actual_usage(input_tokens, output_tokens)

        run_tree = get_current_run_tree()
        if run_tree:
            run_tree.metadata["ls_provider"] = self.provider
            run_tree.metadata["ls_model_name"] = self.model
            run_tree.metadata["usage"] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            }

        return LLMToolResponse(
            content=redact_string(content),
            tool_calls=tuple(calls),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=self.model,
            provider=self.provider,
            request_id=request_id,
        )

    def _prepare_request(
        self,
        *,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: Optional[int],
        correlationId: Optional[str],
    ) -> tuple[str, int, dict[str, str]]:
        """Validate request identity/safety, redact prompt, and preflight its budget."""
        if not workflow_run_id:
            raise ValueError("workflow_run_id is required")
        if not node_name:
            raise ValueError("node_name is required")

        check_prompt_safety(prompt)
        requested_max_tokens = (
            max_tokens if max_tokens is not None else self.max_tokens_per_call
        )
        if requested_max_tokens < 1:
            raise ValueError("max_tokens must be >= 1")
        max_tokens_to_use = min(requested_max_tokens, self.max_tokens_per_call)
        safe_prompt = redact_string(prompt)
        est_input = estimate_tokens(safe_prompt)
        est_cost_pre = estimate_cost(self.model, est_input, max_tokens_to_use)
        self.budget_tracker.check_budget(est_input, max_tokens_to_use, est_cost_pre)

        extra_headers = {
            "X-Workflow-Run-Id": workflow_run_id,
            "X-Node-Name": node_name,
        }
        if correlationId:
            extra_headers["X-Correlation-Id"] = correlationId
        return safe_prompt, max_tokens_to_use, extra_headers

    def _record_actual_usage(self, input_tokens: int, output_tokens: int) -> None:
        """Calculate actual provider cost and atomically add it to monthly usage."""
        actual_cost = estimate_cost(self.model, input_tokens, output_tokens)
        self.budget_tracker.check_budget_and_accumulate(
            input_tokens,
            output_tokens,
            actual_cost,
        )

    @staticmethod
    def _parse_json_arguments(value: str) -> dict[str, Any]:
        """Parse provider tool arguments and require an object-shaped JSON value."""
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError("LLM tool call arguments were not valid JSON") from exc
        if not isinstance(parsed, dict):
            raise ValueError("LLM tool call arguments must be an object")
        return parsed

    @staticmethod
    def _validate_tool_definitions(tools: list[LLMToolDefinition]) -> None:
        """Fail closed on missing, duplicate, unsafe, or open-ended tool schemas."""
        if not tools:
            raise ValueError("at least one tool definition is required")
        names: set[str] = set()
        for tool in tools:
            if not _TOOL_NAME_PATTERN.fullmatch(tool.name):
                raise ValueError(f"invalid tool name: {tool.name}")
            if tool.name in names:
                raise ValueError(f"duplicate tool name: {tool.name}")
            names.add(tool.name)
            if not tool.description.strip():
                raise ValueError(f"tool description is required: {tool.name}")
            schema = tool.input_schema
            if not isinstance(schema, dict) or schema.get("type") != "object":
                raise ValueError(f"tool input schema must be an object: {tool.name}")
            if schema.get("additionalProperties") is not False:
                raise ValueError(
                    f"tool input schema must set additionalProperties=false: {tool.name}"
                )