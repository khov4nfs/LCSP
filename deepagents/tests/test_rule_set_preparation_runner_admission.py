"""Tests for full-source runner.py admission binding and execution context invariants (G-06, ADR-028)."""
import json
import pytest
from pathlib import Path
from pydantic import Field
from typing import Any

from conftest import use_model_routes
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from middleware.failure_policy import PaidAdmissionError
from middleware.paid_admission import (
    RunAdmission,
    isolated_test_scripted_models,
    register_test_scripted_model,
)
from middleware.usage_metering import active_agent_run_state
from middleware.durable_budget_kernel import WorkloadBudgetLimits
from middleware import durable_budget_kernel
import rule_set_preparation.agent as preparation_agent
from rule_set_preparation.review_frontier import ReviewFrontier
from rule_set_preparation.runner import run_rule_set_preparation
from test_rule_set_preparation_agent import FakeApi, RUN_ID, _call, _packet, INDEX_PATH
from tools.common.capabilities.platform.api_client import WorkerCallbackError


class GovernedRunnerApi(FakeApi):
    """API test double implementing the modern admission API without legacy post_settled_usage."""
    def __init__(self, *, admission_error: Exception | None = None, timeline: list[str] | None = None) -> None:
        super().__init__()
        self.admissions: list[dict] = []
        self.consumes: list[dict] = []
        self.admission_error = admission_error
        self.timeline = timeline if timeline is not None else []
        # Assert invariant: This test double must NOT provide legacy post_settled_usage
        assert not hasattr(self, "post_settled_usage")

    def source_review_operation(self, *args, **kwargs) -> dict:
        return {
            "outcome": "PASSED",
            "frontierRevision": 1,
            "frontierFingerprint": "a" * 64,
            "frontierStateFingerprint": "b" * 64,
            "progress": {},
            "records": [],
            "nextOffset": None,
        }

    def request_invocation_admission(self, payload: dict) -> dict:
        idx = len(self.admissions)
        self.timeline.append(f"ADMIT:{idx}")
        self.admissions.append(payload)
        if self.admission_error:
            raise self.admission_error
        return {
            "admissionId": f"adm-runner-{idx}",
            "invocationId": f"inv-runner-{idx}",
            "capabilityToken": f"cap-runner-{idx}",
            "state": "ADMITTED",
        }

    def consume_invocation_admission(self, payload: dict) -> dict:
        idx = len(self.consumes)
        self.timeline.append(f"CONSUME:{idx}")
        self.consumes.append(payload)
        return {"consumed": True}


class GovernedRunnerModel(BaseChatModel):
    """Governed test model implementing BaseChatModel with valid provider route identity and bounds."""
    calls: list = Field(default_factory=list)
    timeline: list = Field(default_factory=list)
    observed_states: list = Field(default_factory=list)
    provider: str = "anthropic"
    protocol: str = "anthropic"
    model_name: str = "claude-sonnet-4-6"
    profile: dict[str, int] = {"max_output_tokens": 4096, "context_window_tokens": 1000000}

    @property
    def _llm_type(self) -> str:
        return "governed-runner-fixture"

    def bind_tools(self, tools: Any, **kwargs: Any) -> "GovernedRunnerModel":
        return self

    def _generate(self, messages: list[Any], stop: Any = None, run_manager: Any = None, **kwargs: Any) -> ChatResult:
        # Observe execution context state directly during model generation
        state = active_agent_run_state()
        self.observed_states.append({
            "bounded": getattr(state, "bounded", None),
            "admission": getattr(state, "admission", None),
            "is_run_admission": isinstance(getattr(state, "admission", None), RunAdmission),
        })
        idx = len(self.calls)
        self.timeline.append(f"MODEL:{idx}")
        self.calls.append(messages)
        packet = _packet()
        responses = [
            _call("validate_compliance_rule_set", {"packet": packet}, "validate"),
            _call("submit_compliance_rule_set", {"packet": packet}, "submit"),
            AIMessage(content="RULE_SET_SUBMITTED"),
        ]
        msg = responses[idx] if idx < len(responses) else AIMessage(content="DONE")
        return ChatResult(generations=[ChatGeneration(message=msg)])


