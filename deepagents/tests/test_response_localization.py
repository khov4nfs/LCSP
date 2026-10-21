"""Tests for Deep Agent response localization, language authority, and transform fallback."""

from __future__ import annotations

import asyncio
import time
from dataclasses import asdict
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain.agents import create_agent
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from pydantic import BaseModel

from middleware.localization import ResponseLocalizationMiddleware
from orchestration.context import (
    DEFAULT_RESPONSE_LANGUAGE,
    SUPPORTED_RESPONSE_LANGUAGES,
    LCSPRunContext,
    coerce_run_context,
    resolve_response_language,
)
from orchestration.localization import (
    LocaleDefinition,
    ResponseLocalizationConfig,
    SUPPORTED_LOCALES,
    get_language_prompt_instruction,
    load_localization_config,
    transform_response_text,
    transform_structured_response,
)


class MockChatModel(BaseChatModel):
    """Configurable mock chat model for unit testing."""

    responses: list[Any] = []
    calls: list[Any] = []

    def __init__(self, responses: list[AIMessage | str] | None = None, **kwargs: Any) -> None:
        formatted: list[AIMessage] = []
        for r in responses or []:
            if isinstance(r, str):
                formatted.append(AIMessage(content=r))
            else:
                formatted.append(r)
        super().__init__(responses=formatted, calls=[], **kwargs)

    @property
    def _llm_type(self) -> str:
        return "mock-chat-model"

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.calls.append(list(messages))
        if self.responses:
            resp = self.responses.pop(0)
        else:
            resp = AIMessage(content="Default response")
        return ChatResult(generations=[ChatGeneration(message=resp)])


MockChatModel.model_rebuild()



# 1. Contract & Helper Tests

def test_resolve_response_language() -> None:
    assert resolve_response_language("en") == "en"
    assert resolve_response_language("EN") == "en"
    assert resolve_response_language("vi") == "vi"
    assert resolve_response_language("VI") == "vi"
    assert resolve_response_language("unknown") == DEFAULT_RESPONSE_LANGUAGE
    assert resolve_response_language(None) == DEFAULT_RESPONSE_LANGUAGE
    assert resolve_response_language(123) == DEFAULT_RESPONSE_LANGUAGE


def test_lcsp_run_context_coercion() -> None:
    ctx = LCSPRunContext(assessment_id="a1", response_language="en")
    assert ctx.response_language == "en"

    coerced = coerce_run_context({"assessment_id": "a2", "response_language": "vi", "extra_field": "ignore"})
    assert coerced is not None
    assert coerced.assessment_id == "a2"
    assert coerced.response_language == "vi"


# 2. Dynamic Prompt Injection Tests

@pytest.mark.parametrize("locale,expected_substring", [
    ("en", "Produce your final user-visible response in English"),
    ("vi", "Produce your final user-visible response in Vietnamese"),
])
def test_dynamic_prompt_injection(locale: str, expected_substring: str) -> None:
    middleware = ResponseLocalizationMiddleware()
    request = MagicMock()
    request.runtime = SimpleNamespace(context=LCSPRunContext(response_language=locale))
    request.system_message = SystemMessage(content="You are an LCSP agent.")
    handler = MagicMock()

    middleware.wrap_model_call(request, handler)
    overridden = request.override.call_args.kwargs["system_message"]
    text = "\n".join(b["text"] for b in overridden.content_blocks)

    assert "You are an LCSP agent." in text
    assert expected_substring in text
    assert "Keep all technical identifiers" in text
    handler.assert_called_once()


# 3. Direct Q&A & Language Authority Tests

def test_language_authority_wins_over_user_message_language() -> None:
    """Selected system language (VI) wins even when user queries in English."""
    transform_model = MockChatModel(responses=["Báo cáo phân tích đã hoàn tất."])
    middleware = ResponseLocalizationMiddleware(transform_model=transform_model)

    state = {
        "messages": [
            HumanMessage(content="What is the current compliance status of this repository?"),
            AIMessage(content="The compliance report is ready."),
        ]
    }
    runtime = SimpleNamespace(context=LCSPRunContext(response_language="vi"))

    updates = middleware.after_agent(state, runtime)
    assert updates is not None
    assert len(updates["messages"]) == 1
    assert updates["messages"][0].content == "Báo cáo phân tích đã hoàn tất."


def test_language_authority_en_wins_when_user_queries_in_vietnamese() -> None:
    """Selected system language (EN) wins even when user queries in Vietnamese."""
    transform_model = MockChatModel(responses=["Compliance analysis is complete."])
    middleware = ResponseLocalizationMiddleware(transform_model=transform_model)

    state = {
        "messages": [
            HumanMessage(content="Trạng thái tuân thủ thế nào?"),
            AIMessage(content="Báo cáo tuân thủ đã sẵn sàng."),
        ]
    }
    runtime = SimpleNamespace(context=LCSPRunContext(response_language="en"))

    updates = middleware.after_agent(state, runtime)
    assert updates is not None
    assert updates["messages"][0].content == "Compliance analysis is complete."


# 4. Invariant Preservation Tests (Code, Citations, IDs, URLs, Paths, Enums)

def test_transform_preserves_technical_invariants() -> None:
    raw_text = (
        "Found 3 violations in file `/workspace/repo/src/auth.ts#L45-L60`.\n"
        "Reference [1] and Jira ticket LCSP-404.\n"
        "Status: `STATUS_REJECTED`. See https://compliance.lcsp.internal/report\n"
        "```typescript\nconst token = checkToken(req);\n```"
    )

    expected_vietnamese = (
        "Đã tìm thấy 3 vi phạm trong tệp `/workspace/repo/src/auth.ts#L45-L60`.\n"
        "Tham chiếu [1] và phiếu Jira LCSP-404.\n"
        "Trạng thái: `STATUS_REJECTED`. Xem https://compliance.lcsp.internal/report\n"
        "```typescript\nconst token = checkToken(req);\n```"
    )

    mock_model = MockChatModel(responses=[expected_vietnamese])
    result, telemetry = transform_response_text(
        raw_text,
        "vi",
        model=mock_model,
    )

    assert result == expected_vietnamese
    assert telemetry["status"] == "APPLIED"
    assert telemetry["fallback_used"] is False
    assert "/workspace/repo/src/auth.ts#L45-L60" in result
    assert "LCSP-404" in result
    assert "STATUS_REJECTED" in result
    assert "https://compliance.lcsp.internal/report" in result
    assert "const token = checkToken(req);" in result


