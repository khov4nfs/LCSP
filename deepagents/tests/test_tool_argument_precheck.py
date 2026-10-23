"""The governance pre-check judges a sampled tool call the same way for every tool form.

Production: the Gemini compatibility rewrite replaces ``request.tools`` with plain dicts, so the
pre-check (which only understood ``BaseTool``) never ran for Gemini and an invalid sample went
straight to the tool node, where it ended the run. These tests are provider-free: models are only
instantiated, never called.
"""

from __future__ import annotations

from typing import Literal
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain.agents.middleware import ModelResponse
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage
from langchain_core.tools import StructuredTool
from langchain_core.utils.function_calling import convert_to_openai_tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, ConfigDict, Field
from structlog.testing import capture_logs

from middleware.failure_policy import MalformedToolCallSample
from middleware.model_governance import StopSchemaRepairMiddleware, _malformed_tool_call_reason
from middleware.provider_schema import ProviderSchemaCompatibilityMiddleware, gemini_compatible_tools
from middleware.tool_contracts import ORIGINAL_REQUEST_TOOLS, request_tool_contracts

SECRET = "PRIVATE_LEGAL_TEXT"


class TaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str
    subagent_type: str
    compliance: Literal["COMPLIANT", "NON_COMPLIANT"] | None = None
    tags: list[str] = Field(default_factory=list, max_length=3)


def _tool(*, answers_itself: bool = False) -> StructuredTool:
    return StructuredTool.from_function(
        func=lambda **_: "ok",
        name="task",
        description="Delegate a task.",
        args_schema=TaskArgs,
        handle_validation_error=(lambda error: "fix your arguments") if answers_itself else False,
    )


def _gemini() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", google_api_key="test-key")


def _openai() -> ChatOpenAI:
    return ChatOpenAI(model="gpt-test", api_key="test-key")


def _anthropic() -> ChatAnthropic:
    return ChatAnthropic(model="claude-test", api_key="test-key")


def _request(model, tools):
    request = MagicMock()
    request.model = model
    request.response_format = None
    request.model_settings = {}
    request.tools = list(tools)

    def _override(**kwargs):
        forwarded = _request(model, kwargs.get("tools", request.tools))
        forwarded.model_settings = kwargs.get("model_settings", request.model_settings)
        return forwarded

    request.override = MagicMock(side_effect=_override)
    return request


def _response(args: dict) -> ModelResponse:
    call = {"name": "task", "args": args, "id": "one", "type": "tool_call"}
    return ModelResponse(result=[AIMessage(content="", tool_calls=[call])])


VALID = {"description": "read the source", "subagent_type": "reader", "compliance": None}
BROKEN = {"description": [SECRET]}  # wrong type for one field, a required field missing


def _forms():
    """Every way the same ``task`` contract can reach the pre-check."""
    anthropic_dict = {
        "name": "task",
        "description": "Delegate a task.",
        "input_schema": TaskArgs.model_json_schema(),
    }
    return {
        "native tool, anthropic model": (_anthropic(), [_tool()]),
        "native tool, openai model": (_openai(), [_tool()]),
        "openai function dict": (_openai(), [convert_to_openai_tool(_tool())]),
        "anthropic input_schema dict": (_anthropic(), [anthropic_dict]),
        "gemini rewritten dict": (_gemini(), gemini_compatible_tools(_gemini(), [_tool()])),
    }


@pytest.mark.parametrize("form", list(_forms()))
def test_valid_arguments_are_never_flagged_in_any_tool_form(form):
    model, tools = _forms()[form]
    assert _malformed_tool_call_reason(_request(model, tools), _response(VALID)) is None
    # JSON null for an optional field and a missing optional field are both valid.
    no_optional = {"description": "d", "subagent_type": "s"}
    assert _malformed_tool_call_reason(_request(model, tools), _response(no_optional)) is None


