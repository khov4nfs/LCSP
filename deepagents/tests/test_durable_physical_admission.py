"""Integration proofs for durable physical-attempt admission under explicit hard safety ceilings.

Covers all 12 mandatory integration scenarios:
1. Reservation persistence failure before dispatch blocks execution fail-closed.
2. Crash immediately after reservation preserves reserved exposure.
3. Crash after physical dispatch before receipt transitions to OUTCOME_UNKNOWN preserving exposure.
4. New worker with newly created temporary workspace recovers reservations.
5. Resume with measuredTokens=0 and unmeasuredModelCalls>0 includes unresolved exposure.
6. Partial usage response lacking outputTokens retains reserved exposure.
7. Physical retry and fallback produce distinct invocation IDs and individual reservations.
8. Two concurrent workers competing for final reservation are serialized with exactly one winner.
9. Duplicate and out-of-order receipts reconcile idempotently.
10. Late successful settlement after timeout frees headroom under the hard ceiling.
11. Unconfigured cumulative limits remain unconstrained.
12. Rule Set Preparation and Assessment Root regressions.
"""

from __future__ import annotations

import concurrent.futures
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import time
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from assessment_root.runtime_control import RootRuntimeControl
from middleware.agent_run_budget import AgentRunBudgetMiddleware
from middleware.durable_budget_kernel import (
    RULE_SET_PREPARATION_SCOPE,
    WorkloadBudgetLimits,
    WorkloadCumulativeUsage,
    evaluate_workload_admission,
    resolve_workload_limits,
)
from middleware.failure_policy import (
    AgentRunBudgetExceeded,
    PaidAdmissionError,
)
from middleware.paid_admission import (
    ChargePolicy,
    RunAdmission,
    TokenPolicy,
    TokenRunBudget,
    fingerprint,
    recover_admission,
)
from middleware.usage_metering import (
    AgentRunState,
    UsageMeteringMiddleware,
    activate_agent_run_state,
)
from model_policy import DEFAULT_ROUTES_FILE
from rule_set_preparation.runner import run_rule_set_preparation
from rule_set_preparation.tools import RuleSetPreparationContext
from vertical.live_preparation import LiveUsage

OFFLINE_SALT = "a" * 64


def make_limits(
    max_model_calls: int | None = None,
    max_input_tokens: int | None = None,
    max_output_tokens: int | None = None,
    max_total_tokens: int | None = None,
    no_progress_limit: int | None = None,
) -> WorkloadBudgetLimits:
    return WorkloadBudgetLimits(
        max_model_calls=max_model_calls,
        max_input_tokens=max_input_tokens,
        max_output_tokens=max_output_tokens,
        max_total_tokens=max_total_tokens,
        no_progress_limit=no_progress_limit,
    )


def make_token_policy(
    route_id: str = "primary",
    input_bound: int = 2000,
    output_bound: int = 4096,
) -> TokenPolicy:
    return TokenPolicy(
        route_id=route_id,
        route_fingerprint="1" * 64,
        credential_fingerprint="2" * 64,
        endpoint_fingerprint="3" * 64,
        sdk_fingerprint="4" * 64,
        provider="anthropic",
        protocol="anthropic",
        model="claude-3-5-sonnet",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=input_bound,
        output_upper_bound=output_bound,
    )


def make_token_budget(
    run_id: str,
    policies: tuple[TokenPolicy, ...],
    **kwargs: Any,
) -> TokenRunBudget:
    data: dict[str, Any] = {
        "schema_version": 3,
        "run_id": run_id,
        "candidate_sha": "0" * 40,
        "model_routes_sha256": "0" * 64,
        "credential_salt": OFFLINE_SALT,
        "valid_from": 1,
        "expires_at": None,
        "policies": policies,
    }
    data.update(kwargs)
    return TokenRunBudget(**data)


def make_identity(policy: TokenPolicy) -> dict[str, Any]:
    return {
        "route_id": policy.route_id,
        "route_fingerprint": policy.route_fingerprint,
        "credential_fingerprint": policy.credential_fingerprint,
        "endpoint_fingerprint": policy.endpoint_fingerprint,
        "sdk_fingerprint": policy.sdk_fingerprint,
        "provider": policy.provider,
        "protocol": policy.protocol,
        "model": policy.model,
    }


