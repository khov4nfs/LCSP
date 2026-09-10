from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain.agents.middleware import ModelResponse, ModelRetryMiddleware, PIIMiddleware

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE


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
    with pytest.raises(TerminalSchemaError):
        StopSchemaRepairMiddleware().wrap_model_call(request, handler)
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
    with pytest.raises(TerminalSchemaError):
        agent.invoke({"messages": [{"role": "user", "content": "count"}]})
    assert model.calls == 1
