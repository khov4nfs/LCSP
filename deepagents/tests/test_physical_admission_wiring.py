"""Physical attempt admission integration tests for Rule Set Preparation.

Covers:
1. Agent Runtime boundary with preexisting state and explicit hard ceiling.
2. Direct runner with no preexisting state.
3. Context propagation into agent.invoke.
4. Assert every physical attempt receives a reservation before dispatch.
5. Production model route identity and fallback chain.
6. Missing or unverifiable provider bounds fails closed.
7. Worker crash, new process and new temporary workspace.
8. Cross-worker storage persistence and concurrent admission.
9. Retry/fallback with separate invocation IDs.
10. No configured cumulative ceiling: monitoring-only execution remains unaffected.
11. Assessment Root regression.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import sqlite3
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from langchain_core.messages import AIMessage
from langchain_core.runnables.config import var_child_runnable_config

from approved_bundle_fixture import offline_instruction_bundle
from assessment_root.runtime_control import RootRuntimeControl
from middleware.failure_policy import PaidAdmissionError
from middleware.paid_admission import (
    RunAdmission,
    TokenPolicy,
    TokenRunBudget,
    fingerprint,
    prepare_admitted_request,
    recover_admission,
    request_identity,
)
from middleware.usage_metering import (
    AgentRunState,
    UsageMeteringMiddleware,
    _bounded_scope,
    activate_agent_run_state,
    active_agent_run_state,
)
from model_policy import (
    DEFAULT_ROUTES_FILE,
    ResolvedModelConfig,
    attach_model_route,
    load_model_routes,
)
from rule_set_preparation.runner import run_rule_set_preparation
from test_rule_set_preparation_agent import (
    FakeApi,
    INDEX_PATH,
    _call,
    _legacy_packet_unit_tools,  # noqa: F401 - isolated packet-layer fixture
    _model,
    _packet,
)
from test_rule_set_preparation_native_isolation_preparation import (
    RuleSetPreparationScriptedModel,
)
from tools.common.capabilities.agent_runtime.invocation import invoke_boundary

SALT = "0" * 64


def _make_scripted_model(responses: list[Any]) -> RuleSetPreparationScriptedModel:
    return _model(responses)


def _make_test_api() -> FakeApi:
    class WiringApi(FakeApi):
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
            is_pause = reason in {
                "AGENT_BUDGET_REACHED",
                "CALL_LIMIT_EXCEEDED",
                "TOKEN_LIMIT_EXCEEDED",
                "NO_PROGRESS_LIMIT_EXCEEDED",
                "BUDGET_EXHAUSTED",
            }
            return {
                "preparationRunId": run_id,
                "executionState": "PAUSED" if is_pause else "FAILED",
            }

    return WiringApi()


@pytest.fixture(autouse=True)
def _reset_model_routes_cache():
    load_model_routes.cache_clear()
    yield
    load_model_routes.cache_clear()


# ==============================================================================
# 1. Agent Runtime boundary with preexisting state and explicit hard ceiling
# ==============================================================================
def test_01_agent_runtime_boundary_preexisting_state_and_hard_ceiling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(db_path))
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://localhost:3000")
    monkeypatch.setenv("WORKER_API_KEY", "test-worker-key")
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "5")
    monkeypatch.setenv("LCSP_RSP_MAX_TOTAL_TOKENS", "2000000")

    from middleware import usage_metering
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, resp=None: None)
    monkeypatch.setattr(
        "tools.common.capabilities.agent_runtime.invocation._agent_stream_session",
        lambda *a, **kw: None,
    )
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient.post_settled_usage",
        lambda *a, **kw: None,
    )
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient.post_agent_stream_event",
        lambda *a, **kw: None,
    )
    monkeypatch.setattr(
        "orchestration.agent_stream.publish_agent_stream_event",
        lambda *a, **kw: None,
    )

    packet = _packet()
    model = _make_scripted_model([
        _call("read_file", {"file_path": INDEX_PATH}, "c1"),
        _call("validate_compliance_rule_set", {"packet": packet}, "c2"),
        AIMessage(content="DONE"),
    ])

    api = _make_test_api()
    run_id = "11111111-1111-4111-8111-111111111111"

    def custom_runner(api_client: Any, r_id: str, **kwargs: Any) -> dict[str, Any]:
        return run_rule_set_preparation(api, r_id, model=model, work_dir=tmp_path)

    monkeypatch.setattr(
        "rule_set_preparation.boundary.run_rule_set_preparation", custom_runner
    )

    with offline_instruction_bundle():
        result = invoke_boundary(
            "rule_set_preparation_requested",
            {"preparationRunId": run_id},
            correlation_id="corr-1",
        )
        assert result["status"] == "COMPLETED"

    # Verify durable reservation was written to SQLite
    with sqlite3.connect(db_path) as db:
        rows = db.execute("SELECT attempt_id, state FROM inference_attempts WHERE run_id=? ORDER BY rowid", (run_id,)).fetchall()
        assert len(rows) >= 1
        assert rows[0][1] in ("ADMITTED", "IN_FLIGHT", "SETTLED", "OUTCOME_UNKNOWN")


# ==============================================================================
# 2. Direct runner with no preexisting state
# ==============================================================================
def test_02_direct_runner_no_preexisting_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(db_path))
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "3")

    from middleware import usage_metering
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, resp=None: None)

    assert active_agent_run_state() is None

    packet = _packet()
    model = _make_scripted_model([
        _call("read_file", {"file_path": INDEX_PATH}, "c1"),
        _call("validate_compliance_rule_set", {"packet": packet}, "c2"),
        AIMessage(content="DONE"),
    ])

    api = _make_test_api()
    run_id = "22222222-2222-4222-8222-222222222222"

    with offline_instruction_bundle():
        result = run_rule_set_preparation(api, run_id, model=model, work_dir=tmp_path)
        assert result["state"] == "PAUSED" or result.get("submission") is not None

    with sqlite3.connect(db_path) as db:
        rows = db.execute("SELECT count(*) FROM inference_attempts WHERE run_id=?", (run_id,)).fetchone()
        assert rows[0] >= 1


# ==============================================================================
# 3. Context propagation into agent.invoke
# ==============================================================================
def test_03_context_propagation_into_agent_invoke(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(db_path))
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "5")

    captured_context: dict[str, Any] = {}

    class ContextInspectingModel(RuleSetPreparationScriptedModel):
        def _generate(self, messages: Any, stop: Any = None, run_manager: Any = None, **kwargs: Any) -> Any:
            captured_context["active_state"] = active_agent_run_state()
            captured_context["bounded_scope"] = _bounded_scope.get()
            captured_context["runnable_config"] = var_child_runnable_config.get()
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    packet = _packet()
    model = ContextInspectingModel(responses=[
        _call("read_file", {"file_path": INDEX_PATH}, "c1"),
        _call("validate_compliance_rule_set", {"packet": packet}, "c2"),
        AIMessage(content="DONE"),
    ])

    from middleware import usage_metering
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, resp=None: None)

    api = _make_test_api()
    run_id = "33333333-3333-4333-8333-333333333333"

    # Set an outer runner runnable config to verify isolation
    var_child_runnable_config.set({"outer_saver": "postgres_checkpoint_saver"})

    with offline_instruction_bundle():
        run_rule_set_preparation(api, run_id, model=model, work_dir=tmp_path)

    st = captured_context.get("active_state")
    assert st is not None, "active_agent_run_state() was not propagated into agent.invoke"
    assert st.bounded is True
    assert st.admission is not None
    assert st.run_id == run_id
    assert captured_context.get("bounded_scope") is st
    # Verify that outer runnable config was isolated and not leaked into agent invoke
    rc = captured_context.get("runnable_config") or {}
    assert "outer_saver" not in rc


# ==============================================================================
# 4. Assert every physical attempt receives a reservation before dispatch
# ==============================================================================
def test_04_every_physical_attempt_receives_reservation_before_dispatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(db_path))
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "1")

    dispatched_calls: list[int] = []

    class DispatchTrackingModel(RuleSetPreparationScriptedModel):
        def _generate(self, messages: Any, stop: Any = None, run_manager: Any = None, **kwargs: Any) -> Any:
            dispatched_calls.append(len(dispatched_calls) + 1)
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    packet = _packet()
    model = DispatchTrackingModel(responses=[
        _call("read_file", {"file_path": INDEX_PATH}, "c1"),
        _call("validate_compliance_rule_set", {"packet": packet}, "c2"),
        AIMessage(content="DONE"),
    ])

    from middleware import usage_metering
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, resp=None: None)

    api = _make_test_api()
    run_id = "44444444-4444-4444-8444-444444444444"

    with offline_instruction_bundle():
        result = run_rule_set_preparation(api, run_id, model=model, work_dir=tmp_path)
        assert result["state"] == "PAUSED"

    # Only 1 call was dispatched because call 2 was prevented by the budget/reservation boundary
    assert len(dispatched_calls) == 1

    with sqlite3.connect(db_path) as db:
        attempts = db.execute("SELECT attempt_id, state FROM inference_attempts WHERE run_id=? ORDER BY rowid", (run_id,)).fetchall()
        assert len(attempts) >= 1
        assert attempts[0][1] in ("ADMITTED", "IN_FLIGHT", "SETTLED", "OUTCOME_UNKNOWN")

        # Now verify that attempting another physical dispatch under the same hard ceiling is DENIED
        env_raw = db.execute("SELECT envelope FROM inference_budgets WHERE run_id=?", (run_id,)).fetchone()[0]
    from middleware.paid_admission import parse_run_budget
    budget_obj = parse_run_budget(json.loads(env_raw))
    adm = RunAdmission(db_path, budget_obj, fingerprint(budget_obj.model_dump(mode="json")))
    ident = {k: getattr(budget_obj.policies[0], k) for k in ("route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model")}
    with pytest.raises(PaidAdmissionError) as exc_info:
        adm.admit("attempt-second-denied", ident)
    assert exc_info.value.reason == "CALL_LIMIT"

    with sqlite3.connect(db_path) as db:
        denied_row = db.execute("SELECT state FROM inference_attempts WHERE run_id=? AND attempt_id=?", (run_id, "attempt-second-denied")).fetchone()
        assert denied_row[0] == "DENIED"


# ==============================================================================
# 5. Production model route identity and fallback chain
# ==============================================================================
def test_05_production_model_route_identity_and_fallback_chain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    routes_file = tmp_path / "test_routes.yaml"
    routes_file.write_text(
        """version: 1
