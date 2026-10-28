"""Provider-free token governance: no account tariff or reference-price dependency."""
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import pytest
from middleware.paid_admission import TokenPolicy, TokenRunBudget, RunAdmission, fingerprint, recover_admission
from middleware.failure_policy import PaidAdmissionError
from middleware.usage_metering import UsageMeteringMiddleware, activate_agent_run_state
from middleware.usage_recovery import read_usage_evidence
from vertical.live_preparation import LiveUsage, recover_usage
from test_paid_admission import offline, native, policy_for, budget_for, req, answer


def token_state(tmp_path, *, maximum_calls=2):
    model = native()
    original = budget_for(model)
    policy = TokenPolicy.model_validate({k: v for k, v in policy_for(model).model_dump().items() if k in TokenPolicy.model_fields})
    values = {k: v for k, v in original.model_dump().items() if k in TokenRunBudget.model_fields}
    values.update(schema_version=3, policies=(policy,), maximum_calls=maximum_calls)
    budget = TokenRunBudget.model_validate(values)
    return model, LiveUsage(budget.run_id, str(tmp_path / "usage.json"), budget=budget, budget_fingerprint=fingerprint(budget.model_dump(mode="json")))


def test_token_only_budget_no_private_tariff_and_no_financial_claim(tmp_path):
    model, state = token_state(tmp_path)
    meter = UsageMeteringMiddleware()
    with activate_agent_run_state(state):
        meter.wrap_model_call(req(model), lambda _: answer())
    report = recover_usage(str(tmp_path / "usage.json"), state.run_id)
    assert report["physicalAttempts"] == 1 and report["successfulResponses"] == 1
    assert report["admission"]["financialEnforcement"] == "DISABLED"
    assert report["admission"]["actualChargeNanoUSD"] is None
    assert report["admission"]["inputExposure"] == 13
    assert report["admission"]["unresolvedAttempts"] == 0


def test_shared_parent_author_and_unknown_attempt_are_terminal_at_limit(tmp_path):
    model, state = token_state(tmp_path)
    meter = UsageMeteringMiddleware()
    dispatched = []
    with activate_agent_run_state(state):
        meter.wrap_model_call(req(model), lambda _: (dispatched.append("producer"), answer())[1])
        with pytest.raises(TimeoutError):
            meter.wrap_model_call(req(model), lambda _: (dispatched.append("author"), (_ for _ in ()).throw(TimeoutError()))[1])
        with pytest.raises(PaidAdmissionError, match="CALL_LIMIT"):
            meter.wrap_model_call(req(model), lambda _: dispatched.append("forbidden"))
    report = recover_usage(str(tmp_path / "usage.json"), state.run_id)
    assert dispatched == ["producer", "author"]
    assert report["physicalAttempts"] == 2 and report["unresolvedAttempts"] == 1
    assert report["admission"]["unresolvedAttempts"] == 1
    assert report["admission"]["inputExposure"] == 13 + policy_for(model).input_upper_bound


def test_parallel_token_mode_cannot_overadmit_and_recovers_after_reopen(tmp_path):
    model, state = token_state(tmp_path, maximum_calls=1)
    from middleware.paid_admission import request_identity
    identity = request_identity(model, state.admission.budget.credential_salt)
    def attempt(i):
        try: state.admission.admit(str(i), identity); return True
        except PaidAdmissionError: return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(attempt, range(4))) == 1
    restored = RunAdmission(state.store, state.admission.budget, state.admission.identity)
    report = recover_admission(restored.path, restored.run_id)
    assert report["admittedAttempts"] == 1 and report["unresolvedAttempts"] == 1


def test_partial_usage_and_raw_google_reasoning_preserved(tmp_path):
    from middleware.usage_metering import extract_provider_usage
    model = SimpleNamespace(provider="google_genai", protocol="google_genai", model_name="gemini-3.5-flash-lite")
    result = extract_provider_usage(SimpleNamespace(response_metadata={"usage_metadata": {"promptTokenCount": 100, "candidatesTokenCount": 10, "thoughtsTokenCount": 4, "cachedContentTokenCount": 20}}), model)
    assert result["inputTokens"] == "80" and result["inputTokensIncludingCache"] == "100"
    assert result["outputTokens"] == "14" and result["visibleOutputTokens"] == "10" and result["reasoningTokens"] == "4"


def test_configured_token_only_rehearsal_covers_all_governed_attempts(tmp_path):
    from vertical.bounded_admission_rehearsal import main
    result = main(str(tmp_path / "rehearsal"), token_only=True)
    assert result["physicalOfflineHandlerCalls"] == 7
    assert result["recoveredCompletedResponses"] == 4
    assert result["noDispatchAfterDenial"]
    assert result["admission"]["unresolvedAttempts"] == 3
    assert result["admission"]["actualChargeNanoUSD"] is None


def test_crash_between_attempt_commit_callback_and_live_projection_recovers(tmp_path):
    from middleware.usage_metering import AgentRunState
    from middleware.usage_recovery import record_usage_evidence, drain
    from tools.common.capabilities.platform.callback_schemas import SettledUsagePayload
    path = tmp_path / "recover.json.sqlite3"
    state = LiveUsage("run", str(tmp_path / "recover.json"))
    payload = SettledUsagePayload(assessmentId="owned", runId="run", invocationId="attempt", agentRole="producer", provider="APX", model="fixture", attemptStatus="COMPLETED", inputTokensIncludingCache="7", outputTokens="3", occurredAt="2026-10-22T16:00:00Z")
    record_usage_evidence(path, "attempt:run:attempt:COMPLETED", {"event":"MODEL_ATTEMPT", **payload.model_dump(exclude_none=True)})
    result = recover_usage(str(tmp_path / "recover.json"), "run")
    assert result["modelCalls"] == 1 and result["outputTokens"] == 3
    callbacks = []
    client = SimpleNamespace(post_settled_usage=callbacks.append)
    assert drain(path, client) == 1
    assert drain(path, client) == 0
    assert len(callbacks) == 1 and callbacks[0].invocationId == "attempt"