@pytest.mark.parametrize("form", list(_forms()))
def test_malformed_and_missing_arguments_are_flagged_in_any_tool_form(form):
    model, tools = _forms()[form]
    reason = _malformed_tool_call_reason(_request(model, tools), _response(BROKEN))

    assert reason is not None and reason.startswith("Model emitted invalid arguments for tool task (")
    assert "description" in reason  # wrong type
    assert "subagent_type:missing" in reason  # missing required field
    assert SECRET not in reason  # field paths and error kinds only


@pytest.mark.parametrize("form", ["gemini rewritten dict", "openai function dict", "anthropic input_schema dict"])
def test_dict_forms_flag_an_enum_violation_without_echoing_the_value(form):
    model, tools = _forms()[form]
    args = {**VALID, "compliance": SECRET}
    reason = _malformed_tool_call_reason(_request(model, tools), _response(args))
    assert reason == "Model emitted invalid arguments for tool task (compliance:anyOf)"
    assert SECRET not in reason


def test_native_tool_reason_keeps_its_established_wording():
    reason = _malformed_tool_call_reason(_request(_anthropic(), [_tool()]), _response(BROKEN))
    assert reason == (
        "Model emitted invalid arguments for tool task "
        "(description:string_type; subagent_type:missing)"
    )


@pytest.mark.parametrize("model_factory", [_anthropic, _gemini])
def test_authoritative_extra_forbid_survives_langchain_subset_and_provider_rewrite(model_factory):
    request = _request(model_factory(), [_tool()])
    seen = {}
    def handler(forwarded):
        seen["reason"] = _malformed_tool_call_reason(forwarded, _response({**VALID, "traversal": SECRET}))
        return _response(VALID)
    ProviderSchemaCompatibilityMiddleware().wrap_model_call(request, handler)
    assert seen["reason"] == "Model emitted invalid arguments for tool task (traversal:extra_forbidden)"
    assert SECRET not in seen["reason"]


def test_authoritative_schema_does_not_require_runtime_injected_arguments_from_model():
    from typing import Annotated
    from langchain_core.tools import InjectedToolArg
    class InjectedArgs(BaseModel):
        description: str
        runtime_value: Annotated[str, InjectedToolArg]
    tool = StructuredTool.from_function(func=lambda **_: "ok", name="task",
        description="Read a source description while the runtime supplies the private injected argument.", args_schema=InjectedArgs)
    request = _request(_anthropic(), [tool])
    assert _malformed_tool_call_reason(request, _response({"description": "read"})) is None


def test_gemini_rewrite_replaces_tools_with_dicts_yet_the_inner_check_still_sees_the_real_contract():
    model = _gemini()
    request = _request(model, [_tool()])
    seen = {}

    def handler(forwarded):
        seen["tools"] = list(forwarded.tools)
        seen["original_during_call"] = ORIGINAL_REQUEST_TOOLS.get()
        seen["reason"] = _malformed_tool_call_reason(forwarded, _response(BROKEN))
        return _response(VALID)

    ProviderSchemaCompatibilityMiddleware().wrap_model_call(request, handler)

    assert all(isinstance(tool, dict) for tool in seen["tools"])  # the production condition
    assert seen["original_during_call"] is not None
    assert seen["reason"] is not None and "subagent_type:missing" in seen["reason"]
    assert ORIGINAL_REQUEST_TOOLS.get() is None  # published only for the duration of the call


@pytest.mark.asyncio
async def test_gemini_rewrite_publishes_and_releases_the_original_tools_asynchronously():
    request = _request(_gemini(), [_tool()])
    seen = {}

    async def handler(forwarded):
        seen["reason"] = _malformed_tool_call_reason(forwarded, _response(BROKEN))
        return _response(VALID)

    await ProviderSchemaCompatibilityMiddleware().awrap_model_call(request, AsyncMock(side_effect=handler))
    assert seen["reason"] is not None and "subagent_type:missing" in seen["reason"]
    assert ORIGINAL_REQUEST_TOOLS.get() is None


