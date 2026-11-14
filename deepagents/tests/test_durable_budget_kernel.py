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
    apply_budget_extension,
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


def test_apply_budget_extension() -> None:
    base = WorkloadBudgetLimits(
        max_model_calls=100,
        max_input_tokens=2_000_000,
        max_output_tokens=100_000,
        max_total_tokens=2_100_000,
        no_progress_limit=15,
    )
    ext = {
        "version": 1,
        "additionalModelCalls": 50,
        "additionalInputTokens": 1_000_000,
        "additionalOutputTokens": 50_000,
        "additionalTotalTokens": 1_050_000,
    }
    result = apply_budget_extension(base, ext)
    assert result.max_model_calls == 150
    assert result.max_input_tokens == 3_000_000
    assert result.max_output_tokens == 150_000
    assert result.max_total_tokens == 3_150_000
    assert result.no_progress_limit == 15

    # None extension leaves base unchanged
    assert apply_budget_extension(base, None) == base

    # Unbounded limits remain unbounded
    unbounded = WorkloadBudgetLimits(
        max_model_calls=None,
        max_input_tokens=None,
        max_output_tokens=None,
        max_total_tokens=None,
        no_progress_limit=None,
    )
    assert apply_budget_extension(unbounded, ext).max_model_calls is None


def test_intra_execution_progress_tracking_resets_on_case_revision() -> None:
    client = MagicMock()
    control = RootRuntimeControl(
        client,
        "exec-1",
        run=SimpleNamespace(assessment_id="test-asm"),
    )
    control._effective_context = {
        "assessmentId": "test-asm",
        "caseRevision": 2,
        "budgetState": {
            "limits": {"noProgressLimit": 5},
            "cumulativeUsage": {"consecutiveTurnsWithoutProgress": 0},
            "status": "ADMITTED",
        },
    }

    # 1. Calling repeatedly with same case_revision increments ineffective turns
    for _ in range(4):
        decision = control._evaluate_intra_execution_progress({"case_revision": 2})
        assert decision is None

    # 5th ineffective turn triggers stall interruption
    stall_decision = control._evaluate_intra_execution_progress({"case_revision": 2})
    assert stall_decision is not None
    assert stall_decision.get("reason") == NO_PROGRESS_LIMIT_EXCEEDED

    # 2. When case_revision advances, ineffective counter resets to 0
    progress_decision = control._evaluate_intra_execution_progress({"case_revision": 3})
    assert progress_decision is None
    assert control._consecutive_ineffective_calls == 0
    assert control._last_case_revision == 3


def test_intra_execution_detects_repeated_identical_tool_loop() -> None:
    client = MagicMock()
    control = RootRuntimeControl(
        client,
        "exec-loop-1",
        run=SimpleNamespace(assessment_id="test-asm"),
    )
    control._effective_context = {
        "assessmentId": "test-asm",
        "caseRevision": 1,
        "budgetState": {
            "limits": {"noProgressLimit": None},
            "status": "ADMITTED",
        },
    }

    identical_tool_state = {
        "case_revision": 1,
        "messages": [
            SimpleNamespace(
                tool_calls=[{"name": "read_file", "args": {"path": "/workspace/src/index.ts"}}]
            )
        ],
    }

    # 4 identical calls do not trip the threshold yet
    for _ in range(4):
        decision = control._evaluate_intra_execution_progress(identical_tool_state)
        assert decision is None

    # 5th identical tool invocation triggers runaway loop detection
    stall_decision = control._evaluate_intra_execution_progress(identical_tool_state)
    assert stall_decision is not None
    assert stall_decision["reason"] == NO_PROGRESS_LIMIT_EXCEEDED
    assert stall_decision["detection"] == "identical_tool_loop"