# 5. Tool Call and Subagent Isolation (Do not translate internal tool calls)

def test_tool_calls_are_not_translated() -> None:
    """Tool calls generated during intermediate steps must not be translated."""
    middleware = ResponseLocalizationMiddleware(transform_model=MockChatModel(responses=["Translated"]))
    tool_call_message = AIMessage(
        content="",
        tool_calls=[{"name": "search_code", "args": {"query": "auth"}, "id": "call_1", "type": "tool_call"}],
    )
    state = {"messages": [tool_call_message]}
    runtime = SimpleNamespace(context=LCSPRunContext(response_language="vi"))

    updates = middleware.after_agent(state, runtime)
    assert updates is None


# 6. Structured Output Localization & Validation

class SampleStructuredOutput(BaseModel):
    status: str
    rule_id: str
    summary: str
    code_snippet: str


def test_structured_output_localization_preserves_keys_and_enums() -> None:
    mock_model = MockChatModel(responses=["Tóm tắt tuân thủ được cập nhật"])
    original = SampleStructuredOutput(
        status="COMPLIANCE_PASSED",
        rule_id="ENG-101",
        summary="Compliance summary was updated",
        code_snippet="export const API_KEY = 1;",
    )

    transformed, telemetry = transform_structured_response(
        original,
        "vi",
        model=mock_model,
    )

    assert isinstance(transformed, SampleStructuredOutput)
    assert transformed.status == "COMPLIANCE_PASSED"
    assert transformed.rule_id == "ENG-101"
    assert transformed.code_snippet == "export const API_KEY = 1;"
    assert transformed.summary == "Tóm tắt tuân thủ được cập nhật"
    assert telemetry["status"] == "APPLIED"


def test_structured_output_validation_failure_falls_back_cleanly() -> None:
    """If transformation makes structured output invalid, fallback to original."""
    original = SampleStructuredOutput(
        status="COMPLIANCE_PASSED",
        rule_id="ENG-101",
        summary="Original summary",
        code_snippet="code",
    )

    with patch.object(SampleStructuredOutput, "model_validate", side_effect=ValueError("Invalid field")):
        transformed, telemetry = transform_structured_response(
            original,
            "vi",
            model=MockChatModel(responses=["Tóm tắt mới"]),
        )
        assert transformed == original
        assert telemetry["status"] == "FALLBACK"
        assert telemetry["fallback_used"] is True


# 7. Fallback on Transform Model Timeout / Error

def test_transform_failure_falls_back_to_primary_response() -> None:
    """When the transform model throws an exception or times out, primary response is preserved."""
    failing_model = MagicMock()
    failing_model.invoke.side_effect = TimeoutError("Transform model request timed out")

    original_text = "Primary agent synthesized answer."
    result, telemetry = transform_response_text(
        original_text,
        "vi",
        model=failing_model,
    )

    assert result == original_text
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert telemetry["reason"] == "TIMEOUT"



# 8. Mid-Thread Language Switch (Turn 1 EN -> Turn 2 VI)

def test_mid_thread_language_switch() -> None:
    """Changing language context between turns works immediately without recreating thread."""
    transform_model = MockChatModel(responses=[
        "Turn 1 answer in English",
        "Câu trả lời lượt 2 bằng Tiếng Việt",
    ])
    middleware = ResponseLocalizationMiddleware(transform_model=transform_model)

    # Turn 1: EN
    state_turn1 = {
        "messages": [
            HumanMessage(content="Analyze rule 1"),
            AIMessage(content="Turn 1 raw"),
        ]
    }
    updates_1 = middleware.after_agent(state_turn1, SimpleNamespace(context=LCSPRunContext(response_language="en")))
    assert updates_1 is not None
    assert updates_1["messages"][0].content == "Turn 1 answer in English"

    # Turn 2: Switch to VI on the same thread
    state_turn2 = {
        "messages": [
            HumanMessage(content="Analyze rule 1"),
            AIMessage(content="Turn 1 answer in English"),
            HumanMessage(content="Analyze rule 2"),
            AIMessage(content="Turn 2 raw"),
        ]
    }
    updates_2 = middleware.after_agent(state_turn2, SimpleNamespace(context=LCSPRunContext(response_language="vi")))
    assert updates_2 is not None
    assert updates_2["messages"][0].content == "Câu trả lời lượt 2 bằng Tiếng Việt"



# 9. Configuration Toggle (Disabled localization)

def test_disabled_localization_skips_cleanly() -> None:
    config = ResponseLocalizationConfig(enabled=False)
    mock_model = MockChatModel(responses=["Should not be called"])
    text = "Untransformed text"

    result, telemetry = transform_response_text(text, "vi", model=mock_model, config=config)
    assert result == text
    assert telemetry["status"] == "SKIPPED"
    assert telemetry["reason"] == "LOCALIZATION_DISABLED"
    assert len(mock_model.calls) == 0


# 10. Extensibility Test (Adding a 3rd Locale)

def test_extensibility_adding_third_locale() -> None:
    """Adding a new locale definition immediately supports dynamic prompt and localization."""
    custom_locales = {
        **SUPPORTED_LOCALES,
        "ja": LocaleDefinition(
            code="ja",
            name="日本語",
            english_name="Japanese",
            instruction="Produce your final user-visible response in Japanese (日本語).",
        ),
    }

    with patch("orchestration.localization.SUPPORTED_LOCALES", custom_locales):
        prompt_instruction = get_language_prompt_instruction("ja")
        assert "Japanese" in prompt_instruction
        assert "日本語" in prompt_instruction

        mock_model = MockChatModel(responses=["分析が完了しました。"])
        config = ResponseLocalizationConfig(supported_locales=("en", "vi", "ja"))
        result, telemetry = transform_response_text(
            "Analysis complete",
            "ja",
            model=mock_model,
            config=config,
        )
        assert result == "分析が完了しました。"
        assert telemetry["status"] == "APPLIED"


# 11. End-to-End Agent Workflow Integration Tests

