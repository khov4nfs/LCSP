from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from langgraph.types import interrupt

from middleware.durable_budget_kernel import (
    ASSESSMENT_ROOT_SCOPE,
    RULE_SET_PREPARATION_SCOPE,
    CALL_LIMIT_EXCEEDED,
    TOKEN_LIMIT_EXCEEDED,
    NO_PROGRESS_LIMIT_EXCEEDED,
    WorkloadBudgetLimits,
    WorkloadCumulativeUsage,
    resolve_workload_limits,
    evaluate_workload_admission,
    record_workload_progress,
)
from assessment_root.runtime_control import RootRuntimeControl


def test_resolve_workload_limits_defaults(monkeypatch):
    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_MODEL_CALLS", raising=False)
    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_INPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_TOTAL_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_ASSESSMENT_NO_PROGRESS_LIMIT", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_MODEL_CALLS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_INPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_TOTAL_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_NO_PROGRESS_LIMIT", raising=False)

    root_limits = resolve_workload_limits(ASSESSMENT_ROOT_SCOPE)
    assert root_limits.max_model_calls is None
    assert root_limits.max_input_tokens is None
    assert root_limits.max_output_tokens is None
    assert root_limits.max_total_tokens is None
    assert root_limits.no_progress_limit is None

    rsp_limits = resolve_workload_limits(RULE_SET_PREPARATION_SCOPE)
    assert rsp_limits.max_model_calls is None
    assert rsp_limits.max_input_tokens is None
    assert rsp_limits.max_output_tokens is None
    assert rsp_limits.max_total_tokens is None
    assert rsp_limits.no_progress_limit is None


def test_unconstrained_workload_admission_exceeds_historical_limits(monkeypatch):
    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_MODEL_CALLS", raising=False)
    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_INPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_TOTAL_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_ASSESSMENT_NO_PROGRESS_LIMIT", raising=False)

    limits = resolve_workload_limits(ASSESSMENT_ROOT_SCOPE)
    usage = WorkloadCumulativeUsage(
        model_calls=150,
        input_tokens=5_000_000,
        output_tokens=300_000,
        total_tokens=5_300_000,
        consecutive_turns_without_progress=25,
    )
    admitted, reason = evaluate_workload_admission(limits, usage)
    assert admitted is True
    assert reason is None


def test_malformed_configuration_fails_closed(monkeypatch):
    monkeypatch.setenv("LCSP_ASSESSMENT_MAX_MODEL_CALLS", "invalid_number")
    with pytest.raises(ValueError, match="Invalid configuration for LCSP_ASSESSMENT_MAX_MODEL_CALLS"):
        resolve_workload_limits(ASSESSMENT_ROOT_SCOPE)

    monkeypatch.setenv("LCSP_ASSESSMENT_MAX_MODEL_CALLS", "-5")
    with pytest.raises(ValueError, match="Invalid configuration for LCSP_ASSESSMENT_MAX_MODEL_CALLS"):
        resolve_workload_limits(ASSESSMENT_ROOT_SCOPE)

    monkeypatch.delenv("LCSP_ASSESSMENT_MAX_MODEL_CALLS", raising=False)
    monkeypatch.setenv("LCSP_RSP_MAX_INPUT_TOKENS", "0")
    with pytest.raises(ValueError, match="Invalid configuration for LCSP_RSP_MAX_INPUT_TOKENS"):
        resolve_workload_limits(RULE_SET_PREPARATION_SCOPE)


def test_explicitly_configured_limits_enforce_boundaries(monkeypatch):
    monkeypatch.setenv("LCSP_ASSESSMENT_MAX_MODEL_CALLS", "50")
    limits = resolve_workload_limits(ASSESSMENT_ROOT_SCOPE)
    assert limits.max_model_calls == 50

    usage = WorkloadCumulativeUsage(model_calls=50)
    admitted, reason = evaluate_workload_admission(limits, usage)
    assert admitted is False
    assert reason == CALL_LIMIT_EXCEEDED