def test_intra_execution_detects_cyclic_tool_loop() -> None:
    client = MagicMock()
    control = RootRuntimeControl(
        client,
        "exec-cyclic-1",
        run=SimpleNamespace(assessment_id="test-asm"),
    )
    control._effective_context = {
        "assessmentId": "test-asm",
        "caseRevision": 1,
        "budgetState": {
            "limits": {"noProgressLimit": None},
            "status": "ADMITTED",
        },
    }

    state_a = {
        "case_revision": 1,
        "messages": [SimpleNamespace(tool_calls=[{"name": "tool_a", "args": {"query": "x"}}])],
    }
    state_b = {
        "case_revision": 1,
        "messages": [SimpleNamespace(tool_calls=[{"name": "tool_b", "args": {"query": "y"}}])],
    }

    # A -> B -> A -> B -> A (5 calls, no trip yet)
    for s in [state_a, state_b, state_a, state_b, state_a]:
        decision = control._evaluate_intra_execution_progress(s)
        assert decision is None

    # 6th call completes 3 cycles of A-B -> cyclic runaway loop detected!
    stall_decision = control._evaluate_intra_execution_progress(state_b)
    assert stall_decision is not None
    assert stall_decision["reason"] == NO_PROGRESS_LIMIT_EXCEEDED
    assert stall_decision["detection"] == "cyclic_tool_loop_period_2"


def test_intra_execution_factual_progress_resets_loop_detector() -> None:
    client = MagicMock()
    control = RootRuntimeControl(
        client,
        "exec-facts-1",
        run=SimpleNamespace(assessment_id="test-asm"),
    )
    control._effective_context = {
        "assessmentId": "test-asm",
        "caseRevision": 1,
        "budgetState": {
            "limits": {"noProgressLimit": 10},
            "status": "ADMITTED",
        },
    }
    control._last_case_revision = 1
    control._last_facts_count = 1

    state_idle = {
        "case_revision": 1,
        "facts": ["fact-1"],
        "messages": [SimpleNamespace(tool_calls=[{"name": "grep", "args": {"pattern": "foo"}}])],
    }

    # 3 identical calls accumulate
    for _ in range(3):
        control._evaluate_intra_execution_progress(state_idle)
    assert len(control._recent_tool_signatures) == 3

    # New fact established -> progress made!
    state_progress = {
        "case_revision": 1,
        "facts": ["fact-1", "fact-2"],
        "messages": [SimpleNamespace(tool_calls=[{"name": "grep", "args": {"pattern": "foo"}}])],
    }
    decision = control._evaluate_intra_execution_progress(state_progress)
    assert decision is None
    assert len(control._recent_tool_signatures) == 0
    assert control._consecutive_ineffective_calls == 0



def test_rule_set_preparation_restores_usage_across_fresh_instances(tmp_path) -> None:
    from rule_set_preparation.tools import RuleSetPreparationContext

    mock_api = MagicMock()
    # Instance 1: runs and records usage
    ctx1 = RuleSetPreparationContext(run_id="run-1", api=mock_api, source_root=tmp_path)
    ctx1.cumulative_usage.model_calls = 5
    ctx1.cumulative_usage.input_tokens = 120_000
    ctx1.cumulative_usage.output_tokens = 6_000
    ctx1.cumulative_usage.total_tokens = 126_000
    ctx1.persist_usage()

    # Verify receipt was written to work/receipts/usage.json
    usage_file = tmp_path / "work" / "receipts" / "usage.json"
    assert usage_file.exists()

    # Instance 2: completely new object for the SAME run (e.g. restart / takeover), restores from disk
    ctx2 = RuleSetPreparationContext(run_id="run-1", api=mock_api, source_root=tmp_path)
    assert ctx2.cumulative_usage.model_calls == 0  # before restore
    ctx2.restore_usage()
    assert ctx2.cumulative_usage.model_calls == 5
    assert ctx2.cumulative_usage.input_tokens == 120_000
    assert ctx2.cumulative_usage.output_tokens == 6_000
    assert ctx2.cumulative_usage.total_tokens == 126_000

    # Instance 3: foreign run_id must reject disk receipt mismatch to prevent cross-run pollution
    ctx_foreign = RuleSetPreparationContext(run_id="run-foreign", api=mock_api, source_root=tmp_path)
    ctx_foreign.restore_usage()
    assert ctx_foreign.cumulative_usage.model_calls == 0
    assert ctx_foreign.cumulative_usage.total_tokens == 0

    # Instance 4: adopts usage from API bundle matching runId
    ctx4 = RuleSetPreparationContext(run_id="run-4", api=mock_api, source_root=tmp_path)
    # Rejects mismatched runId
    ctx4.adopt_usage({
        "runId": "different-run",
        "modelCalls": 10,
        "inputTokens": 250_000,
        "outputTokens": 12_000,
        "totalTokens": 262_000,
    })
    assert ctx4.cumulative_usage.model_calls == 0

    # Accepts matching runId
    ctx4.adopt_usage({
        "runId": "run-4",
        "modelCalls": 10,
        "inputTokens": 250_000,
        "outputTokens": 12_000,
        "totalTokens": 262_000,
    })
    assert ctx4.cumulative_usage.model_calls == 10
    assert ctx4.cumulative_usage.total_tokens == 262_000