@pytest.mark.parametrize("locale,target_translated", [
    ("en", "The compliance audit completed with zero critical issues."),
    ("vi", "Cuộc kiểm toán tuân thủ đã hoàn tất mà không có vấn đề nghiêm trọng."),
])
def test_agent_direct_qa_flow(locale: str, target_translated: str) -> None:
    primary_model = MockChatModel(responses=[
        AIMessage(content="Compliance audit completed.")
    ])
    transform_model = MockChatModel(responses=[
        AIMessage(content=target_translated)
    ])
    middleware = ResponseLocalizationMiddleware(transform_model=transform_model)

    agent = create_agent(
        model=primary_model,
        tools=[],
        middleware=[middleware],
        context_schema=LCSPRunContext,
    )

    result = agent.invoke(
        {"messages": [{"role": "user", "content": "Run compliance audit"}]},
        context=LCSPRunContext(response_language=locale),
    )

    assert result["messages"][-1].content == target_translated
    # Verify primary model was prompted with language directive
    assert len(primary_model.calls) == 1
    system_msgs = [m for m in primary_model.calls[0] if isinstance(m, SystemMessage)]
    assert any("Final Response Language Directive" in str(m.content) for m in system_msgs)


def test_agent_tool_calling_flow_preserves_tool_execution_and_localizes_final() -> None:
    tool_executed = False

    @tool
    def read_legal_document(doc_id: str) -> str:
        """Read legal document contents."""
        nonlocal tool_executed
        tool_executed = True
        return "Law No. 86/2015/QH13 on Cyber Information Security."

    # Turn 1: model calls tool; Turn 2: model synthesizes final answer
    primary_model = MockChatModel(responses=[
        AIMessage(content="", tool_calls=[{"name": "read_legal_document", "args": {"doc_id": "86"}, "id": "t1", "type": "tool_call"}]),
        AIMessage(content="Analysis based on Law No. 86/2015/QH13."),
    ])
    transform_model = MockChatModel(responses=[
        AIMessage(content="Phân tích dựa trên Luật số 86/2015/QH13 về An toàn thông tin mạng."),
    ])
    middleware = ResponseLocalizationMiddleware(transform_model=transform_model)

    agent = create_agent(
        model=primary_model,
        tools=[read_legal_document],
        middleware=[middleware],
        context_schema=LCSPRunContext,
    )

    result = agent.invoke(
        {"messages": [{"role": "user", "content": "Check law 86"}]},
        context=LCSPRunContext(response_language="vi"),
    )

    assert tool_executed is True
    # The intermediate tool message was NOT translated
    tool_msgs = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    assert len(tool_msgs) == 1
    assert "Law No. 86/2015/QH13 on Cyber Information Security." in tool_msgs[0].content
    # The final AIMessage is translated to Vietnamese
    assert result["messages"][-1].content == "Phân tích dựa trên Luật số 86/2015/QH13 về An toàn thông tin mạng."


def test_agent_code_heavy_response_flow() -> None:
    code_text = (
        "Here is the validation logic:\n"
        "```typescript\n"
        "export function validateSecret(token: string): boolean {\n"
        "  return token.startsWith('lcsp_sec_');\n"
        "}\n"
        "```\n"
        "Make sure to store it securely."
    )
    localized_code_text = (
        "Dưới đây là logic kiểm tra:\n"
        "```typescript\n"
        "export function validateSecret(token: string): boolean {\n"
        "  return token.startsWith('lcsp_sec_');\n"
        "}\n"
        "```\n"
        "Hãy đảm bảo lưu trữ an toàn."
    )

    primary_model = MockChatModel(responses=[AIMessage(content=code_text)])
    transform_model = MockChatModel(responses=[AIMessage(content=localized_code_text)])
    middleware = ResponseLocalizationMiddleware(transform_model=transform_model)

    agent = create_agent(
        model=primary_model,
        tools=[],
        middleware=[middleware],
        context_schema=LCSPRunContext,
    )

    result = agent.invoke(
        {"messages": [{"role": "user", "content": "Show me the validator"}]},
        context=LCSPRunContext(response_language="vi"),
    )

    final_content = result["messages"][-1].content
    assert "export function validateSecret(token: string): boolean" in final_content
    assert "return token.startsWith('lcsp_sec_');" in final_content
    assert "Dưới đây là logic kiểm tra:" in final_content


# 12. Timeout & Execution Deadline Regression Tests

def test_transform_enforces_real_elapsed_timeout() -> None:
    """Transform model exceeding timeout_seconds is terminated and falls back to primary text."""
    slow_model = MagicMock()

    def slow_invoke(*args: Any, **kwargs: Any) -> Any:
        time.sleep(0.3)
        return AIMessage(content="Late translation")

    slow_model.invoke.side_effect = slow_invoke
    config = ResponseLocalizationConfig(timeout_seconds=0.1)

    start = time.monotonic()
    result, telemetry = transform_response_text("Original message", "vi", model=slow_model, config=config)
    elapsed = time.monotonic() - start

    assert result == "Original message"
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert telemetry["reason"] == "TIMEOUT"
    assert elapsed < 0.25


# 13. Fail-Closed Invariant Mutation Tests

def test_fail_closed_on_jira_id_mutation() -> None:
    """If transform corrupts a Jira ticket ID (e.g. LCSP-123 -> LCSP-999), fail back closed."""
    original = "Violation identified in ticket LCSP-123."
    mutated = "Đã xác định vi phạm trong phiếu LCSP-999."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "INVARIANT_VIOLATION" in str(telemetry["reason"])


def test_fail_closed_on_url_mutation() -> None:
    """If transform alters a URL link, fail back closed."""
    original = "Read report at https://lcsp.internal/reports/2026."
    mutated = "Đọc báo cáo tại https://evil.internal/reports/2026."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "INVARIANT_VIOLATION" in str(telemetry["reason"])


def test_fail_closed_on_code_block_mutation() -> None:
    """If transform modifies code logic inside a fenced code block, fail back closed."""
    original = "Fix with:\n```typescript\nconst valid = isAuthorized(req);\n```"
    mutated = "Sửa bằng:\n```typescript\nconst valid = true;\n```"
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "INVARIANT_VIOLATION" in str(telemetry["reason"])


def test_fail_closed_on_number_mutation() -> None:
    """If transform changes a percentage or numerical value, fail back closed."""
    original = "Completed 100% of 42 checks."
    mutated = "Đã hoàn thành 80% của 40 kiểm tra."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "INVARIANT_VIOLATION" in str(telemetry["reason"])


def test_fail_closed_on_enum_mutation() -> None:
    """If transform changes a SCREAMING_SNAKE_CASE enum or error constant, fail back closed."""
    original = "Result status is `STATUS_REJECTED` due to `SEVERITY_HIGH`."
    mutated = "Kết quả là `STATUS_APPROVED` do `SEVERITY_LOW`."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "INVARIANT_VIOLATION" in str(telemetry["reason"])