def test_other_providers_are_not_rewritten_and_publish_nothing():
    request = _request(_anthropic(), [_tool()])
    seen = {}

    def handler(forwarded):
        seen["same_tools"] = forwarded.tools == request.tools
        seen["published"] = ORIGINAL_REQUEST_TOOLS.get()
        return _response(VALID)

    ProviderSchemaCompatibilityMiddleware().wrap_model_call(request, handler)
    assert seen == {"same_tools": True, "published": None}


@pytest.mark.parametrize("model_factory", [_anthropic, _gemini])
def test_a_tool_that_answers_invalid_arguments_itself_is_not_discarded_for_any_provider(model_factory):
    model = model_factory()
    request = _request(model, [_tool(answers_itself=True)])
    seen = {}

    def handler(forwarded):
        seen["reason"] = _malformed_tool_call_reason(forwarded, _response(BROKEN))
        return _response(VALID)

    ProviderSchemaCompatibilityMiddleware().wrap_model_call(request, handler)
    assert seen["reason"] is None


def test_an_unreadable_contract_never_discards_a_sample():
    """The tool node still validates authoritatively, so an unreadable contract stays fail-closed there."""
    broken_schema_tool = {"name": "task", "input_schema": {"type": "not-a-json-schema-type"}}
    nameless = {"input_schema": {"type": "object"}}
    request = _request(_anthropic(), [broken_schema_tool, nameless, {"type": "web_search"}])
    assert request_tool_contracts(request) == {}
    assert _malformed_tool_call_reason(request, _response(BROKEN)) is None


def test_unparseable_and_output_cap_samples_keep_their_existing_reasons():
    cut_off = AIMessage(
        content="",
        tool_calls=[],
        invalid_tool_calls=[{"name": "task", "args": "{\"descr", "id": "one", "error": "bad json"}],
    )
    reason = _malformed_tool_call_reason(
        _request(_gemini(), gemini_compatible_tools(_gemini(), [_tool()])),
        ModelResponse(result=[cut_off]),
    )
    assert reason == "Model emitted unparseable tool-call arguments"


def test_telemetry_and_error_for_a_rejected_gemini_sample_carry_no_argument_values():
    request = _request(_gemini(), [_tool()])
    middleware = StopSchemaRepairMiddleware()

    def through_gemini(forwarded):
        return middleware.wrap_model_call(forwarded, lambda inner: _response(BROKEN))

    with capture_logs() as logs, pytest.raises(MalformedToolCallSample) as raised:
        ProviderSchemaCompatibilityMiddleware().wrap_model_call(request, through_gemini)

    assert "subagent_type:missing" in str(raised.value)
    assert SECRET not in str(raised.value)
    assert SECRET not in repr(logs)
    assert any(entry["event"] == "MODEL_MALFORMED_TOOL_CALL_SAMPLE" for entry in logs)


@pytest.mark.parametrize("model_factory", [_anthropic, _gemini])
def test_a_native_tool_with_a_plain_json_schema_keeps_answering_bad_arguments_itself(model_factory):
    """The tool node does not validate JSON-schema arguments, so the pre-check must not either."""
    json_schema_tool = StructuredTool.from_function(
        func=lambda **_: "ok",
        name="task",
        description="Delegate a task.",
        args_schema={
            "type": "object",
            "properties": {"reason": {"type": "string", "enum": ["A", "B"]}},
            "required": ["reason"],
        },
        infer_schema=False,
    )
    request = _request(model_factory(), [json_schema_tool])
    seen = {}

    def handler(forwarded):
        seen["reason"] = _malformed_tool_call_reason(
            forwarded, _response({"reason": "NOT_IN_THE_ENUM"})
        )
        return _response(VALID)

    ProviderSchemaCompatibilityMiddleware().wrap_model_call(request, handler)
    assert seen["reason"] is None