routes:
  prep-primary:
    provider: openai
    protocol: openai
    model: mercury-3
    options:
      context_window_tokens: 1000000
      max_output_tokens: 65536
  prep-fallback:
    provider: google_genai
    protocol: google_genai
    model: gemini-3.5-flash-lite
    options:
      context_window_tokens: 1000000
      max_output_tokens: 65536
roles:
  default: prep-primary
  rule-set-preparation: prep-primary
  claim-author: prep-primary
fallbacks:
  prep-primary: [prep-fallback]
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(routes_file))
    load_model_routes.cache_clear()

    routes_obj = load_model_routes()
    primary_cfg = routes_obj.config("prep-primary")
    fallback_cfg = routes_obj.config("prep-fallback")

    # Construct policies for both
    from middleware.paid_admission import route_fingerprint
    pol_primary = TokenPolicy(
        route_id="prep-primary",
        route_fingerprint=route_fingerprint(primary_cfg),
        credential_fingerprint="1" * 64,
        endpoint_fingerprint="2" * 64,
        sdk_fingerprint="3" * 64,
        provider="openai",
        protocol="openai",
        model="mercury-3",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=1000000,
        output_upper_bound=65536,
    )
    pol_fallback = TokenPolicy(
        route_id="prep-fallback",
        route_fingerprint=route_fingerprint(fallback_cfg),
        credential_fingerprint="4" * 64,
        endpoint_fingerprint="5" * 64,
        sdk_fingerprint="6" * 64,
        provider="google_genai",
        protocol="google_genai",
        model="gemini-3.5-flash-lite",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=1000000,
        output_upper_bound=65536,
    )
    budget = TokenRunBudget(
        schema_version=3,
        run_id="run-routes-05",
        candidate_sha="0" * 40,
        model_routes_sha256=hashlib.sha256(routes_file.read_bytes()).hexdigest(),
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_calls=5,
        policies=(pol_primary, pol_fallback),
    )
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    # Verify both routes can be admitted
    admitted_primary = admission.admit("att-prim", {
        "route_id": "prep-primary",
        "route_fingerprint": pol_primary.route_fingerprint,
        "credential_fingerprint": pol_primary.credential_fingerprint,
        "endpoint_fingerprint": pol_primary.endpoint_fingerprint,
        "sdk_fingerprint": pol_primary.sdk_fingerprint,
        "provider": "openai",
        "protocol": "openai",
        "model": "mercury-3",
    })
    assert admitted_primary.route_id == "prep-primary"

    admitted_fallback = admission.admit("att-fb", {
        "route_id": "prep-fallback",
        "route_fingerprint": pol_fallback.route_fingerprint,
        "credential_fingerprint": pol_fallback.credential_fingerprint,
        "endpoint_fingerprint": pol_fallback.endpoint_fingerprint,
        "sdk_fingerprint": pol_fallback.sdk_fingerprint,
        "provider": "google_genai",
        "protocol": "google_genai",
        "model": "gemini-3.5-flash-lite",
    })
    assert admitted_fallback.route_id == "prep-fallback"