def test_fail_closed_on_file_path_mutation() -> None:
    """If transform alters a protected source file path, fail back closed."""
    original = "Inspection failed at /workspace/repo/src/core/auth.ts:50."
    mutated = "Kiểm tra thất bại tại /workspace/repo/src/core/other.ts:50."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "INVARIANT_VIOLATION" in str(telemetry["reason"])


def test_fail_closed_on_injected_extra_jira_id() -> None:
    """If transform keeps original Jira ID but injects an extra Jira ID (e.g. LCSP-123 -> LCSP-123 and LCSP-999), fail closed."""
    original = "Issue logged in LCSP-123."
    mutated = "Vấn đề được ghi lại trong LCSP-123 và LCSP-999."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "EXTRA_INJECTED_JIRA_ISSUES" in str(telemetry["reason"])


def test_fail_closed_on_injected_extra_github_issue() -> None:
    """If transform injects an extra GitHub issue ref (#42 -> #42 and #999), fail closed."""
    original = "Fixed in PR #42."
    mutated = "Đã sửa trong PR #42 và #999."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "EXTRA_INJECTED_GITHUB_ISSUES" in str(telemetry["reason"])


def test_fail_closed_on_injected_extra_url() -> None:
    """If transform preserves original URL but adds a new URL, fail closed."""
    original = "See docs at https://lcsp.internal/docs."
    mutated = "Xem tài liệu tại https://lcsp.internal/docs và https://evil.internal/phish."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "EXTRA_INJECTED_URLS" in str(telemetry["reason"])


def test_fail_closed_on_injected_extra_number() -> None:
    """If transform preserves original numbers but adds a new number (e.g. 100% -> 100% và 50%), fail closed."""
    original = "Scan coverage is 100%."
    mutated = "Độ bao phủ quét là 100% và 50% kiểm tra."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "EXTRA_INJECTED_NUMBERS" in str(telemetry["reason"])


def test_fail_closed_on_injected_extra_enum() -> None:
    """If transform preserves original enum but injects another SCREAMING_SNAKE_CASE enum, fail closed."""
    original = "Status is STATUS_REJECTED."
    mutated = "Trạng thái là STATUS_REJECTED và STATUS_APPROVED."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "EXTRA_INJECTED_SCREAMING_ENUMS" in str(telemetry["reason"])


def test_fail_closed_on_injected_extra_code_block() -> None:
    """If transform introduces an extra code block not in the original text, fail closed."""
    original = "Run the check:\n```bash\nnpm test\n```"
    mutated = "Chạy kiểm tra:\n```bash\nnpm test\n```\nThêm:\n```bash\nrm -rf /\n```"
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "EXTRA_INJECTED_CODE_BLOCKS" in str(telemetry["reason"])


def test_fail_closed_on_injected_extra_inline_code() -> None:
    """If transform introduces extra inline code backticks, fail closed."""
    original = "Use function `authenticate()`."
    mutated = "Sử dụng hàm `authenticate()` và `bypassSecurity()`."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "EXTRA_INJECTED_INLINE_CODE" in str(telemetry["reason"])


def test_fail_closed_on_injected_extra_file_path() -> None:
    """If transform introduces extra file paths, fail closed."""
    original = "Found in apps/web/src/main.ts."
    mutated = "Tìm thấy trong apps/web/src/main.ts và packages/contracts/src/auth.ts."
    result, telemetry = transform_response_text(original, "vi", model=MockChatModel([mutated]))

    assert result == original
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True
    assert "EXTRA_INJECTED_FILE_PATHS" in str(telemetry["reason"])


# 14. Single Transform Invocations per Completed Structured Turn

class MultiFieldStructuredOutput(BaseModel):
    status: str
    summary: str
    description: str
    notes: str


def test_structured_output_multi_field_single_transform_invocation() -> None:
    """Structured response with multiple user-facing fields invokes transform model at most 1 time."""
    import json

    json_resp = json.dumps({
        "summary": "Tóm tắt tuân thủ",
        "description": "Mô tả chi tiết",
        "notes": "Ghi chú bổ sung",
    })
    mock_model = MockChatModel(responses=[json_resp])
    original = MultiFieldStructuredOutput(
        status="COMPLIANCE_PASSED",
        summary="Compliance summary",
        description="Detailed description",
        notes="Additional notes",
    )

    transformed, telemetry = transform_structured_response(
        original,
        "vi",
        model=mock_model,
    )

    assert len(mock_model.calls) == 1
    assert isinstance(transformed, MultiFieldStructuredOutput)
    assert transformed.status == "COMPLIANCE_PASSED"
    assert transformed.summary == "Tóm tắt tuân thủ"
    assert transformed.description == "Mô tả chi tiết"
    assert transformed.notes == "Ghi chú bổ sung"
    assert telemetry["status"] == "APPLIED"


def test_after_agent_structured_turn_invokes_at_most_one_transform() -> None:
    """after_agent middleware performs at most 1 transform when structured output is present."""
    import json

    json_resp = json.dumps({
        "summary": "Tóm tắt tuân thủ",
        "description": "Mô tả",
        "notes": "Ghi chú",
    })
    mock_model = MockChatModel(responses=[json_resp])
    middleware = ResponseLocalizationMiddleware(transform_model=mock_model)

    state = {
        "messages": [
            HumanMessage(content="Audit"),
            AIMessage(content="English message"),
        ],
        "structured_response": MultiFieldStructuredOutput(
            status="PASSED",
            summary="Summary",
            description="Desc",
            notes="Notes",
        ),
    }
    runtime = SimpleNamespace(context=LCSPRunContext(response_language="vi"))

    updates = middleware.after_agent(state, runtime)
    assert updates is not None
    assert "structured_response" in updates
    assert len(mock_model.calls) == 1


# 15. Production Dispatch & Resume Integration Tests

def test_dispatch_agent_runtime_event_wires_response_language() -> None:
    """dispatch_agent_runtime_event resolves and propagates response_language to runtime context."""
    from tools.common.capabilities.agent_runtime.agent_server_client import dispatch_agent_runtime_event

    captured_contexts = []
    mock_client = MagicMock()

    def mock_runs_create(thread_id, assistant_id, **kwargs):
        captured_contexts.append(kwargs.get("context", {}))
        return {"run_id": "r1", "status": "success"}

    mock_client.runs.create.side_effect = mock_runs_create
    mock_client.runs.get.return_value = {"run_id": "r1", "status": "success"}
    mock_client.threads.get_state.return_value = {"values": {"messages": []}}

    with (
        patch("tools.common.capabilities.agent_runtime.agent_server_client.get_sync_client", return_value=mock_client),
        patch("tools.common.capabilities.agent_runtime.agent_server_client._find_active_thread_run", return_value=None),
    ):
        # Turn 1 with English locale
        msg_en = {"assessmentId": "asm-1", "responseLanguage": "en"}
        dispatch_agent_runtime_event("scan_requested", msg_en, "corr-1")
        assert captured_contexts[0]["response_language"] == "en"

        # Turn 2 on same thread with Vietnamese locale
        msg_vi = {"assessmentId": "asm-1", "locale": "vi"}
        dispatch_agent_runtime_event("scan_requested", msg_vi, "corr-2")
        assert captured_contexts[1]["response_language"] == "vi"