def test_evaluate_workload_admission():
    limits = WorkloadBudgetLimits(
        max_model_calls=10,
        max_input_tokens=1000,
        max_output_tokens=500,
        max_total_tokens=1500,
        no_progress_limit=3,
    )

    usage = WorkloadCumulativeUsage(model_calls=5, input_tokens=500, output_tokens=200, total_tokens=700, consecutive_turns_without_progress=0)
    admitted, reason = evaluate_workload_admission(limits, usage)
    assert admitted is True
    assert reason is None

    # Call limit exceeded
    usage_calls = WorkloadCumulativeUsage(model_calls=10, input_tokens=500, output_tokens=200, total_tokens=700)
    admitted, reason = evaluate_workload_admission(limits, usage_calls)
    assert admitted is False
    assert reason == CALL_LIMIT_EXCEEDED

    # Token limit exceeded (input)
    usage_tokens = WorkloadCumulativeUsage(model_calls=5, input_tokens=1000, output_tokens=200, total_tokens=700)
    admitted, reason = evaluate_workload_admission(limits, usage_tokens)
    assert admitted is False
    assert reason == TOKEN_LIMIT_EXCEEDED

    # No progress limit exceeded
    usage_progress = WorkloadCumulativeUsage(model_calls=5, input_tokens=500, output_tokens=200, total_tokens=700, consecutive_turns_without_progress=3)
    admitted, reason = evaluate_workload_admission(limits, usage_progress)
    assert admitted is False
    assert reason == NO_PROGRESS_LIMIT_EXCEEDED


def test_record_workload_progress():
    usage = WorkloadCumulativeUsage(consecutive_turns_without_progress=2)
    record_workload_progress(usage, made_progress=False)
    assert usage.consecutive_turns_without_progress == 3

    record_workload_progress(usage, made_progress=True)
    assert usage.consecutive_turns_without_progress == 0


def test_root_runtime_control_budget_denial(monkeypatch):
    client = MagicMock()
    client.heartbeat.return_value = {}
    client.root_control.return_value = None
    client.context.return_value = {
        "budgetState": {
            "workloadScope": "ASSESSMENT_ROOT",
            "limits": {
                "maxModelCalls": 5,
                "maxInputTokens": 1000,
                "maxOutputTokens": 500,
                "maxTotalTokens": 1500,
                "noProgressLimit": 3,
            },
            "cumulativeUsage": {
                "modelCalls": 5,
                "inputTokens": 200,
                "outputTokens": 100,
                "totalTokens": 300,
                "consecutiveTurnsWithoutProgress": 0,
            },
        }
    }

    control = RootRuntimeControl(client, "exec-123")
    interrupted_payload = []
    monkeypatch.setattr("assessment_root.runtime_control.interrupt", lambda payload: interrupted_payload.append(payload))

    control.before_model({}, None)
    assert len(interrupted_payload) == 1
    assert interrupted_payload[0] == {
        "reason": CALL_LIMIT_EXCEEDED,
        "targetExecutionId": "exec-123",
        "budgetDenial": True,
        "workloadScope": ASSESSMENT_ROOT_SCOPE,
    }


def test_root_runtime_control_fails_safe_on_network_error(monkeypatch):
    client = MagicMock()
    client.heartbeat.return_value = {}
    client.root_control.return_value = None
    client.context.side_effect = RuntimeError("network unreachable")

    control = RootRuntimeControl(client, "exec-failsafe")
    interrupted_payload = []
    monkeypatch.setattr("assessment_root.runtime_control.interrupt", lambda payload: interrupted_payload.append(payload))

    result = control.before_model({}, None)
    assert result is None
    assert len(interrupted_payload) == 1
    assert interrupted_payload[0] == {
        "reason": "BUDGET_UNAVAILABLE",
        "targetExecutionId": "exec-failsafe",
        "budgetDenial": True,
        "workloadScope": ASSESSMENT_ROOT_SCOPE,
    }


def test_root_runtime_control_fails_safe_on_missing_budget_state(monkeypatch):
    client = MagicMock()
    client.heartbeat.return_value = {}
    client.root_control.return_value = None
    client.context.return_value = {"otherField": "present"}

    control = RootRuntimeControl(client, "exec-failsafe-2")
    interrupted_payload = []
    monkeypatch.setattr("assessment_root.runtime_control.interrupt", lambda payload: interrupted_payload.append(payload))

    result = control.before_model({}, None)
    assert result is None
    assert len(interrupted_payload) == 1
    assert interrupted_payload[0]["reason"] == "BUDGET_UNAVAILABLE"
    assert interrupted_payload[0]["budgetDenial"] is True