def setup_governed_runner(monkeypatch):
    """Configure governed routes and legacy tool adapter for runner tests."""
    config = {
        "routes": {
            "primary": {"provider": "anthropic", "protocol": "anthropic", "model": "claude-sonnet-4-6", "options": {"max_output_tokens": 4096, "context_window_tokens": 1000000}},
        },
        "roles": {
            "default": "primary",
            "rule-set-preparation": "primary",
            "claim-author": "primary",
        },
    }
    use_model_routes(monkeypatch, config)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fixture-anthropic-key")

    original_tools = preparation_agent.build_rule_set_tools
    def legacy_tools(context):
        graph = context.source_graph
        context.inventory = None
        context.source_graph = None
        try:
            return original_tools(context)
        finally:
            context.source_graph = graph
    monkeypatch.setattr(preparation_agent, "build_rule_set_tools", legacy_tools)
    monkeypatch.setattr(ReviewFrontier, "restore", lambda self, **kw: None)


def test_runner_activates_run_context_and_uses_admission_api_without_hard_ceiling(monkeypatch, tmp_path):
    """RED->GREEN Test 1: Full-source runner must activate AgentRunState and use api_client for admission even without hard ceiling."""
    setup_governed_runner(monkeypatch)

    # Force has_hard_ceiling = False by ensuring no workload limits exist
    monkeypatch.delenv("LCSP_RSP_MAX_MODEL_CALLS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_INPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_TOTAL_TOKENS", raising=False)
    monkeypatch.setattr("rule_set_preparation.runner.resolve_workload_limits", lambda scope: WorkloadBudgetLimits(
        max_model_calls=None,
        max_input_tokens=None,
        max_output_tokens=None,
        max_total_tokens=None,
        no_progress_limit=None,
    ))

    timeline: list[str] = []
    api = GovernedRunnerApi(timeline=timeline)
    model = GovernedRunnerModel()
    model.timeline = timeline

    # Invariant: Must NOT wrap in activate_agent_run_state() beforehand.
    # The runner itself MUST establish and activate AgentRunState.
    assert active_agent_run_state() is None

    result = run_rule_set_preparation(api, RUN_ID, work_dir=tmp_path, model=model)

    # Invariants:
    assert result["state"] == "SUCCEEDED"
    assert len(api.admissions) >= 1, "Must request server admission via api.request_invocation_admission"
    assert api.admissions[0]["preparationRunId"] == RUN_ID
    assert api.admissions[0]["agentRole"] == "rule-set-preparation"
    assert len(api.consumes) >= 1, "Must commit capability token via api.consume_invocation_admission"
    assert len(model.calls) >= 1, "Model must execute only after admission and consume"
    # Concurrency and admission sequence: every model call had an admission and a consume
    assert len(api.admissions) == len(model.calls)
    assert len(api.consumes) == len(model.calls)

    # Interleaved turn sequence assertion:
    # Verifies the exact chronological alternation: ADMIT -> CONSUME -> MODEL for each turn across the full run
    expected_timeline = [
        "ADMIT:0", "CONSUME:0", "MODEL:0",
        "ADMIT:1", "CONSUME:1", "MODEL:1",
    ]
    assert timeline == expected_timeline, f"Chronological execution timeline mismatch. Expected {expected_timeline}, got {timeline}"


def test_runner_fails_closed_zero_provider_calls_when_admission_denied(monkeypatch, tmp_path):
    """RED->GREEN Test 2: Full-source runner must fail closed with zero provider calls when admission is denied."""
    setup_governed_runner(monkeypatch)

    api = GovernedRunnerApi(
        admission_error=WorkerCallbackError("concurrency limit exceeded", status_code=409)
    )
    model = GovernedRunnerModel()

    assert active_agent_run_state() is None

    result = run_rule_set_preparation(api, RUN_ID, work_dir=tmp_path, model=model)

    # Invariants:
    assert result["state"] == "FAILED"
    assert len(model.calls) == 0, "Zero provider model calls when server admission fails"
    assert len(api.admissions) == 1, "Must have attempted admission exactly once before provider"
    assert len(api.consumes) == 0, "Zero CAS consume calls when admission is rejected"