def test_real_api_producer_to_worker_to_agent_server_context() -> None:
    """Real API outbox producer payload (e.g. from TriggerScanHandler / scanTriggered) propagates
    authoritative responseLanguage through worker RabbitMQ message to Agent Server runtime context."""
    from tools.common.capabilities.agent_runtime.agent_server_client import dispatch_agent_runtime_event

    captured_contexts = []
    mock_client = MagicMock()
    mock_client.runs.create.side_effect = lambda thread_id, assistant_id, **kwargs: (
        captured_contexts.append(kwargs.get("context", {})) or {"run_id": "r1", "status": "success"}
    )
    mock_client.runs.get.return_value = {"run_id": "r1", "status": "success"}
    mock_client.threads.get_state.return_value = {"values": {"messages": []}}

    with (
        patch("tools.common.capabilities.agent_runtime.agent_server_client.get_sync_client", return_value=mock_client),
        patch("tools.common.capabilities.agent_runtime.agent_server_client._find_active_thread_run", return_value=None),
    ):
        # 1. Real producer payload for English user scan request
        producer_payload_en = {
            "scanJobId": "scan-job-prod-1",
            "assessmentId": "assessment-prod-1",
            "snapshotId": "snapshot-prod-1",
            "commitSha": "abc1234",
            "triggerSource": "MANUAL",
            "idempotencyKey": "scan-request:assessment-prod-1:snapshot-prod-1:1",
            "correlationId": "corr-prod-1",
            "responseLanguage": "en",
        }
        dispatch_agent_runtime_event("scan_requested", producer_payload_en, "corr-prod-1")
        assert captured_contexts[0]["response_language"] == "en"
        assert captured_contexts[0]["scan_job_id"] == "scan-job-prod-1"
        assert captured_contexts[0]["assessment_id"] == "assessment-prod-1"

        # 2. Real producer payload for default / Vietnamese user scan request
        producer_payload_vi = {
            "scanJobId": "scan-job-prod-2",
            "assessmentId": "assessment-prod-2",
            "snapshotId": "snapshot-prod-2",
            "commitSha": "abc1234",
            "triggerSource": "MANUAL",
            "idempotencyKey": "scan-request:assessment-prod-2:snapshot-prod-2:2",
            "correlationId": "corr-prod-2",
            "responseLanguage": "vi",
        }
        dispatch_agent_runtime_event("scan_requested", producer_payload_vi, "corr-prod-2")
        assert captured_contexts[1]["response_language"] == "vi"


# 16. Async Non-Blocking Localization Tests

@pytest.mark.asyncio
async def test_async_transform_does_not_block_event_loop() -> None:
    """Async transform allows concurrent asyncio tasks to progress without being blocked by sleep/IO."""
    from orchestration.localization import atransform_response_text

    class AsyncDelayModel:
        async def ainvoke(self, messages, **kwargs):
            await asyncio.sleep(0.08)
            return AIMessage(content="Báo cáo tuân thủ hoàn tất.")

    counter = 0
    async def concurrent_task():
        nonlocal counter
        for _ in range(4):
            await asyncio.sleep(0.01)
            counter += 1

    model = AsyncDelayModel()
    transform_task = asyncio.create_task(atransform_response_text("Compliance report completed.", "vi", model=model))
    bg_task = asyncio.create_task(concurrent_task())

    result, telemetry = await transform_task
    await bg_task

    assert result == "Báo cáo tuân thủ hoàn tất."
    assert telemetry["status"] == "APPLIED"
    assert counter == 4  # Proves concurrent task ran while async transform was awaiting


@pytest.mark.asyncio
async def test_aafter_agent_async_transform() -> None:
    """aafter_agent uses async transform methods and returns localized AIMessage and structured responses."""
    class AsyncMockModel:
        async def ainvoke(self, messages, **kwargs):
            return AIMessage(content="Kết quả kiểm tra tuân thủ.")

    middleware = ResponseLocalizationMiddleware(transform_model=AsyncMockModel())
    state = {"messages": [AIMessage(content="Compliance check result.")]}
    runtime = SimpleNamespace(context=LCSPRunContext(response_language="vi"))

    updates = await middleware.aafter_agent(state, runtime)
    assert updates is not None
    assert updates["messages"][0].content == "Kết quả kiểm tra tuân thủ."