def test_root_runtime_control_server_status_no_progress(monkeypatch):
    client = MagicMock()
    client.heartbeat.return_value = {}
    client.root_control.return_value = None
    client.context.return_value = {
        "budgetState": {
            "status": "NO_PROGRESS",
            "limits": {"maxModelCalls": 100},
            "cumulativeUsage": {"modelCalls": 10, "consecutiveTurnsWithoutProgress": 15},
        }
    }

    control = RootRuntimeControl(client, "exec-no-prog")
    interrupted_payload = []
    monkeypatch.setattr("assessment_root.runtime_control.interrupt", lambda payload: interrupted_payload.append(payload))

    result = control.before_model({}, None)
    assert result is None
    assert len(interrupted_payload) == 1
    assert interrupted_payload[0]["reason"] == "NO_PROGRESS_LIMIT_EXCEEDED"
    assert interrupted_payload[0]["budgetDenial"] is True


def test_root_runtime_control_server_status_exhausted(monkeypatch):
    client = MagicMock()
    client.heartbeat.return_value = {}
    client.root_control.return_value = None
    client.context.return_value = {
        "budgetState": {
            "status": "EXHAUSTED",
            "limits": {"maxModelCalls": 100},
            "cumulativeUsage": {"modelCalls": 100},
        }
    }

    control = RootRuntimeControl(client, "exec-exhausted")
    interrupted_payload = []
    monkeypatch.setattr("assessment_root.runtime_control.interrupt", lambda payload: interrupted_payload.append(payload))

    result = control.before_model({}, None)
    assert result is None
    assert len(interrupted_payload) == 1
    assert interrupted_payload[0]["reason"] == "AGENT_BUDGET_REACHED"
    assert interrupted_payload[0]["budgetDenial"] is True


def test_run_assessment_root_pauses_on_budget_exhaustion(tmp_path):
    from pathlib import Path
    from langgraph.checkpoint.memory import InMemorySaver
    from deepagents.backends import FilesystemBackend
    from assessment_root.runner import run_assessment_root
    from test_assessment_root_agent import ASSESSMENT, THREAD, EXECUTION, FakeClient, RootScriptedModel, complete_root_messages

    finish_calls = []

    class BudgetExhaustedClient(FakeClient):
        def context(self):
            base = super().context()
            base["budgetState"] = {
                "workloadScope": "ASSESSMENT_ROOT",
                "limits": {
                    "maxModelCalls": 5,
                    "maxInputTokens": 1000,
                    "maxOutputTokens": 500,
                    "maxTotalTokens": 1500,
                    "noProgressLimit": 3,
                },
                "cumulativeUsage": {
                    "modelCalls": 5,
                    "inputTokens": 200,
                    "outputTokens": 100,
                    "totalTokens": 300,
                    "consecutiveTurnsWithoutProgress": 0,
                },
            }
            return base

        def finish(self, state, **metadata):
            finish_calls.append((state, metadata))
            return super().finish(state, **metadata)

    client = BudgetExhaustedClient()
    saver = InMemorySaver()
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    result = run_assessment_root(
        client,
        ASSESSMENT,
        backend_factory=lambda claim, context: (backend, None),
        model=RootScriptedModel(responses=complete_root_messages()),
        checkpointer=saver,
        governance=(),
    )
    assert result["state"] == "PAUSED"
    assert len(finish_calls) == 1
    state, metadata = finish_calls[0]
    assert state == "PAUSED"
    assert metadata.get("reason") == CALL_LIMIT_EXCEEDED
    assert metadata.get("checkpoint_id") is not None


def test_rule_set_preparation_pauses_on_call_limit_exhaustion(tmp_path, monkeypatch):
    from middleware import usage_metering
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda model, response=None: None)
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "1")
    monkeypatch.delenv("LCSP_RSP_MAX_INPUT_TOKENS", raising=False)
    from rule_set_preparation.runner import run_rule_set_preparation
    from test_rule_set_preparation_agent import FakeApi, _packet, _call, _model, RUN_ID, INDEX_PATH
    from langchain_core.messages import AIMessage

    class BudgetAwareFakeApi(FakeApi):
        def source_review_operation(self, *args, **kwargs):
            return {"outcome": "PASSED", "frontierRevision": 1, "frontierFingerprint": "a" * 64,
                "frontierStateFingerprint": "b" * 64, "progress": {}, "records": [], "nextOffset": None}

        def fail_rule_set_preparation(self, run_id: str, reason: str) -> dict:
            self.calls.append(("fail", (run_id, reason)))
            is_budget = reason in {"AGENT_BUDGET_REACHED", "CALL_LIMIT_EXCEEDED", "TOKEN_LIMIT_EXCEEDED", "NO_PROGRESS_LIMIT_EXCEEDED", "BUDGET_EXHAUSTED"}
            return {"preparationRunId": run_id, "executionState": "PAUSED" if is_budget else "FAILED"}

    packet = _packet()
    model = _model([
        _call("read_file", {"file_path": INDEX_PATH}, "read-index"),
        _call("validate_compliance_rule_set", {"packet": packet}, "validate-1"),
        AIMessage(content="DONE"),
    ])
    api = BudgetAwareFakeApi()
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "PAUSED"
    fail_calls = [c for c in api.calls if c[0] == "fail"]
    assert len(fail_calls) == 1
    assert fail_calls[0][1][1] == CALL_LIMIT_EXCEEDED