def test_rule_set_preparation_output_only_quota_enforces_pause() -> None:
    from middleware.agent_run_budget import AgentRunBudgetMiddleware
    from middleware.failure_policy import AgentRunBudgetExceeded

    # Only output_tokens is configured; model_calls, input_tokens and total_tokens are unconstrained (None)
    durable = WorkloadCumulativeUsage(model_calls=0, input_tokens=0, output_tokens=0, total_tokens=0)
    quotas = {
        "model_calls": None,
        "input_tokens": None,
        "output_tokens": 100,  # Explicit ceiling: 100 output tokens
        "total_tokens": None,
    }
    mw = AgentRunBudgetMiddleware(run_quotas=quotas, durable_usage=durable)

    req = SimpleNamespace(messages=[SimpleNamespace(content="Generate claims")], model="gpt-4")
    # First call admitted: produces 120 output tokens
    mw.wrap_model_call(
        req,
        lambda r: SimpleNamespace(
            result=[SimpleNamespace(content="Result", usage_metadata={"input_tokens": 500, "output_tokens": 120})],
        ),
    )
    assert durable.output_tokens == 120

    # Second call must be rejected immediately with TOKEN_LIMIT_EXCEEDED because 120 >= 100
    with pytest.raises(AgentRunBudgetExceeded) as exc_info:
        mw.wrap_model_call(req, lambda r: SimpleNamespace(result=[]))
    assert exc_info.value.reason == "TOKEN_LIMIT_EXCEEDED"


def test_unknown_usage_larger_than_hard_ceiling_fails_closed(monkeypatch) -> None:
    from rule_set_preparation.tools import RuleSetPreparationContext

    # Configure explicit hard ceiling on total tokens: 5000 tokens
    monkeypatch.setenv("LCSP_RSP_MAX_TOTAL_TOKENS", "5000")

    mock_api = MagicMock()
    ctx = RuleSetPreparationContext(run_id="run-hard-ceiling", api=mock_api)

    # 1 unmeasured model call (totalTokens is 0/unmeasured)
    # Upper-bound reservation is 4096 in + 2048 out = 6144 total tokens
    # Because 6144 > 5000, this exceeds the configured hard ceiling!
    ctx.restore_usage({"modelCalls": 1, "totalTokens": 0})

    assert ctx.cumulative_usage.total_tokens >= 6144

    from middleware.durable_budget_kernel import (
        RULE_SET_PREPARATION_SCOPE,
        evaluate_workload_admission,
        resolve_workload_limits,
    )
    limits = resolve_workload_limits(RULE_SET_PREPARATION_SCOPE)
    admitted, reason = evaluate_workload_admission(limits, ctx.cumulative_usage)
    assert not admitted
    assert reason == "TOKEN_LIMIT_EXCEEDED"


def test_restart_with_in_flight_usage_retains_conservative_reservation(tmp_path) -> None:
    from middleware.agent_run_budget import AgentRunBudgetMiddleware
    from rule_set_preparation.tools import RuleSetPreparationContext

    mock_api = MagicMock()
    # Instance 1: prepares request and begins dispatch
    ctx1 = RuleSetPreparationContext(run_id="run-inflight", api=mock_api, source_root=tmp_path)
    quotas = {"model_calls": 10, "input_tokens": 50_000, "total_tokens": 60_000}
    mw1 = AgentRunBudgetMiddleware(
        run_quotas=quotas,
        durable_usage=ctx1.cumulative_usage,
        persist_callback=ctx1.persist_usage,
    )

    req = SimpleNamespace(
        messages=[SimpleNamespace(content="Long prompt input to verify reservation " * 50)],
        model="gpt-4",
    )
    # Bounded request is evaluated before dispatch: reserves in-flight input and updates disk receipt
    bounded_req = mw1._bounded_request(req)
    assert bounded_req is not None
    assert ctx1.cumulative_usage.model_calls == 1
    assert ctx1.cumulative_usage.input_tokens > 0

    # Simulate crash before provider responds (handler never returned, _settle_quota never ran)
    # Instance 2 resumes from disk receipt
    ctx2 = RuleSetPreparationContext(run_id="run-inflight", api=mock_api, source_root=tmp_path)
    ctx2.restore_usage()

    # The in-flight reservation must NOT be lost or reset to zero
    assert ctx2.cumulative_usage.model_calls == 1
    assert ctx2.cumulative_usage.input_tokens == ctx1.cumulative_usage.input_tokens
    assert ctx2.cumulative_usage.total_tokens == ctx1.cumulative_usage.total_tokens