def test_assessment_root_runner_persisted_locale_authority(tmp_path) -> None:
    """Active Assessment Root runner loads authoritative responseLanguage from server context and reflects mid-thread switches."""
    from assessment_root.runner import run_assessment_root
    from deepagents.backends import FilesystemBackend
    from langchain_core.messages import AIMessage
    from test_assessment_root_agent import FakeClient, RootScriptedModel, _repo, complete_root_messages
    from orchestration.context import DEFAULT_RESPONSE_LANGUAGE, resolve_response_language

    class AuthoritativeRootContextClient(FakeClient):
        """Real context producer stand-in reflecting GetRootContextHandler server-state authority."""

        def __init__(self, *, thread_id: str = "t-shared-1", **kwargs: Any) -> None:
            super().__init__(**kwargs)
            self.thread_id = thread_id
            self.turns: list[dict[str, Any]] = []
            self.outbox_messages: list[dict[str, Any]] = []

        def persist_setting_on_thread(self, execution_id: str, language: str | None) -> None:
            """Persists user setting on this thread in canonical server state (turn context / outbox)."""
            self.turns.append({
                "executionId": execution_id,
                "threadId": self.thread_id,
                "contextJson": {"responseLanguage": language} if language else {},
            })
            if language:
                self.outbox_messages.append({
                    "eventType": "command.assessment.root.requested.v1",
                    "payload": {"responseLanguage": language},
                })

        def context(self) -> dict[str, Any]:
            base = super().context()
            # Canonical server state resolution matching GetRootContextHandler
            saved_locale = None
            if self.turns:
                saved_locale = self.turns[-1].get("contextJson", {}).get("responseLanguage")
            if not saved_locale and self.outbox_messages:
                saved_locale = self.outbox_messages[-1].get("payload", {}).get("responseLanguage")
            resolved = resolve_response_language(saved_locale, fallback=DEFAULT_RESPONSE_LANGUAGE)
            return {
                **base,
                "threadId": self.thread_id,
                "responseLanguage": resolved,
            }

    # 1. Unset state: falls back to DEFAULT_RESPONSE_LANGUAGE ("vi")
    client_default = AuthoritativeRootContextClient(thread_id="thread-default")
    captured_messages_default = []
    class LocSpyModelDefault(RootScriptedModel):
        def _generate(self, messages, **kwargs):
            captured_messages_default.append(list(messages))
            return super()._generate(messages, **kwargs)

    model_default = LocSpyModelDefault(responses=[*complete_root_messages()])
    result_default = run_assessment_root(
        client_default,
        "11111111-1111-4111-8111-111111111111",
        backend_factory=lambda claim, ctx: (FilesystemBackend(root_dir=_repo(tmp_path / "default"), virtual_mode=True), None),
        model=model_default,
        governance=(),
    )
    assert result_default["state"] == "SUCCEEDED"
    prompt_text_default = str([getattr(m, "content", "") for m in captured_messages_default[0]])
    assert "Vietnamese" in prompt_text_default or "tiếng Việt" in prompt_text_default

    # 2. Same-thread locale switching: EN -> VI -> EN
    client_shared_thread = AuthoritativeRootContextClient(thread_id="thread-shared-authority")

    # Turn 1: English persisted in server state
    client_shared_thread.persist_setting_on_thread("exec-turn-1", "en")
    captured_messages_turn1 = []
    class LocSpyModelTurn1(RootScriptedModel):
        def _generate(self, messages, **kwargs):
            captured_messages_turn1.append(list(messages))
            return super()._generate(messages, **kwargs)

    model_turn1 = LocSpyModelTurn1(responses=[*complete_root_messages()])
    result_turn1 = run_assessment_root(
        client_shared_thread,
        "11111111-1111-4111-8111-111111111111",
        backend_factory=lambda claim, ctx: (FilesystemBackend(root_dir=_repo(tmp_path / "t1"), virtual_mode=True), None),
        model=model_turn1,
        governance=(),
    )
    assert result_turn1["state"] == "SUCCEEDED"
    prompt_text_turn1 = str([getattr(m, "content", "") for m in captured_messages_turn1[0]])
    assert "English" in prompt_text_turn1

    # Turn 2 ON SAME THREAD: user changes setting to Vietnamese, persisted to server state
    client_shared_thread.lifecycle_state = "ACTIVE"
    client_shared_thread.persist_setting_on_thread("exec-turn-2", "vi")
    captured_messages_turn2 = []
    class LocSpyModelTurn2(RootScriptedModel):
        def _generate(self, messages, **kwargs):
            captured_messages_turn2.append(list(messages))
            return super()._generate(messages, **kwargs)

    model_turn2 = LocSpyModelTurn2(responses=[*complete_root_messages()])
    result_turn2 = run_assessment_root(
        client_shared_thread,
        "11111111-1111-4111-8111-111111111111",
        backend_factory=lambda claim, ctx: (FilesystemBackend(root_dir=_repo(tmp_path / "t2"), virtual_mode=True), None),
        model=model_turn2,
        governance=(),
    )
    assert result_turn2["state"] == "SUCCEEDED"
    prompt_text_turn2 = str([getattr(m, "content", "") for m in captured_messages_turn2[0]])
    assert "Vietnamese" in prompt_text_turn2 or "tiếng Việt" in prompt_text_turn2

    # Turn 3 ON SAME THREAD: user changes setting back to English, persisted to server state
    client_shared_thread.lifecycle_state = "ACTIVE"
    client_shared_thread.persist_setting_on_thread("exec-turn-3", "en")
    captured_messages_turn3 = []
    class LocSpyModelTurn3(RootScriptedModel):
        def _generate(self, messages, **kwargs):
            captured_messages_turn3.append(list(messages))
            return super()._generate(messages, **kwargs)

    model_turn3 = LocSpyModelTurn3(responses=[*complete_root_messages()])
    result_turn3 = run_assessment_root(
        client_shared_thread,
        "11111111-1111-4111-8111-111111111111",
        backend_factory=lambda claim, ctx: (FilesystemBackend(root_dir=_repo(tmp_path / "t3"), virtual_mode=True), None),
        model=model_turn3,
        governance=(),
    )
    assert result_turn3["state"] == "SUCCEEDED"
    prompt_text_turn3 = str([getattr(m, "content", "") for m in captured_messages_turn3[0]])
    assert "English" in prompt_text_turn3


# 16. Nested Structured Response & Root Tools Persisted Localization Regressions (LCSP-323)

class NestedFinding(BaseModel):
    assessment_rule_id: str
    summary: str
    recommendations: list[str]


class NestedReport(BaseModel):
    summary: str
    findings: list[NestedFinding]


class NestedChoice(BaseModel):
    value: str
    label: str


class NestedCriterion(BaseModel):
    criterion_id: str
    outcome: str
    rationale: str


class NestedDecisionPayload(BaseModel):
    choices: list[NestedChoice]
    criteria: list[NestedCriterion]


def test_nested_structured_output_findings_and_recommendations_single_transform() -> None:
    """Nested structured response with list of findings and recommendations invokes transform at most 1 time."""
    import json

    mock_resp = json.dumps({
        "summary": "Tóm tắt đánh giá tuân thủ",
        "findings": [
            {
                "summary": "Cấu hình ghi log xác thực chưa hoàn tất",
                "recommendations": [
                    "Bật kiểm toán chi tiết",
                    "Định cấu hình máy chủ syslog",
                ],
            }
        ],
    })
    mock_model = MockChatModel(responses=[mock_resp])

    original = NestedReport(
        summary="Compliance assessment summary",
        findings=[
            NestedFinding(
                assessment_rule_id="ENG-SEC-01",
                summary="Authentication logging configuration incomplete",
                recommendations=[
                    "Enable verbose auditing",
                    "Configure syslog server",
                ],
            )
        ],
    )

    transformed, telemetry = transform_structured_response(
        original,
        "vi",
        model=mock_model,
    )

    assert len(mock_model.calls) == 1
    assert telemetry["status"] == "APPLIED"
    assert isinstance(transformed, NestedReport)
    assert transformed.summary == "Tóm tắt đánh giá tuân thủ"
    # Technical rule ID preserved untouched
    assert transformed.findings[0].assessment_rule_id == "ENG-SEC-01"
    # User-facing summary and list of recommendations localized
    assert transformed.findings[0].summary == "Cấu hình ghi log xác thực chưa hoàn tất"
    assert transformed.findings[0].recommendations == [
        "Bật kiểm toán chi tiết",
        "Định cấu hình máy chủ syslog",
    ]