@pytest.mark.parametrize("denial_reason", ["UNBOUND_ACCOUNT", "UNOBSERVABLE_TRANSPORT", "SDK_RETRIES_UNBOUNDED"])
def test_runner_fails_closed_when_paid_admission_security_denials_raised(monkeypatch, tmp_path, denial_reason):
    """RED->GREEN Test: PaidAdmissionError with security reasons must fail closed as terminal failure, never PAUSED."""
    setup_governed_runner(monkeypatch)

    api = GovernedRunnerApi()

    class DenialProbeModel(BaseChatModel):
        calls: list = Field(default_factory=list)
        provider: str = "anthropic"
        protocol: str = "anthropic"
        model_name: str = "claude-sonnet-4-6"
        profile: dict[str, int] = {"max_output_tokens": 4096, "context_window_tokens": 1000000}

        @property
        def _llm_type(self) -> str:
            return "denial-probe"

        def bind_tools(self, tools: Any, **kwargs: Any) -> "DenialProbeModel":
            return self

        def _generate(self, messages: list[Any], stop: Any = None, run_manager: Any = None, **kwargs: Any) -> ChatResult:
            self.calls.append(messages)
            raise PaidAdmissionError(denial_reason, RUN_ID)

    model = DenialProbeModel()

    # Invariants: Must fail closed by re-raising PaidAdmissionError, never converting to PAUSED or calling fail_rule_set_preparation
    with pytest.raises(PaidAdmissionError) as exc_info:
        run_rule_set_preparation(api, RUN_ID, work_dir=tmp_path, model=model)

    assert exc_info.value.reason == denial_reason
    # api.fail_rule_set_preparation must NOT have been called with the denial reason as a budget pause reason
    assert not any(call[0] == "fail" and call[1][1] == denial_reason for call in api.calls), \
        f"{denial_reason} must not be passed to fail_rule_set_preparation as a budget pause reason"


def test_runner_preserves_hard_ceiling_budget_kernel_when_limits_present(monkeypatch, tmp_path):
    """Invariants: When has_hard_ceiling is True, AgentRunState retains bounded=True and RunAdmission."""
    setup_governed_runner(monkeypatch)

    db_path = tmp_path / "recovery.sqlite3"
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(db_path))

    # Enable hard ceiling with explicit limits covering the test model's bounds
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "10")
    monkeypatch.setenv("LCSP_RSP_MAX_INPUT_TOKENS", "2000000")
    monkeypatch.setenv("LCSP_RSP_MAX_OUTPUT_TOKENS", "50000")
    monkeypatch.setenv("LCSP_RSP_MAX_TOTAL_TOKENS", "3000000")
    monkeypatch.setattr("rule_set_preparation.runner.resolve_workload_limits", lambda scope: WorkloadBudgetLimits(
        max_model_calls=10,
        max_input_tokens=2000000,
        max_output_tokens=50000,
        max_total_tokens=3000000,
        no_progress_limit=5,
    ))

    api = GovernedRunnerApi()
    model = GovernedRunnerModel()

    with isolated_test_scripted_models():
        register_test_scripted_model(model, "primary", credential_salt="0" * 64)
        result = run_rule_set_preparation(api, RUN_ID, work_dir=tmp_path, model=model)

    assert result["state"] == "SUCCEEDED"
    assert len(api.admissions) >= 1
    assert len(api.consumes) >= 1
    assert len(model.calls) >= 1

    # Direct observation of bounded=True and RunAdmission during model execution:
    assert len(model.observed_states) >= 1, "Must have recorded context state during model invocation"
    for turn_idx, obs in enumerate(model.observed_states):
        assert obs["bounded"] is True, f"Turn {turn_idx}: AgentRunState.bounded must be True under hard ceiling"
        assert obs["is_run_admission"] is True, f"Turn {turn_idx}: AgentRunState.admission must be an instance of RunAdmission under hard ceiling"
        assert obs["admission"] is not None, f"Turn {turn_idx}: admission object must be populated"