def test_settle_quota_estimates_conservative_output_when_metadata_missing() -> None:
    from middleware.agent_run_budget import AgentRunBudgetMiddleware

    durable = WorkloadCumulativeUsage(model_calls=1, input_tokens=1000, output_tokens=0, total_tokens=1000)
    quotas = {"model_calls": 10, "input_tokens": 100_000, "total_tokens": 150_000}
    mw = AgentRunBudgetMiddleware(run_quotas=quotas, durable_usage=durable)

    req = SimpleNamespace(messages=[SimpleNamespace(content="Analyze legal sources")], model="gpt-4")
    # Response with NO usage_metadata
    resp_no_metadata = SimpleNamespace(
        result=[SimpleNamespace(content="Here is a detailed legal analysis with fifty characters!")],
    )

    mw._settle_quota(req, resp_no_metadata)
    # Output tokens must NOT be zero
    assert mw.quota_output_tokens > 0
    assert durable.output_tokens > 0
    assert durable.total_tokens == durable.input_tokens + durable.output_tokens


def test_rule_set_preparation_restores_usage_with_unmeasured_tokens_fallback() -> None:
    from rule_set_preparation.tools import RuleSetPreparationContext

    mock_api = MagicMock()
    ctx = RuleSetPreparationContext(run_id="run-unmeasured", api=mock_api)
    # Bundle reports 3 model calls but 0 total tokens (unmeasured provider)
    ctx.restore_usage({"modelCalls": 3, "totalTokens": 0})

    assert ctx.cumulative_usage.model_calls == 3
    # Must NOT be zero; conservative estimation applied
    assert ctx.cumulative_usage.input_tokens >= 3 * 500
    assert ctx.cumulative_usage.output_tokens >= 3 * 100
    assert ctx.cumulative_usage.total_tokens >= 3 * 600


def test_middleware_preserves_cumulative_counters_across_restarts() -> None:
    from middleware.agent_run_budget import AgentRunBudgetMiddleware

    # Worker 1 runs and exhausts part of the budget
    durable1 = WorkloadCumulativeUsage()
    quotas = {"model_calls": 5, "total_tokens": 10_000}
    mw1 = AgentRunBudgetMiddleware(run_quotas=quotas, durable_usage=durable1)

    req1 = SimpleNamespace(messages=[SimpleNamespace(content="Step 1")], model="gpt-4")
    mw1.wrap_model_call(
        req1,
        lambda r: SimpleNamespace(
            result=[SimpleNamespace(content="Done step 1", usage_metadata={"input_tokens": 2000, "output_tokens": 500})],
        ),
    )
    assert durable1.model_calls == 1
    assert durable1.total_tokens == 2500

    # Worker 2: Fresh instance simulating worker crash / resume with restored durable_usage
    durable2 = WorkloadCumulativeUsage(
        model_calls=durable1.model_calls,
        input_tokens=durable1.input_tokens,
        output_tokens=durable1.output_tokens,
        total_tokens=durable1.total_tokens,
    )
    mw2 = AgentRunBudgetMiddleware(run_quotas=quotas, durable_usage=durable2)

    assert mw2.quota_calls == 1
    assert mw2.quota_total_tokens == 2500

    # Execute step 2 on new instance
    req2 = SimpleNamespace(messages=[SimpleNamespace(content="Step 2")], model="gpt-4")
    mw2.wrap_model_call(
        req2,
        lambda r: SimpleNamespace(
            result=[SimpleNamespace(content="Done step 2", usage_metadata={"input_tokens": 3000, "output_tokens": 800})],
        ),
    )

    # Cumulative total must reflect both steps
    assert durable2.model_calls == 2
    assert durable2.input_tokens == 5000
    assert durable2.output_tokens == 1300
    assert durable2.total_tokens == 6300