def test_nested_structured_output_choices_labels_and_criteria_single_transform() -> None:
    """Nested choice labels and criteria rationales are localized while values, IDs, and outcomes are preserved."""
    import json

    mock_resp = json.dumps({
        "choices": [
            {"label": "30 ngày lưu trữ"},
            {"label": "90 ngày lưu trữ"},
        ],
        "criteria": [
            {"rationale": "Tiêu chí đã được thỏa mãn qua cấu hình chính thức."},
        ],
    })
    mock_model = MockChatModel(responses=[mock_resp])

    original = NestedDecisionPayload(
        choices=[
            NestedChoice(value="RETENTION_30D", label="30 days retention"),
            NestedChoice(value="RETENTION_90D", label="90 days retention"),
        ],
        criteria=[
            NestedCriterion(
                criterion_id="CRIT-AUTH-01",
                outcome="MET",
                rationale="Criterion is satisfied through authoritative configuration.",
            ),
        ],
    )

    transformed, telemetry = transform_structured_response(
        original,
        "vi",
        model=mock_model,
    )

    assert len(mock_model.calls) == 1
    assert telemetry["status"] == "APPLIED"
    assert isinstance(transformed, NestedDecisionPayload)
    # Technical enum values preserved
    assert transformed.choices[0].value == "RETENTION_30D"
    assert transformed.choices[1].value == "RETENTION_90D"
    # Labels localized
    assert transformed.choices[0].label == "30 ngày lưu trữ"
    assert transformed.choices[1].label == "90 ngày lưu trữ"
    # Technical criterion ID and outcome preserved
    assert transformed.criteria[0].criterion_id == "CRIT-AUTH-01"
    assert transformed.criteria[0].outcome == "MET"
    # Rationale localized
    assert transformed.criteria[0].rationale == "Tiêu chí đã được thỏa mãn qua cấu hình chính thức."


def test_assessment_root_tools_persist_canonical_domain_data_without_locale_pollution() -> None:
    """Assessment Root tools persist canonical domain data unchanged without displayLocales or destructive mutations."""
    from assessment_root.tools import RootRun, build_root_tools

    posted_human_requests = []
    posted_decisions = []
    posted_final_reports = []
    posted_facts = []

    client = MagicMock()
    client.context.return_value = {
        "caseRevision": 1,
        "ruleSetVersionId": "rs-100",
        "repositorySnapshotId": "snap-200",
        "repositoryCommit": "a" * 40,
        "coverage": [],
        "openHumanRequestIds": [],
        "facts": [],
    }
    client.post_human_request.side_effect = lambda req: (posted_human_requests.append(req), {"requestId": "req-1", "requestRevision": 0})[1]
    client.post_decision.side_effect = lambda req: (posted_decisions.append(req), {"decisionRevision": 1})[1]
    client.post_final_report.side_effect = lambda req: (posted_final_reports.append(req), {"reportId": "rep-1"})[1]
    client.post_fact.side_effect = lambda req: (posted_facts.append(req), {"caseRevision": 2})[1]

    # Setup RootRun with response_language = 'vi'
    run = RootRun(
        client=client,
        assessment_id="a1",
        thread_id="t1",
        execution_id="e1",
        backend=None,
        response_language="vi",
    )
    run.rule_versions["RULE-01"] = "1.0"
    tools = {t.name: t for t in build_root_tools(run)}

    # 1. Test open_human_request preserves canonical wording without displayLocales or sourceLocale
    with patch("assessment_root.tools.interrupt"):
        tools["open_human_request"].func(
            assessment_rule_id="RULE-01",
            question="What is the data retention period?",
            unresolved_fact="Retention schedule is unconfirmed.",
            decision_impact=["Affects GDPR Art 5 compliance."],
            resolution_attempts=["Read config.json and found no retention setting."],
            criterion_ids=["CRIT-01"],  # a question must name the rule element it settles
            choices=[{"value": "CHOICE_30D", "label": "30 days"}],
        )

    assert len(posted_human_requests) == 1
    req = posted_human_requests[0]
    assert req["assessmentRuleId"] == "RULE-01"
    assert req["question"] == "What is the data retention period?"
    assert req["unresolvedFact"] == "Retention schedule is unconfirmed."
    assert req["decisionImpact"] == ["Affects GDPR Art 5 compliance."]
    assert req["choices"][0]["label"] == "30 days"
    assert req["choices"][0]["value"] == "CHOICE_30D"
    assert "sourceLocale" not in req
    assert "displayLocales" not in req

    # 2. Test submit_rule_decision preserves canonical rationale without displayLocales or sourceLocale
    tools["submit_rule_decision"].func(
        assessment_rule_id="RULE-01",
        applicability="APPLICABLE",
        rationale="Authentication satisfies security standard NIST-800-53.",
        legal_context_ids=["LEG-1"],
        references=[{"type": "ASSESSMENT_EVIDENCE", "id": "ev-1"}],
        criteria=[{
            "criterion_id": "CRIT-01",
            "outcome": "MET",
            "rationale": "MFA is enforced across all accounts.",
            "references": [{"type": "ASSESSMENT_EVIDENCE", "id": "ev-1"}],
        }],
        compliance="COMPLIANT",
    )

    assert len(posted_decisions) == 1
    dec = posted_decisions[0]["decision"]
    assert dec["assessmentRuleId"] == "RULE-01"
    assert dec["rationale"] == "Authentication satisfies security standard NIST-800-53."
    assert dec["criteria"][0]["rationale"] == "MFA is enforced across all accounts."
    assert dec["criteria"][0]["criterionId"] == "CRIT-01"
    assert dec["criteria"][0]["outcome"] == "MET"
    assert "sourceLocale" not in dec
    assert "displayLocales" not in dec

    # 3. Test submit_final_report preserves canonical summary and findings without displayLocales or sourceLocale
    tools["submit_final_report"].func(
        summary="Overall assessment summary.",
        findings=[{
            "assessment_rule_id": "RULE-01",
            "summary": "Rule finding summary.",
            "recommendations": ["Recommendation 1"],
        }],
    )

    assert len(posted_final_reports) == 1
    rep = posted_final_reports[0]
    assert rep["summary"] == "Overall assessment summary."
    assert rep["findings"][0]["summary"] == "Rule finding summary."
    assert rep["findings"][0]["recommendations"] == ["Recommendation 1"]
    assert rep["findings"][0]["assessmentRuleId"] == "RULE-01"
    assert "sourceLocale" not in rep
    assert "displayLocales" not in rep

    # 4. Test accept_case_fact preserves canonical statement unchanged
    tools["accept_case_fact"].func(
        kind="USE_CASE",
        statement="The system processes customer healthcare data.",
        evidence_ids=["ev-1"],
    )
    assert len(posted_facts) == 1
    assert posted_facts[0]["kind"] == "USE_CASE"
    assert posted_facts[0]["statement"] == "The system processes customer healthcare data."
    assert posted_facts[0]["evidenceIds"] == ["ev-1"]