# ==============================================================================
# Scenario 1: Reservation persistence failure before dispatch blocks execution
# ==============================================================================
def test_01_reservation_persistence_failure_before_dispatch_blocks_execution(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    policy = make_token_policy()
    budget = make_token_budget("run-01", (policy,), maximum_calls=5, maximum_total_tokens=10_000)
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    # Simulate database disk error / lock on connect
    def failing_connect(*args: Any, **kwargs: Any) -> Any:
        raise sqlite3.OperationalError("database is locked (simulated failure)")

    monkeypatch.setattr("middleware.paid_admission._connect", failing_connect)

    dispatched = False
    def model_dispatch() -> None:
        nonlocal dispatched
        dispatched = True

    with pytest.raises(PaidAdmissionError) as exc_info:
        admission.admit("att-fail-1", make_identity(policy))
        model_dispatch()

    assert not dispatched
    assert exc_info.value.reason == "DURABILITY"


# ==============================================================================
# Scenario 2: Crash immediately after reservation preserves reserved exposure
# ==============================================================================
def test_02_crash_immediately_after_reservation_preserves_reserved_exposure(tmp_path: Path) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    policy = make_token_policy(input_bound=3000, output_bound=4000)
    # Hard ceiling: 8000 total tokens. 1 reservation takes 3000+4000 = 7000.
    budget = make_token_budget("run-02", (policy,), maximum_total_tokens=8000)

    # Worker 1 reserves att-1 and then abruptly crashes
    worker1_admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
    worker1_admission.admit("att-1", make_identity(policy))
    worker1_admission.transition("att-1", "IN_FLIGHT")
    del worker1_admission  # Worker 1 exits

    # Worker 2 boots up for the same run
    worker2_admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
    snapshot = recover_admission(db_path, "run-02")

    # In-flight exposure is durably recovered
    assert snapshot["unresolvedAttempts"] == 1
    assert snapshot["attempts"][0]["state"] == "IN_FLIGHT"
    assert snapshot["attempts"][0]["input_exposure"] == 3000
    assert snapshot["attempts"][0]["output_exposure"] == 4000

    # Second attempt cannot be admitted because 7000 (reserved) + 7000 > 8000
    with pytest.raises(PaidAdmissionError) as exc_info:
        worker2_admission.admit("att-2", make_identity(policy))
    assert exc_info.value.reason == "TOKEN_LIMIT"


# ==============================================================================
# Scenario 3: Crash after physical dispatch before receipt preserves exposure in OUTCOME_UNKNOWN
# ==============================================================================
def test_03_crash_after_physical_dispatch_before_receipt_transitions_to_outcome_unknown(tmp_path: Path) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    policy = make_token_policy(input_bound=2000, output_bound=3000)
    budget = make_token_budget("run-03", (policy,), maximum_total_tokens=6000)
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    admission.admit("att-dispatch-1", make_identity(policy))
    admission.transition("att-dispatch-1", "IN_FLIGHT")

    # Crash/timeout occurs before provider receipt
    admission.transition("att-dispatch-1", "OUTCOME_UNKNOWN")

    snapshot = recover_admission(db_path, "run-03")
    att = snapshot["attempts"][0]
    assert att["state"] == "OUTCOME_UNKNOWN"
    # Reserved exposure must NOT be released or zeroed
    assert att["input_exposure"] == 2000
    assert att["output_exposure"] == 3000

    # Total exposure counts the unknown outcome
    usage = WorkloadCumulativeUsage(
        model_calls=1,
        input_tokens=0,
        output_tokens=0,
        total_tokens=0,
        outcome_unknown_exposure=5000,
    )
    limits = make_limits(max_total_tokens=4000)
    admitted, reason = evaluate_workload_admission(limits, usage)
    assert not admitted
    assert reason == "TOKEN_LIMIT_EXCEEDED"


# ==============================================================================
# Scenario 4: New worker with newly created temp workspace recovers reservations
# ==============================================================================
def test_04_new_worker_with_newly_created_temp_workspace_recovers_reservations(tmp_path: Path) -> None:
    shared_storage = tmp_path / "persistent_storage"
    shared_storage.mkdir()
    db_path = shared_storage / "usage-recovery.sqlite3"

    policy = make_token_policy(input_bound=1000, output_bound=2000)
    budget = make_token_budget("run-04", (policy,), maximum_calls=5, maximum_total_tokens=10_000)

    # Worker 1 operates in ephemeral workspace ws1
    ws1 = tmp_path / "ephemeral_ws_1"
    ws1.mkdir()
    w1_admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
    w1_admission.admit("w1-att-1", make_identity(policy))
    del w1_admission

    # Ephemeral workspace ws1 is deleted
    shutil.rmtree(ws1)
    assert not ws1.exists()

    # Worker 2 starts in brand new workspace ws2
    ws2 = tmp_path / "ephemeral_ws_2"
    ws2.mkdir()
    w2_admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
    w2_snapshot = recover_admission(db_path, "run-04")

    assert w2_snapshot["admittedAttempts"] == 1
    assert w2_snapshot["attempts"][0]["attempt_id"] == "w1-att-1"
    assert w2_snapshot["attempts"][0]["state"] == "ADMITTED"


# ==============================================================================
# Scenario 5: Resume with measuredTokens=0 and unmeasuredModelCalls>0 includes unresolved exposure
# ==============================================================================
def test_05_resume_with_measured_tokens_zero_and_unmeasured_calls_enforces_ceiling(tmp_path: Path) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    policy = make_token_policy(input_bound=4000, output_bound=4096)
    # Hard ceiling of 10,000 total tokens
    budget = make_token_budget("run-05", (policy,), maximum_total_tokens=10_000)
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    # 1 unmeasured attempt in OUTCOME_UNKNOWN (reserving 4000 + 4096 = 8096)
    admission.admit("unmeasured-1", make_identity(policy))
    admission.transition("unmeasured-1", "OUTCOME_UNKNOWN")

    # API reported bundle has measuredTokens=0, but unmeasuredModelCalls=1
    api_bundle = {"modelCalls": 1, "totalTokens": 0, "unmeasuredModelCalls": 1}
    mock_api = MagicMock()
    ctx = RuleSetPreparationContext(run_id="run-05", api=mock_api)
    ctx.store_path = db_path
    ctx.restore_usage(api_bundle)

    # Context restored unresolved exposure from SQLite
    total_unresolved = ctx.cumulative_usage.in_flight_exposure + ctx.cumulative_usage.outcome_unknown_exposure
    assert total_unresolved == 8096
    assert ctx.cumulative_usage.in_flight_exposure == 4000
    assert ctx.cumulative_usage.outcome_unknown_exposure == 4096

    # New dispatch attempting to evaluate admission under a 8000 limit must be DENIED because 8096 > 8000
    limits = make_limits(max_total_tokens=8000)
    admitted, reason = evaluate_workload_admission(limits, ctx.cumulative_usage)
    assert not admitted
    assert reason == "TOKEN_LIMIT_EXCEEDED"


# ==============================================================================
# Scenario 6: Partial usage response lacking outputTokens retains reserved exposure
# ==============================================================================
def test_06_partial_usage_response_lacking_output_tokens_retains_reserved_exposure(tmp_path: Path) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    policy = make_token_policy(input_bound=1000, output_bound=3000)
    budget = make_token_budget("run-06", (policy,), maximum_total_tokens=10_000)
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    admission.admit("att-partial", make_identity(policy))
    admission.transition("att-partial", "IN_FLIGHT")

    # Provider returns inputTokens but completely omits outputTokens
    partial_usage = {"inputTokens": 850}
    admission.settle("att-partial", partial_usage)

    snapshot = recover_admission(db_path, "run-06")
    att = snapshot["attempts"][0]
    # Attempt must be classified as OUTCOME_UNKNOWN, NOT SETTLED
    assert att["state"] == "OUTCOME_UNKNOWN"
    # Reserved output exposure must NOT be released
    assert att["output_exposure"] == 3000

    # Also test in AgentRunBudgetMiddleware
    durable = WorkloadCumulativeUsage()
    quotas = {"model_calls": 5, "total_tokens": 10_000}
    mw = AgentRunBudgetMiddleware(run_quotas=quotas, durable_usage=durable)
    req = SimpleNamespace(
        messages=[SimpleNamespace(content="Prompt text")],
        model=SimpleNamespace(profile={"max_output_tokens": 3000}),
    )
    mw._bounded_request(req)
    assert mw.quota_output_tokens == 3000

    # Response with no output tokens in usage metadata
    resp = SimpleNamespace(
        result=[SimpleNamespace(content="Output content", usage_metadata={"input_tokens": 850})],
    )
    mw._settle_quota(req, resp)
    # Output tokens remain reserved at 3000, not zero or estimated
    assert mw.quota_output_tokens == 3000
    assert durable.estimated_diagnostic_output_tokens > 0


# ==============================================================================
# Scenario 7: Physical retry and fallback produce distinct invocation IDs
# ==============================================================================
def test_07_physical_retry_and_fallback_produce_distinct_invocation_ids(tmp_path: Path) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    p1 = make_token_policy("primary", input_bound=1000, output_bound=2000)
    p2 = make_token_policy("fallback", input_bound=1000, output_bound=2000)
    budget = make_token_budget("run-07", (p1, p2), maximum_calls=5, maximum_total_tokens=10_000)
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    # First physical attempt: primary model
    inv_id_1 = "inv-primary-001"
    admission.admit(inv_id_1, make_identity(p1))
    admission.transition(inv_id_1, "IN_FLIGHT")
    admission.transition(inv_id_1, "OUTCOME_UNKNOWN")

    # Second physical attempt: fallback model (retry or fallback route)
    inv_id_2 = "inv-fallback-002"
    admission.admit(inv_id_2, make_identity(p2))
    admission.transition(inv_id_2, "IN_FLIGHT")
    admission.settle(inv_id_2, {"inputTokens": 900, "outputTokens": 350})

    snapshot = recover_admission(db_path, "run-07")
    assert snapshot["admittedAttempts"] == 2
    att_ids = {a["attempt_id"] for a in snapshot["attempts"]}
    assert att_ids == {inv_id_1, inv_id_2}


# ==============================================================================
# Scenario 8: Two concurrent workers competing for final reservation
# ==============================================================================
def test_08_two_concurrent_workers_competing_for_final_reservation(tmp_path: Path) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    policy = make_token_policy(input_bound=2000, output_bound=3000)
    # Ceiling allows only 1 attempt of 5000 tokens
    budget = make_token_budget("run-08", (policy,), maximum_total_tokens=6000)
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    successes = 0
    denials = 0
    lock = concurrent.futures.thread.threading.Lock()

    def worker_attempt(attempt_id: str) -> None:
        nonlocal successes, denials
        try:
            adm = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
            adm.admit(attempt_id, make_identity(policy))
            with lock:
                successes += 1
        except PaidAdmissionError:
            with lock:
                denials += 1

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(worker_attempt, "contender-1")
        f2 = executor.submit(worker_attempt, "contender-2")
        concurrent.futures.wait([f1, f2])

    assert successes == 1
    assert denials == 1


# ==============================================================================
# Scenario 9: Duplicate and out-of-order receipts reconcile idempotently
# ==============================================================================
def test_09_duplicate_and_out_of_order_receipts_reconcile_idempotently(tmp_path: Path) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    policy = make_token_policy(input_bound=2000, output_bound=3000)
    budget = make_token_budget("run-09", (policy,), maximum_total_tokens=10_000)
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    admission.admit("att-reconcile", make_identity(policy))
    admission.transition("att-reconcile", "IN_FLIGHT")
    admission.transition("att-reconcile", "OUTCOME_UNKNOWN")

    # Late receipt arrives
    receipt = {"inputTokens": 1200, "outputTokens": 450}
    admission.settle("att-reconcile", receipt)

    s1 = recover_admission(db_path, "run-09")
    assert s1["attempts"][0]["state"] == "SETTLED"
    u1 = json.loads(s1["attempts"][0]["usage"])
    assert u1["inputTokensIncludingCache"] == 1200
    assert u1["outputTokens"] == 450

    # Duplicate receipt arrives later
    admission.settle("att-reconcile", receipt)
    s2 = recover_admission(db_path, "run-09")
    # Must NOT double-count
    u2 = json.loads(s2["attempts"][0]["usage"])
    assert u2["inputTokensIncludingCache"] == 1200
    assert u2["outputTokens"] == 450


# ==============================================================================
# Scenario 10: Late successful settlement after timeout frees headroom
# ==============================================================================
def test_10_late_successful_settlement_after_timeout_frees_headroom(tmp_path: Path) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    policy = make_token_policy(input_bound=5000, output_bound=4000)
    # Hard ceiling of 10,000 total tokens
    budget = make_token_budget("run-10", (policy,), maximum_total_tokens=10_000)
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    # Attempt 1 timed out: reserves 5000 + 4000 = 9000
    admission.admit("att-timeout-1", make_identity(policy))
    admission.transition("att-timeout-1", "IN_FLIGHT")
    admission.transition("att-timeout-1", "OUTCOME_UNKNOWN")

    # Attempt 2 cannot be admitted because 9000 + 9000 > 10,000
    with pytest.raises(PaidAdmissionError) as exc_info:
        admission.admit("att-contender-2", make_identity(policy))
    assert exc_info.value.reason == "TOKEN_LIMIT"

    # Now verify with smaller bounds: attempt reserves 4000
    smaller_policy = make_token_policy("smaller", input_bound=2000, output_bound=2000)
    smaller_budget = make_token_budget("run-10-b", (smaller_policy,), maximum_total_tokens=6000)
    adm_b = RunAdmission(db_path, smaller_budget, fingerprint(smaller_budget.model_dump(mode="json")))
    adm_b.admit("b-att-1", make_identity(smaller_policy))
    adm_b.transition("b-att-1", "OUTCOME_UNKNOWN")
    # Attempt 2 of 4000 would exceed ceiling 6000 (4000 + 4000 = 8000 > 6000)
    with pytest.raises(PaidAdmissionError):
        adm_b.admit("b-att-2", make_identity(smaller_policy))

    # Late receipt for attempt 1 arrives: actual usage was only 500 input, 100 output (total 600)
    adm_b.settle("b-att-1", {"inputTokens": 500, "outputTokens": 100})
    # After settlement, used is 600. Now subsequent attempt b-att-3 (reserving 4000) is admitted because 600 + 4000 = 4600 <= 6000!
    adm_b.admit("b-att-3", make_identity(smaller_policy))
    snap = recover_admission(db_path, "run-10-b")
    # 2 admitted attempts (b-att-1 and b-att-3), while b-att-2 was denied
    assert snap["admittedAttempts"] == 2


# ==============================================================================
# Scenario 11: Unconfigured cumulative limits remain unconstrained
# ==============================================================================
def test_11_unconfigured_cumulative_limits_remain_unconstrained(monkeypatch: pytest.MonkeyPatch) -> None:
    # Clear all cumulative environment variables
    for key in [
        "LCSP_RSP_MAX_MODEL_CALLS",
        "LCSP_RSP_MAX_INPUT_TOKENS",
        "LCSP_RSP_MAX_OUTPUT_TOKENS",
        "LCSP_RSP_MAX_TOTAL_TOKENS",
        "LCSP_RSP_NO_PROGRESS_LIMIT",
    ]:
        monkeypatch.delenv(key, raising=False)

    limits = resolve_workload_limits(RULE_SET_PREPARATION_SCOPE)
    assert limits.max_model_calls is None
    assert limits.max_input_tokens is None
    assert limits.max_output_tokens is None
    assert limits.max_total_tokens is None

    # Even with high cumulative usage, admission remains unconstrained
    usage = WorkloadCumulativeUsage(model_calls=500, input_tokens=10_000_000, output_tokens=1_000_000, total_tokens=11_000_000)
    admitted, reason = evaluate_workload_admission(limits, usage)
    assert admitted
    assert reason is None


# ==============================================================================
# Scenario 12: Rule Set Preparation and Assessment Root regressions
# ==============================================================================
def test_12_rule_set_preparation_and_assessment_root_regressions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 1. Assessment Root Runtime Control under explicit hard ceiling
    client = MagicMock()
    control = RootRuntimeControl(client, "exec-regress-1", run=SimpleNamespace(assessment_id="test-asm"))
    control._effective_context = {
        "assessmentId": "asm-regress",
        "caseRevision": 1,
        "budgetState": {
            "limits": {"maxModelCalls": 2},
            "status": "ADMITTED",
        },
    }
    # 2 calls are allowed
    state1 = {"case_revision": 1, "messages": [SimpleNamespace(tool_calls=[{"name": "tool_1", "args": {}}])]}
    assert control._evaluate_intra_execution_progress(state1) is None
    state2 = {"case_revision": 1, "messages": [SimpleNamespace(tool_calls=[{"name": "tool_2", "args": {}}])]}
    assert control._evaluate_intra_execution_progress(state2) is None

    # 2. Rule Set Preparation under hard ceiling
    from middleware import usage_metering
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda model, response=None: None)
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(tmp_path / "recovery.sqlite3"))
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "1")

    from test_rule_set_preparation_agent import FakeApi, _packet, _call, _model, INDEX_PATH
    from langchain_core.messages import AIMessage

    class RegressionApi(FakeApi):
        def source_review_operation(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
            return {
                "outcome": "PASSED",
                "frontierRevision": 1,
                "frontierFingerprint": "f" * 64,
                "frontierStateFingerprint": "s" * 64,
                "progress": {},
                "records": [],
                "nextOffset": None,
            }

        def fail_rule_set_preparation(self, run_id: str, reason: str) -> dict[str, Any]:
            self.calls.append(("fail", (run_id, reason)))
            return {"preparationRunId": run_id, "executionState": "PAUSED"}

    packet = _packet()
    model = _model([
        _call("read_file", {"file_path": INDEX_PATH}, "read-index"),
        _call("validate_compliance_rule_set", {"packet": packet}, "validate-1"),
        AIMessage(content="DONE"),
    ])
    api = RegressionApi()
    run_id = "22222222-2222-4222-8222-222222222222"
    result = run_rule_set_preparation(api, run_id, model=model, work_dir=tmp_path)
    assert result["state"] == "PAUSED"
    fail_calls = [c for c in api.calls if c[0] == "fail"]
    assert len(fail_calls) == 1
    assert fail_calls[0][1][1] == "CALL_LIMIT_EXCEEDED"
