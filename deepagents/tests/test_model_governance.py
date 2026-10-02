from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain.agents.middleware import ModelResponse, ModelRetryMiddleware, PIIMiddleware

from middleware.model_governance import (
    MODEL_GOVERNANCE_MIDDLEWARE,
    TRIAGE_MODEL_GOVERNANCE_MIDDLEWARE,
)
from middleware.usage_metering import UsageMeteringMiddleware
from middleware.provider_fallback import ProviderFallbackMiddleware
from middleware.token_fallback import TokenFallbackMiddleware


def test_model_governance_redacts_standard_and_lcsp_credentials() -> None:
    pii_middleware = {
        middleware.pii_type: middleware
        for middleware in MODEL_GOVERNANCE_MIDDLEWARE
        if isinstance(middleware, PIIMiddleware)
    }

    assert set(pii_middleware) == {
        "email",
        "credit_card",
        "github_token",
        "bearer_token",
        "aws_access_key",
        "anthropic_key",
        "credential_assignment",
    }
    assert all(
        middleware.apply_to_output and middleware.apply_to_tool_results
        for middleware in pii_middleware.values()
    )


def test_provider_fallback_wraps_same_provider_key_rotation() -> None:
    provider_index = next(
        index
        for index, item in enumerate(MODEL_GOVERNANCE_MIDDLEWARE)
        if isinstance(item, ProviderFallbackMiddleware)
    )
    token_index = next(
        index
        for index, item in enumerate(MODEL_GOVERNANCE_MIDDLEWARE)
        if isinstance(item, TokenFallbackMiddleware)
    )
    assert provider_index < token_index


def test_usage_metering_is_the_innermost_governed_model_boundary() -> None:
    metering_index = next(
        index
        for index, item in enumerate(MODEL_GOVERNANCE_MIDDLEWARE)
        if isinstance(item, UsageMeteringMiddleware)
    )
    assert metering_index == len(MODEL_GOVERNANCE_MIDDLEWARE) - 1


def test_lcsp_effective_middleware_has_no_model_call_limit() -> None:
    middleware = (
        *MODEL_GOVERNANCE_MIDDLEWARE,
        *TRIAGE_MODEL_GOVERNANCE_MIDDLEWARE,
    )
    assert "ModelCallLimitMiddleware" not in {
        type(item).__name__ for item in middleware
    }


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_exhausted_model_retries_preserve_original_error(monkeypatch, asynchronous) -> None:
    retry = next(
        item for item in MODEL_GOVERNANCE_MIDDLEWARE
        if isinstance(item, ModelRetryMiddleware)
    )
    monkeypatch.setattr(retry, "initial_delay", 0)
    error = RuntimeError("provider rejected structured output")
    handler = AsyncMock(side_effect=error) if asynchronous else MagicMock(side_effect=error)

    with pytest.raises(RuntimeError) as caught:
        if asynchronous:
            await retry.awrap_model_call(MagicMock(), handler)
        else:
            retry.wrap_model_call(MagicMock(), handler)

    assert caught.value is error
    assert handler.call_count == 3


def test_model_retry_preserves_structured_response_after_transient_failure(monkeypatch) -> None:
    retry = next(
        item for item in MODEL_GOVERNANCE_MIDDLEWARE
        if isinstance(item, ModelRetryMiddleware)
    )
    monkeypatch.setattr(retry, "initial_delay", 0)
    response = ModelResponse(result=[], structured_response={"outcome": "FAILED"})
    handler = MagicMock(side_effect=[RuntimeError("temporary provider failure"), response])

    assert retry.wrap_model_call(MagicMock(), handler) is response
    assert handler.call_count == 2


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_schema_error_never_retries(asynchronous):
    from middleware.failure_policy import TerminalSchemaError
    retry = next(item for item in MODEL_GOVERNANCE_MIDDLEWARE if isinstance(item, ModelRetryMiddleware))
    error = TerminalSchemaError("invalid schema")
    handler = AsyncMock(side_effect=error) if asynchronous else MagicMock(side_effect=error)
    with pytest.raises(TerminalSchemaError):
        if asynchronous:
            await retry.awrap_model_call(MagicMock(), handler)
        else:
            retry.wrap_model_call(MagicMock(), handler)
    assert handler.call_count == 1