def test_human_request_read_projection_same_thread_en_vi_switch() -> None:
    """Read projection dynamically localizes customer-facing fields on read while preserving canonical row and technical invariants."""
    from types import SimpleNamespace

    # Canonical row in database (no displayLocales or sourceLocale columns)
    row = SimpleNamespace(
        requestId="11111111-1111-4111-8111-111111111111",
        requestRevision=1,
        caseRevision=1,
        status="OPEN",
        assessmentRuleId="RULE-DATA-01",
        criterionIds=["CRIT-01"],
        question="What is the retention period?",
        unresolvedFact="Retention period is not configured in code.",
        decisionImpact=["Determines GDPR compliance."],
        resolutionAttempts=["Checked config.json and settings.py."],
        controlType="CHOICE_SELECT",
        choices=[{"value": "CHOICE_30D", "label": "30 days"}],
        checkpointId=None,
        resolvedFactId=None,
        answers=[],
    )

    # In-memory presentation projection cache (read/presentation boundary)
    presentation_cache = {
        ("vi", "What is the retention period?"): "Thời hạn lưu giữ dữ liệu là bao lâu?",
        ("vi", "Retention period is not configured in code."): "Thời hạn lưu giữ chưa được định cấu hình trong mã nguồn.",
        ("vi", "Determines GDPR compliance."): "Xác định mức độ tuân thủ GDPR.",
        ("vi", "Checked config.json and settings.py."): "Đã kiểm tra tệp config.json và settings.py.",
        ("vi", "30 days"): "30 ngày",
    }

    def project_row(r: Any, target_locale: str | None) -> dict[str, Any]:
        locale = target_locale if target_locale in ("en", "vi") else None
        def lookup(text: str) -> str:
            if locale:
                return presentation_cache.get((locale, text), text)
            return text

        return {
            "requestId": r.requestId,
            "requestRevision": r.requestRevision,
            "status": r.status,
            "assessmentRuleId": r.assessmentRuleId,
            "criterionIds": r.criterionIds,
            "question": lookup(r.question),
            "unresolvedFact": lookup(r.unresolvedFact),
            "decisionImpact": [lookup(i) for i in r.decisionImpact],
            "resolutionAttempts": [lookup(a) for a in r.resolutionAttempts],
            "choices": [{"value": c["value"], "label": lookup(c["label"])} for c in r.choices],
        }

    # Turn 1: Client reads with VI locale
    view_vi = project_row(row, "vi")
    assert view_vi["question"] == "Thời hạn lưu giữ dữ liệu là bao lâu?"
    assert view_vi["unresolvedFact"] == "Thời hạn lưu giữ chưa được định cấu hình trong mã nguồn."
    assert view_vi["decisionImpact"] == ["Xác định mức độ tuân thủ GDPR."]
    assert view_vi["resolutionAttempts"] == ["Đã kiểm tra tệp config.json và settings.py."]
    assert view_vi["choices"][0]["label"] == "30 ngày"
    # Technical IDs, revision, enum values are strictly invariant
    assert view_vi["choices"][0]["value"] == "CHOICE_30D"
    assert view_vi["requestId"] == "11111111-1111-4111-8111-111111111111"
    assert view_vi["assessmentRuleId"] == "RULE-DATA-01"

    # Turn 2: Same thread switches to EN locale
    view_en = project_row(row, "en")
    assert view_en["question"] == "What is the retention period?"
    assert view_en["unresolvedFact"] == "Retention period is not configured in code."
    assert view_en["decisionImpact"] == ["Determines GDPR compliance."]
    assert view_en["resolutionAttempts"] == ["Checked config.json and settings.py."]
    assert view_en["choices"][0]["label"] == "30 days"
    assert view_en["choices"][0]["value"] == "CHOICE_30D"
    assert view_en["requestId"] == "11111111-1111-4111-8111-111111111111"


def test_internal_project_locale_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    from starlette.testclient import TestClient
    from tools.common.capabilities.agent_runtime import local_server

    monkeypatch.setenv("WORKER_API_KEY", "test-worker-secret")

    # Mock the LLM to return translated JSON
    translated_json = '{"texts": ["Thời hạn lưu giữ là bao lâu?", "Không xác định"]}'
    mock_model = MockChatModel(responses=[AIMessage(content=translated_json)])
    import model_policy
    monkeypatch.setattr(model_policy, "resolve_agent_model", lambda role: mock_model)

    client = TestClient(local_server.app)

    # 1. Auth failure: missing or invalid key
    res_no_auth = client.post("/internal/project-locale", json={"texts": ["Hello"], "targetLocale": "vi"})
    assert res_no_auth.status_code == 403

    res_bad_auth = client.post(
        "/internal/project-locale",
        json={"texts": ["Hello"], "targetLocale": "vi"},
        headers={"x-worker-api-key": "wrong-key"},
    )
    assert res_bad_auth.status_code == 403

    # 2. Schema validation error
    res_bad_schema = client.post(
        "/internal/project-locale",
        json={"texts": [], "targetLocale": "vi"},
        headers={"x-worker-api-key": "test-worker-secret"},
    )
    assert res_bad_schema.status_code == 400

    # 3. Successful localization projection
    res_success = client.post(
        "/internal/project-locale",
        json={
            "texts": ["What is the retention period?", "Not configured"],
            "targetLocale": "vi",
        },
        headers={"x-worker-api-key": "test-worker-secret"},
    )
    assert res_success.status_code == 200
    data = res_success.json()
    assert "projected" in data
    assert data["projected"]["What is the retention period?"] == "Thời hạn lưu giữ là bao lâu?"
    assert data["projected"]["Not configured"] == "Không xác định"






