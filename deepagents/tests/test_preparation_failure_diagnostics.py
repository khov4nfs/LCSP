from __future__ import annotations

import pytest
from langgraph.errors import NodeCancelledError

from orchestration.agent_stream import (
    AgentStreamSession,
    activate_agent_stream,
    publish_agent_stream_event,
)
from rule_set_preparation import runner


RUN_ID = "11111111-1111-4111-8111-111111111111"


class _Api:
    def __init__(self) -> None:
        self.failure_reason: str | None = None

    def claim_rule_set_preparation(self, run_id: str) -> dict:
        return {"chunks": [], "legalSourceVersionId": "pinned-source"}

    def fail_rule_set_preparation(self, run_id: str, reason: str) -> dict:
        self.failure_reason = reason
        return {"preparationRunId": run_id, "executionState": "FAILED"}


class _FailingAgent:
    def __init__(self, event_type: str, error: Exception) -> None:
        self.event_type = event_type
        self.error = error

    def invoke(self, _input: dict, *, config: dict) -> None:
        publish_agent_stream_event(
            self.event_type,
            status=(
                "FAILED"
                if self.event_type in {"MODEL_CALL_FAILED", "MODEL_CALL_TIMEOUT"}
                else "COMPLETED"
            ),
            data={
                "model_step_id": "logical-call-7",
                "invocation_id": "provider-attempt-8",
                "provider": "inception",
                "model": "mercury-2.5",
                "operation_type": "SUMMARIZATION",
                "error_type": "RateLimitError",
                "http_status": 429,
                "retryability": "RETRYABLE",
                "fallback_eligibility": True,
                "attempt_ordinal": 2,
                "route_ordinal": 1,
                "credential_slot_safe_id": "CREDENTIAL_SLOT_02",
                "last_attempt_error_class": "RateLimitError",
                "last_attempt_http_status": 429,
                "last_attempt_retryability": "RETRYABLE",
                "last_attempt_fallback_eligibility": True,
                "provider_attempts": 2,
                "fallback_used": True,
                "providers_attempted": ["inception", "gemini"],
                "usage": {"input_tokens": 123},
                "prompt": "private source content",
            },
        )
        if self.event_type == "MODEL_CALL_COMPLETED":
            for callback in config["callbacks"]:
                callback.on_tool_start(
                    {"name": "glob"},
                    "secret source args",
                    run_id="tool-run-1",
                    inputs={"path": "/legal-source/secret.md"},
                )
        raise self.error


def _run_failure(monkeypatch, event_type: str, error: Exception):
    api = _Api()
    events: list[dict] = []
    session = AgentStreamSession(
        assessment_id=None,
        run_id=RUN_ID,
        correlation_id="correlation-1",
        boundary_name="rule_set_preparation",
        emit_payload=events.append,
        boundary_type="PREPARATION",
        boundary_id=RUN_ID,
        preparation_run_id=RUN_ID,
    )
    monkeypatch.setattr(runner, "materialize_legal_source", lambda *_: [])
    monkeypatch.setattr(runner, "create_rule_set_preparation_agent", lambda **_: _FailingAgent(event_type, error))
    with activate_agent_stream(session):
        result = runner.run_rule_set_preparation(api, RUN_ID)
    return api, events, result


def test_graph_failure_after_model_success_is_not_attributed_to_active_tool(monkeypatch) -> None:
    api, events, result = _run_failure(
        monkeypatch,
        "MODEL_CALL_COMPLETED",
        RuntimeError("Authorization: Bearer do-not-persist-this"),
    )

    assert api.failure_reason == runner.RUNTIME_ERROR
    assert result["failureReason"] == runner.RUNTIME_ERROR
    failure = next(event for event in events if event.get("data", {}).get("activity_kind") == "PREPARATION_FAILURE")
    assert failure["data"]["terminal_stage"] == "AGENT_GRAPH"
    assert failure["data"]["durability"] == "DURABLE"
    assert failure["data"]["safe_error_category"] == "RUNTIME_ERROR"
    assert failure["data"]["active_tool_names"] == ["glob"]
    assert failure["data"]["last_completed_model_call"]["model_step_id"] == "logical-call-7"
    assert failure["data"]["last_completed_model_call"]["provider_attempts"] == 2
    assert "failing_model_call" not in failure["data"]
    serialized = str(failure["data"])
    assert "do-not-persist-this" not in serialized
    assert "secret source args" not in serialized
    assert "private source content" not in serialized
    assert "usage" not in failure["data"]["last_completed_model_call"]