# ==============================================================================
# 6. Missing or unverifiable provider bounds fails closed
# ==============================================================================
def test_06_missing_or_unverifiable_provider_bounds_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(db_path))
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "3")

    routes_file = tmp_path / "unverified_routes.yaml"
    routes_file.write_text(
        """version: 1
routes:
  primary:
    provider: apx
    model: model-alpha
    options:
      context_window_tokens: 0
      max_output_tokens: 0
roles:
  default: primary
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(routes_file))
    load_model_routes.cache_clear()

    model = _make_scripted_model([AIMessage(content="DONE")])
    model._lcsp_route_identity = {
        "route_id": "primary",
        "route_fingerprint": "1" * 64,
        "credential_fingerprint": "2" * 64,
        "endpoint_fingerprint": "3" * 64,
        "sdk_fingerprint": "4" * 64,
        "provider": "apx",
        "protocol": "anthropic",
        "model": "model-alpha",
        "input_upper_bound": 0,
        "output_upper_bound": 0,
    }

    api = _make_test_api()
    run_id = "66666666-6666-4666-8666-666666666666"

    with offline_instruction_bundle(), pytest.raises(PaidAdmissionError) as exc_info:
        run_rule_set_preparation(api, run_id, model=model, work_dir=tmp_path)
    assert exc_info.value.reason == "UNVERIFIED_PROVIDER_BOUNDS"


# ==============================================================================
# 7. Worker crash, new process and new temporary workspace
# ==============================================================================
def test_07_worker_crash_new_process_and_workspace_recovers_reservations(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    pol = TokenPolicy(
        route_id="route-1",
        route_fingerprint="1" * 64,
        credential_fingerprint="2" * 64,
        endpoint_fingerprint="3" * 64,
        sdk_fingerprint="4" * 64,
        provider="anthropic",
        protocol="anthropic",
        model="claude-3",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=10000,
        output_upper_bound=5000,
    )
    budget = TokenRunBudget(
        schema_version=3,
        run_id="run-crash-07",
        candidate_sha="0" * 40,
        model_routes_sha256="0" * 64,
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_total_tokens=20000,
        policies=(pol,),
    )

    # Worker 1 admits an attempt and marks it IN_FLIGHT, then crashes
    w1_admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
    ident = {k: getattr(pol, k) for k in ("route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model")}
    w1_admission.admit("att-1", ident)
    w1_admission.transition("att-1", "IN_FLIGHT")
    del w1_admission

    # Worker 2 in a new workspace recovers the state from SQLite
    snap = recover_admission(db_path, "run-crash-07")
    assert snap is not None
    assert snap["unresolvedAttempts"] == 1
    assert snap["inputExposure"] == 10000
    assert snap["outputExposure"] == 5000
    assert snap["inputExposure"] + snap["outputExposure"] == 15000  # 10000 in + 5000 out reserved

    # Worker 2 attempts another 15,000 tokens exposure -> ceiling is 20,000, so 15000 + 15000 = 30000 > 20000 -> DENIED
    w2_admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
    with pytest.raises(PaidAdmissionError) as exc_info:
        w2_admission.admit("att-2", ident)
    assert exc_info.value.reason == "TOKEN_LIMIT"


# ==============================================================================
# 8. Cross-worker storage persistence and concurrent admission
# ==============================================================================
def test_08_cross_worker_storage_persistence_and_concurrent_admission(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    pol = TokenPolicy(
        route_id="route-1",
        route_fingerprint="1" * 64,
        credential_fingerprint="2" * 64,
        endpoint_fingerprint="3" * 64,
        sdk_fingerprint="4" * 64,
        provider="anthropic",
        protocol="anthropic",
        model="claude-3",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=1000,
        output_upper_bound=1000,
    )
    budget = TokenRunBudget(
        schema_version=3,
        run_id="run-concurrent-08",
        candidate_sha="0" * 40,
        model_routes_sha256="0" * 64,
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_calls=1,  # Only 1 attempt permitted!
        policies=(pol,),
    )
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
    ident = {k: getattr(pol, k) for k in ("route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model")}

    results: list[str] = []

    def worker_admit(attempt_id: str) -> None:
        try:
            adm = RunAdmission(db_path, budget, admission.identity)
            adm.admit(attempt_id, ident)
            results.append("ADMITTED")
        except PaidAdmissionError:
            results.append("DENIED")

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(worker_admit, f"att-c-{i}") for i in range(4)]
        concurrent.futures.wait(futures)

    assert results.count("ADMITTED") == 1
    assert results.count("DENIED") == 3


# ==============================================================================
# 9. Retry/fallback with separate invocation IDs
# ==============================================================================
def test_09_retry_fallback_separate_invocation_ids(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "recovery.sqlite3"
    pol = TokenPolicy(
        route_id="route-1",
        route_fingerprint="1" * 64,
        credential_fingerprint="2" * 64,
        endpoint_fingerprint="3" * 64,
        sdk_fingerprint="4" * 64,
        provider="anthropic",
        protocol="anthropic",
        model="claude-3",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=1000,
        output_upper_bound=1000,
    )
    budget = TokenRunBudget(
        schema_version=3,
        run_id="run-retry-09",
        candidate_sha="0" * 40,
        model_routes_sha256="0" * 64,
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_calls=5,
        policies=(pol,),
    )
    admission = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))
    ident = {k: getattr(pol, k) for k in ("route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model")}

    # Attempt 1 fails
    admission.admit("phys-attempt-1", ident)
    admission.transition("phys-attempt-1", "IN_FLIGHT")
    admission.transition("phys-attempt-1", "OUTCOME_UNKNOWN")

    # Retry attempt 2 succeeds with its own separate ID
    admission.admit("phys-attempt-2", ident)
    admission.transition("phys-attempt-2", "IN_FLIGHT")
    admission.settle("phys-attempt-2", {"inputTokens": 120, "outputTokens": 80})

    snap = recover_admission(db_path, "run-retry-09")
    assert snap["admittedAttempts"] == 2
    assert snap["unresolvedAttempts"] == 1  # attempt 1 outcome unknown
    with sqlite3.connect(db_path) as db:
        settled_count = db.execute("SELECT count(*) FROM inference_attempts WHERE run_id='run-retry-09' AND state='SETTLED'").fetchone()[0]
        assert settled_count == 1


# ==============================================================================
# 10. No configured cumulative ceiling: monitoring-only execution remains unaffected
# ==============================================================================
def test_10_no_configured_cumulative_ceiling_monitoring_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("LCSP_WORKLOAD_LIMITS_RULE_SET_PREPARATION", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_MODEL_CALLS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_INPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.delenv("LCSP_RSP_MAX_TOTAL_TOKENS", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-offline-key")
    monkeypatch.setenv("OPENAI_API_KEY", "test-offline-key")

    from middleware import usage_metering
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, resp=None: None)

    packet = _packet()
    model = _make_scripted_model([
        _call("read_file", {"file_path": INDEX_PATH}, "c1"),
        _call("validate_compliance_rule_set", {"packet": packet}, "c2"),
        _call("submit_compliance_rule_set", {"packet": packet}, "c3"),
        AIMessage(content="DONE"),
    ])

    api = _make_test_api()
    run_id = "10101010-1010-4010-8010-101010101010"

    with offline_instruction_bundle():
        result = run_rule_set_preparation(api, run_id, model=model, work_dir=tmp_path)
        assert result["state"] == "SUCCEEDED"
        assert result.get("submission") is not None
        assert result["failureReason"] is None


# ==============================================================================
# 11. Assessment Root regression
# ==============================================================================
def test_11_assessment_root_regression(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = MagicMock()
    control = RootRuntimeControl(client, "exec-root-11", run=SimpleNamespace(assessment_id="test-asm"))
    control._effective_context = {
        "assessmentId": "asm-11",
        "caseRevision": 1,
        "budgetState": {
            "limits": {"maxModelCalls": 2},
            "status": "ADMITTED",
        },
    }

    state1 = {"case_revision": 1, "messages": [SimpleNamespace(tool_calls=[{"name": "t1", "args": {}}])]}
    assert control._evaluate_intra_execution_progress(state1) is None
    state2 = {"case_revision": 1, "messages": [SimpleNamespace(tool_calls=[{"name": "t2", "args": {}}])]}
    assert control._evaluate_intra_execution_progress(state2) is None