def test_schema_repair_message_stops_before_next_model_call():
    from langchain.agents.structured_output import AutoStrategy
    from langchain_core.messages import ToolMessage
    from pydantic import BaseModel
    from middleware.model_governance import StopSchemaRepairMiddleware
    from middleware.failure_policy import TerminalSchemaError

    class Answer(BaseModel):
        count: int

    request = MagicMock(response_format=AutoStrategy(Answer))
    handler = MagicMock(return_value=ModelResponse(result=[ToolMessage(
        content="Please fix the validation error", tool_call_id="one", name="Answer"
    )]))
    with pytest.raises(TerminalSchemaError) as caught:
        StopSchemaRepairMiddleware().wrap_model_call(request, handler)
    assert handler.call_count == 1
    # A provider model's own rejected output is provider-specific: fallback may move on.
    from middleware.failure_policy import StructuredOutputRejected

    assert isinstance(caught.value, StructuredOutputRejected)


def test_provider_strategy_bypasses_schema_repair_tool_check():
    from langchain.agents.structured_output import ProviderStrategy
    from langchain_core.messages import ToolMessage
    from pydantic import BaseModel
    from middleware.model_governance import StopSchemaRepairMiddleware

    class Answer(BaseModel):
        count: int

    response = ModelResponse(result=[ToolMessage(
        content="native provider strategy should not synthesize repair tools",
        tool_call_id="one",
        name="Answer",
    )])
    request = MagicMock(response_format=ProviderStrategy(Answer))
    handler = MagicMock(return_value=response)

    assert StopSchemaRepairMiddleware().wrap_model_call(request, handler) is response
    assert handler.call_count == 1


@pytest.mark.parametrize("invalid_tool", [False, True])
def test_agent_stops_after_one_malformed_model_response(invalid_tool):
    from langchain.agents import create_agent
    from langchain.agents.structured_output import ToolStrategy
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.tools import tool
    from pydantic import BaseModel
    from middleware.failure_policy import TerminalSchemaError
    from middleware.model_governance import StopSchemaRepairMiddleware

    class Answer(BaseModel):
        count: int

    class MalformedModel(BaseChatModel):
        calls: int = 0

        @property
        def _llm_type(self):
            return "schema-test"

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.calls += 1
            message = AIMessage(content="", tool_calls=[{
                "name": "count_items" if invalid_tool else "Answer",
                "args": {"count": "not-an-integer"}, "id": "one", "type": "tool_call",
            }])
            return ChatResult(generations=[ChatGeneration(message=message)])

    @tool
    def count_items(count: int) -> int:
        """Count items."""
        raise AssertionError("invalid arguments must never execute")

    model = MalformedModel()
    agent = create_agent(
        model=model, tools=[count_items] if invalid_tool else [],
        response_format=ToolStrategy(Answer),
        middleware=[ModelRetryMiddleware(max_retries=2, retry_on=lambda e: False), StopSchemaRepairMiddleware()],
    )
    from middleware.failure_policy import MalformedToolCallSample

    # Invalid tool arguments are rejected at the model boundary (retryable sample);
    # invalid structured output stays a terminal schema error.
    expected = MalformedToolCallSample if invalid_tool else TerminalSchemaError
    with pytest.raises(expected):
        agent.invoke({"messages": [{"role": "user", "content": "count"}]})
    assert model.calls == 1


@pytest.mark.parametrize("strategy_type", ["tool", "auto"])
@pytest.mark.parametrize(
    "content",
    [
        "I would ask the customer about the deployment.",
        '{"count": "not-an-integer"}',
        'Here you go: {"count": 3}',
    ],
)
def test_text_only_answer_without_exact_schema_json_is_a_provider_rejection(strategy_type, content):
    from langchain.agents.structured_output import AutoStrategy, ToolStrategy
    from langchain_core.messages import AIMessage
    from pydantic import BaseModel
    from middleware.failure_policy import StructuredOutputRejected, is_structured_output_rejection
    from middleware.model_governance import StopSchemaRepairMiddleware

    class Answer(BaseModel):
        count: int

    strategy = ToolStrategy(Answer) if strategy_type == "tool" else AutoStrategy(Answer)
    request = MagicMock(response_format=strategy)
    handler = MagicMock(return_value=ModelResponse(result=[AIMessage(content=content)]))

    with pytest.raises(StructuredOutputRejected) as caught:
        StopSchemaRepairMiddleware().wrap_model_call(request, handler)
    # Provider fallback treats this as provider-specific and moves to the next route.
    assert is_structured_output_rejection(caught.value)


@pytest.mark.parametrize("content", ['{"count": 3}', '```json\n{"count": 3}\n```'])
def test_text_only_answer_that_is_exact_schema_json_becomes_the_structured_response(content):
    from langchain.agents.structured_output import ToolStrategy
    from langchain_core.messages import AIMessage
    from pydantic import BaseModel
    from middleware.model_governance import StopSchemaRepairMiddleware

    class Answer(BaseModel):
        count: int

    message = AIMessage(content=content)
    request = MagicMock(response_format=ToolStrategy(Answer))
    handler = MagicMock(return_value=ModelResponse(result=[message]))

    response = StopSchemaRepairMiddleware().wrap_model_call(request, handler)

    assert response.structured_response == Answer(count=3)
    assert response.result == [message]