def test_exhausted_model_call_remains_model_error_with_safe_route_context(monkeypatch) -> None:
    api, events, result = _run_failure(
        monkeypatch,
        "MODEL_CALL_FAILED",
        RuntimeError("raw provider response must not persist"),
    )

    assert api.failure_reason == runner.MODEL_ERROR
    failure = next(event for event in events if event.get("data", {}).get("activity_kind") == "PREPARATION_FAILURE")
    assert failure["data"]["terminal_stage"] == "AGENT_GRAPH"
    assert failure["data"]["failing_model_call"]["event_type"] == "MODEL_CALL_FAILED"
    failing = failure["data"]["failing_model_call"]
    assert failing["provider"] == "inception"
    assert failing["operation_type"] == "SUMMARIZATION"
    assert failing["http_status"] == 429
    assert failing["retryability"] == "RETRYABLE"
    assert failing["fallback_eligibility"] is True
    assert failing["attempt_ordinal"] == 2
    assert failing["route_ordinal"] == 1
    assert failing["credential_slot_safe_id"] == "CREDENTIAL_SLOT_02"
    assert failing["last_attempt_error_class"] == "RateLimitError"
    assert failing["last_attempt_http_status"] == 429
    assert failing["providers_attempted"] == ["inception", "gemini"]
    assert "raw provider response" not in str(events)
    assert result["error"] == {"type": "RuntimeError", "stage": "AGENT_GRAPH"}


def test_explicit_model_timeout_remains_model_error(monkeypatch) -> None:
    api, events, _ = _run_failure(monkeypatch, "MODEL_CALL_TIMEOUT", TimeoutError("private timeout body"))

    assert api.failure_reason == runner.MODEL_ERROR
    failure = next(event for event in events if event.get("data", {}).get("activity_kind") == "PREPARATION_FAILURE")
    assert failure["data"]["failing_model_call"]["event_type"] == "MODEL_CALL_TIMEOUT"
    assert "private timeout body" not in str(events)


def test_unobserved_graph_exception_uses_generic_runtime_reason(monkeypatch) -> None:
    api, events, _ = _run_failure(monkeypatch, "NO_MODEL_EVENT", RuntimeError("private diagnostic"))

    assert api.failure_reason == runner.RUNTIME_ERROR
    failure = next(event for event in events if event.get("data", {}).get("activity_kind") == "PREPARATION_FAILURE")
    assert failure["data"]["safe_error_category"] == "RUNTIME_ERROR"
    assert "failing_model_call" not in failure["data"]
    assert "private diagnostic" not in str(events)


def test_node_cancellation_is_not_converted_to_runtime_or_model_error(monkeypatch) -> None:
    api = _Api()
    monkeypatch.setattr(runner, "materialize_legal_source", lambda *_: [])
    monkeypatch.setattr(
        runner,
        "create_rule_set_preparation_agent",
        lambda **_: _FailingAgent("MODEL_CALL_CANCELLED", NodeCancelledError("cancelled")),
    )

    with pytest.raises(NodeCancelledError):
        runner.run_rule_set_preparation(api, RUN_ID)

    assert api.failure_reason is None


def test_stream_session_retains_only_allowlisted_model_call_metadata() -> None:
    session = AgentStreamSession(None, RUN_ID, "correlation-1", "preparation", lambda _: None)
    session.emit(
        "MODEL_CALL_COMPLETED",
        data={
            "model_step_id": "step-1",
            "provider": "inception",
            "model": "mercury-2.5",
            "operation_type": "SUMMARIZATION",
            "http_status": 429,
            "retryability": "RETRYABLE",
            "fallback_eligibility": True,
            "usage": {"input_tokens": 99},
            "prompt": "not retained",
        },
    )

    assert session.model_call_diagnostics()["last_completed_model_call"] == {
        "event_type": "MODEL_CALL_COMPLETED",
        "model_step_id": "step-1",
        "provider": "inception",
        "model": "mercury-2.5",
        "operation_type": "SUMMARIZATION",
        "http_status": 429,
        "retryability": "RETRYABLE",
        "fallback_eligibility": True,
    }