def test_rule_set_preparation_pauses_on_token_limit_exhaustion(tmp_path, monkeypatch):
    monkeypatch.delenv("LCSP_RSP_MAX_MODEL_CALLS", raising=False)
    monkeypatch.setenv("LCSP_RSP_MAX_INPUT_TOKENS", "10")
    from rule_set_preparation.runner import run_rule_set_preparation
    from test_rule_set_preparation_agent import FakeApi, _packet, _call, _model, RUN_ID, INDEX_PATH
    from langchain_core.messages import AIMessage

    class BudgetAwareFakeApi(FakeApi):
        def source_review_operation(self, *args, **kwargs):
            return {"outcome": "PASSED", "frontierRevision": 1, "frontierFingerprint": "a" * 64,
                "frontierStateFingerprint": "b" * 64, "progress": {}, "records": [], "nextOffset": None}

        def fail_rule_set_preparation(self, run_id: str, reason: str) -> dict:
            self.calls.append(("fail", (run_id, reason)))
            is_budget = reason in {"AGENT_BUDGET_REACHED", "CALL_LIMIT_EXCEEDED", "TOKEN_LIMIT_EXCEEDED", "NO_PROGRESS_LIMIT_EXCEEDED", "BUDGET_EXHAUSTED"}
            return {"preparationRunId": run_id, "executionState": "PAUSED" if is_budget else "FAILED"}

    packet = _packet()
    model = _model([
        _call("read_file", {"file_path": INDEX_PATH}, "read-index"),
        AIMessage(content="DONE"),
    ])
    api = BudgetAwareFakeApi()
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "PAUSED"
    fail_calls = [c for c in api.calls if c[0] == "fail"]
    assert len(fail_calls) == 1
    assert fail_calls[0][1][1] == TOKEN_LIMIT_EXCEEDED


def test_rule_set_preparation_quota_durability_and_defaults(monkeypatch):
    monkeypatch.delenv("LCSP_RSP_MAX_MODEL_CALLS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_INPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_TOTAL_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_NO_PROGRESS_LIMIT", raising=False)

    from middleware.agent_run_budget import AgentRunBudgetMiddleware
    limits = resolve_workload_limits(RULE_SET_PREPARATION_SCOPE)
    assert limits.max_model_calls is None
    assert limits.max_input_tokens is None
    assert limits.max_output_tokens is None
    assert limits.max_total_tokens is None
    assert limits.no_progress_limit is None

    # Test configured overrides
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "25")
    monkeypatch.setenv("LCSP_RSP_MAX_INPUT_TOKENS", "500000")
    configured_limits = resolve_workload_limits(RULE_SET_PREPARATION_SCOPE)
    assert configured_limits.max_model_calls == 25
    assert configured_limits.max_input_tokens == 500_000

    # Test durable usage updates and preservation across instances
    durable_usage = WorkloadCumulativeUsage(model_calls=5, input_tokens=1000, total_tokens=1000)
    middleware = AgentRunBudgetMiddleware(
        run_quotas={"model_calls": limits.max_model_calls, "input_tokens": limits.max_input_tokens},
        durable_usage=durable_usage,
        workload_limits=limits,
    )
    assert middleware.quota_calls == 5
    assert middleware.quota_input_tokens == 1000

    mock_request = MagicMock()
    mock_request.model = None
    mock_request.messages = []
    middleware._bounded_request(mock_request)
    assert durable_usage.model_calls == 6
    assert durable_usage.input_tokens >= 1000

    # Child middleware sharing the same durable usage inherits updated counters
    child_middleware = AgentRunBudgetMiddleware(
        run_quotas={"model_calls": limits.max_model_calls, "input_tokens": limits.max_input_tokens},
        durable_usage=durable_usage,
        workload_limits=limits,
    )
    assert child_middleware.quota_calls == 6
    child_middleware._bounded_request(mock_request)
    assert durable_usage.model_calls == 7