def test_tool_calling_answer_is_left_to_the_agent_loop():
    from langchain.agents.structured_output import ToolStrategy
    from langchain_core.messages import AIMessage
    from pydantic import BaseModel
    from middleware.model_governance import StopSchemaRepairMiddleware

    class Answer(BaseModel):
        count: int

    response = ModelResponse(result=[AIMessage(content="", tool_calls=[
        {"name": "read_evidence", "args": {}, "id": "call-1", "type": "tool_call"},
    ])])
    request = MagicMock(response_format=ToolStrategy(Answer))

    assert StopSchemaRepairMiddleware().wrap_model_call(request, MagicMock(return_value=response)) is response


def test_tool_call_cut_off_by_the_output_cap_is_resampled_not_terminal():
    from langchain.agents import create_agent
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.tools import tool
    from middleware.failure_policy import retry_model_error
    from middleware.model_governance import StopSchemaRepairMiddleware

    executed: list[str] = []

    class TruncatingModel(BaseChatModel):
        calls: int = 0

        @property
        def _llm_type(self):
            return "truncation-test"

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                # Arguments cut mid-JSON when the provider hit its output cap.
                message = AIMessage(
                    content="",
                    invalid_tool_calls=[{
                        "name": "execute", "args": '{"command": "sed -n', "id": "one",
                        "error": None, "type": "invalid_tool_call",
                    }],
                    response_metadata={"finish_reason": "length"},
                )
            elif self.calls == 2:
                message = AIMessage(content="", tool_calls=[{
                    "name": "execute", "args": {"command": "ls"}, "id": "two", "type": "tool_call",
                }])
            else:
                message = AIMessage(content="done")
            return ChatResult(generations=[ChatGeneration(message=message)])

    @tool
    def execute(command: str) -> str:
        """Run a command."""
        executed.append(command)
        return "ok"

    model = TruncatingModel()
    agent = create_agent(
        model=model, tools=[execute],
        middleware=[
            ModelRetryMiddleware(max_retries=2, retry_on=retry_model_error, initial_delay=0),
            StopSchemaRepairMiddleware(),
        ],
    )
    agent.invoke({"messages": [{"role": "user", "content": "scan"}]})

    assert model.calls == 3
    # The cut-off call never reached the tool; only the re-sampled one ran.
    assert executed == ["ls"]


def test_complete_tool_call_is_not_mistaken_for_truncation():
    from langchain_core.messages import AIMessage
    from middleware.model_governance import StopSchemaRepairMiddleware

    response = ModelResponse(result=[AIMessage(
        content="",
        tool_calls=[{"name": "execute", "args": {"command": "ls"}, "id": "one", "type": "tool_call"}],
        response_metadata={"finish_reason": "tool_calls"},
    )])
    request = MagicMock(response_format=None)

    assert StopSchemaRepairMiddleware().wrap_model_call(request, MagicMock(return_value=response)) is response


def test_tool_call_with_schema_invalid_arguments_is_resampled_before_the_tool_runs():
    from langchain.agents import create_agent
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.tools import tool
    from middleware.failure_policy import retry_model_error
    from middleware.model_governance import StopSchemaRepairMiddleware

    executed: list[str] = []

    class SloppyModel(BaseChatModel):
        calls: int = 0

        @property
        def _llm_type(self):
            return "invalid-args-test"

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                # Completed normally, but the arguments miss the required field.
                message = AIMessage(content="", tool_calls=[{
                    "name": "execute", "args": {"cmd": "ls"}, "id": "one", "type": "tool_call",
                }], response_metadata={"finish_reason": "tool_calls"})
            elif self.calls == 2:
                message = AIMessage(content="", tool_calls=[{
                    "name": "execute", "args": {"command": "ls"}, "id": "two", "type": "tool_call",
                }])
            else:
                message = AIMessage(content="done")
            return ChatResult(generations=[ChatGeneration(message=message)])

    @tool
    def execute(command: str) -> str:
        """Run a command."""
        executed.append(command)
        return "ok"

    model = SloppyModel()
    agent = create_agent(
        model=model, tools=[execute],
        middleware=[
            ModelRetryMiddleware(max_retries=2, retry_on=retry_model_error, initial_delay=0),
            StopSchemaRepairMiddleware(),
        ],
    )
    agent.invoke({"messages": [{"role": "user", "content": "scan"}]})

    assert model.calls == 3
    assert executed == ["ls"]
