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

logger = logging.getLogger(__name__)


@dataclass
class LLMResponse:
    content: str
    input_tokens: int
    output_tokens: int
    model: str
    provider: str
    request_id: Optional[str] = None


@dataclass(frozen=True)
class LLMToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class LLMToolCall:
    name: str
    arguments: dict[str, Any]
    call_id: str | None = None


@dataclass
class LLMToolResponse(LLMResponse):
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
    try:
        encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except Exception:
        return len(text) // 4


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = get_model_pricing()
    in_price, out_price = pricing.get(model, (10.0, 30.0))
    return (input_tokens / 1_000_000 * in_price) + (
        output_tokens / 1_000_000 * out_price
    )


class LLMGatewayClient:
    def __init__(
        self,
        provider: str,
        api_key: str,
        model: str,
        budget_tracker: BudgetTracker,
        max_tokens_per_call: int = 4096,
        timeout_seconds: float = 30.0,
    ):
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

    def complete(
        self,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: Optional[int] = None,
        correlationId: Optional[str] = None,
    ) -> LLMResponse:
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

        return LLMResponse(
            content=redact_string(content),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=self.model,
            provider=self.provider,
            request_id=request_id,
        )

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
        """Request manual tool calls without allowing an SDK to execute them.

        The caller must pass every returned call through the agentic registry before
        dispatch. This method intentionally performs no automatic function execution.
        """
        self._validate_tool_definitions(tools)
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
                tool_choice="auto",
                extra_headers=extra_headers if extra_headers else None,
            )
            message = response.choices[0].message
            content = message.content or ""
            for call in message.tool_calls or []:
                calls.append(
                    LLMToolCall(
                        name=call.function.name,
                        arguments=self._parse_json_arguments(call.function.arguments),
                        call_id=getattr(call, "id", None),
                    )
                )
            request_id = getattr(response, "id", None)
            if response.usage:
                input_tokens = response.usage.prompt_tokens
                output_tokens = response.usage.completion_tokens

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
                extra_headers=extra_headers if extra_headers else None,
            )
            text_blocks = []
            for block in response.content:
                block_type = getattr(block, "type", None)
                if block_type == "text" and hasattr(block, "text"):
                    text_blocks.append(block.text)
                elif block_type == "tool_use":
                    raw_arguments = getattr(block, "input", {})
                    if not isinstance(raw_arguments, dict):
                        raise ValueError("LLM tool call arguments must be an object")
                    calls.append(
                        LLMToolCall(
                            name=str(block.name),
                            arguments=dict(raw_arguments),
                            call_id=getattr(block, "id", None),
                        )
                    )
            content = "".join(text_blocks)
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            request_id = getattr(response, "id", None)

        elif self.provider in ("google", "google-genai", "gemini"):
            from google.genai import types

            declarations = [
                types.FunctionDeclaration(
                    name=tool.name,
                    description=tool.description,
                    parameters_json_schema=tool.input_schema,
                )
                for tool in tools
            ]
            response = self._gemini_client.models.generate_content(
                model=self.model,
                contents=safe_prompt,
                config=types.GenerateContentConfig(
                    max_output_tokens=max_tokens_to_use,
                    tools=[types.Tool(function_declarations=declarations)],
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(
                        disable=True
                    ),
                    http_options=types.HttpOptions(headers=extra_headers),
                ),
            )
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
            request_id = getattr(response, "response_id", None)
            usage_metadata = getattr(response, "usage_metadata", None)
            if usage_metadata:
                input_tokens = usage_metadata.prompt_token_count or 0
                output_tokens = usage_metadata.candidates_token_count or 0

        allowed_names = {tool.name for tool in tools}
        if any(call.name not in allowed_names for call in calls):
            raise ValueError("LLM returned an undeclared tool call")

        self._record_actual_usage(input_tokens, output_tokens)
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
        if not workflow_run_id:
            raise ValueError("workflow_run_id is required")
        if not node_name:
            raise ValueError("node_name is required")

        check_prompt_safety(prompt)
        max_tokens_to_use = (
            max_tokens if max_tokens is not None else self.max_tokens_per_call
        )
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
        actual_cost = estimate_cost(self.model, input_tokens, output_tokens)
        self.budget_tracker.check_budget_and_accumulate(
            input_tokens,
            output_tokens,
            actual_cost,
        )

    @staticmethod
    def _parse_json_arguments(value: str) -> dict[str, Any]:
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError("LLM tool call arguments were not valid JSON") from exc
        if not isinstance(parsed, dict):
            raise ValueError("LLM tool call arguments must be an object")
        return parsed

    @staticmethod
    def _validate_tool_definitions(tools: list[LLMToolDefinition]) -> None:
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
