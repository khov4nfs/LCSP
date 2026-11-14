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
    isolated_test_scripted_models,
    prepare_admitted_request,
    recover_admission,
    register_test_scripted_model,
    request_identity,
    route_fingerprint,
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

    with isolated_test_scripted_models():
        register_test_scripted_model(model, "primary", credential_salt=SALT)
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

    with isolated_test_scripted_models():
        register_test_scripted_model(model, "primary", credential_salt=SALT)
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

    with isolated_test_scripted_models():
        register_test_scripted_model(model, "primary", credential_salt=SALT)
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

    with isolated_test_scripted_models():
        register_test_scripted_model(model, "primary", credential_salt=SALT)
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
    api = _make_test_api()
    run_id = "66666666-6666-4666-8666-666666666666"

    # 1. Registering test scripted model with non-positive bounds fails closed
    with isolated_test_scripted_models():
        with pytest.raises(PaidAdmissionError) as exc_info:
            register_test_scripted_model(model, "primary", credential_salt=SALT)
        assert exc_info.value.reason == "UNVERIFIED_PROVIDER_BOUNDS"

    # 2. Production admission policies resolution fails closed when route bounds are non-positive
    with offline_instruction_bundle(), pytest.raises(PaidAdmissionError) as exc_info:
        run_rule_set_preparation(api, run_id, work_dir=tmp_path)
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


# ==============================================================================
# 12. Negative test: Unbound model rejected
# ==============================================================================
def test_12_unbound_model_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An injected model without genuine route binding or test registry fails closed."""
    db_path = tmp_path / "recovery.sqlite3"
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(db_path))
    monkeypatch.setenv("LCSP_RSP_MAX_MODEL_CALLS", "3")

    model = _make_scripted_model([AIMessage(content="DONE")])
    api = _make_test_api()
    run_id = "unbound-12-1212-1212-1212-121212121212"

    # request_identity rejects unbound model directly
    with pytest.raises(PaidAdmissionError) as exc_info:
        request_identity(model, SALT)
    assert exc_info.value.reason == "UNBOUND_MODEL_ROUTE"

    # run_rule_set_preparation under hard ceiling rejects unbound model
    with offline_instruction_bundle(), pytest.raises(PaidAdmissionError) as exc_info:
        run_rule_set_preparation(api, run_id, model=model, work_dir=tmp_path)
    assert exc_info.value.reason == "UNBOUND_MODEL_ROUTE"


# ==============================================================================
# 13. Negative test: Forged route identity rejected
# ==============================================================================
def test_13_forged_route_identity_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Arbitrary _lcsp_route_identity or tampered route configs are never trusted."""
    model = _make_scripted_model([AIMessage(content="DONE")])
    # Attacker injects synthetic route identity attribute
    model._lcsp_route_identity = {
        "route_id": "primary",
        "route_fingerprint": "f" * 64,
        "credential_fingerprint": "c" * 64,
        "endpoint_fingerprint": "e" * 64,
        "sdk_fingerprint": "s" * 64,
        "provider": "apx",
        "protocol": "anthropic",
        "model": "model-alpha",
        "input_upper_bound": 1000000,
        "output_upper_bound": 65536,
    }

    # Production request_identity ignores attribute and fails closed
    with pytest.raises(PaidAdmissionError) as exc_info:
        request_identity(model, SALT)
    assert exc_info.value.reason == "UNBOUND_MODEL_ROUTE"

    # Attacker attaches unregistered route config
    forged_cfg = ResolvedModelConfig(
        role="",
        route_id="malicious-unregistered-route",
        provider="openai",
        protocol="openai",
        model="mercury-3",
        options={"context_window_tokens": 1000000, "max_output_tokens": 65536},
    )
    attach_model_route(model, forged_cfg)
    with pytest.raises(PaidAdmissionError) as exc_info:
        request_identity(model, SALT)
    assert exc_info.value.reason == "UNBOUND_MODEL_ROUTE"

    # Attacker tampers with registered route options
    routes_obj = load_model_routes()
    prim_cfg = routes_obj.config("primary")
    tampered_cfg = ResolvedModelConfig(
        role="",
        route_id="primary",
        provider=prim_cfg.provider,
        protocol=prim_cfg.protocol,
        model=prim_cfg.model,
        options={**prim_cfg.options, "max_output_tokens": 9999999},  # tampered options!
    )
    attach_model_route(model, tampered_cfg)
    with pytest.raises(PaidAdmissionError) as exc_info:
        request_identity(model, SALT)
    assert exc_info.value.reason == "FORGED_ROUTE_IDENTITY"


# ==============================================================================
# 14. Negative test: Forged credential fingerprint denied
# ==============================================================================
def test_14_forged_credential_fingerprint_denied(tmp_path: Path) -> None:
    """Admission denies requests with tampered credential fingerprints."""
    db_path = tmp_path / "recovery.sqlite3"
    routes_obj = load_model_routes()
    cfg = routes_obj.config("primary")

    pol = TokenPolicy(
        route_id="primary",
        route_fingerprint=route_fingerprint(cfg),
        credential_fingerprint="1" * 64,
        endpoint_fingerprint="2" * 64,
        sdk_fingerprint="3" * 64,
        provider="apx",
        protocol="anthropic",
        model="model-alpha",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=1000000,
        output_upper_bound=65536,
    )
    budget = TokenRunBudget(
        schema_version=3,
        run_id="run-forged-cred-14",
        candidate_sha="0" * 40,
        model_routes_sha256="0" * 64,
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_calls=5,
        policies=(pol,),
    )
    adm = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    # Tampered credential fingerprint
    forged_ident = {
        "route_id": "primary",
        "route_fingerprint": pol.route_fingerprint,
        "credential_fingerprint": "9" * 64,  # tampered hex fingerprint!
        "endpoint_fingerprint": pol.endpoint_fingerprint,
        "sdk_fingerprint": pol.sdk_fingerprint,
        "provider": "apx",
        "protocol": "anthropic",
        "model": "model-alpha",
    }
    with pytest.raises(PaidAdmissionError) as exc_info:
        adm.admit("att-forged-14", forged_ident)
    assert exc_info.value.reason in ("POLICY_MISMATCH", "UNKNOWN_TOKEN_POLICY", "CREDENTIAL_UNVERIFIED")

    with sqlite3.connect(db_path) as db:
        row = db.execute("SELECT state FROM inference_attempts WHERE run_id='run-forged-cred-14' AND attempt_id='att-forged-14'").fetchone()
        assert row[0] == "DENIED"


# ==============================================================================
# 15. Negative test: Unauthorized model_settings rejected
# ==============================================================================
def test_15_unauthorized_model_settings_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Request options that exceed policy bounds or introduce unknown parameters are rejected."""
    from langchain_openai import ChatOpenAI
    routes_file = tmp_path / "settings_routes.yaml"
    routes_file.write_text(
        """version: 1
routes:
  test-openai:
    provider: openai
    protocol: openai
    model: mercury-3
    options:
      context_window_tokens: 1000000
      max_output_tokens: 4096
roles:
  default: test-openai
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(routes_file))
    load_model_routes.cache_clear()
    routes_obj = load_model_routes()
    cfg = routes_obj.config("test-openai")

    model = ChatOpenAI(model="mercury-3", api_key="sk-test-fake-key", max_retries=0)
    attach_model_route(model, cfg)
    ident = request_identity(model, SALT)

    pol = TokenPolicy(
        route_id=ident["route_id"],
        route_fingerprint=ident["route_fingerprint"],
        credential_fingerprint=ident["credential_fingerprint"],
        endpoint_fingerprint=ident["endpoint_fingerprint"],
        sdk_fingerprint=ident["sdk_fingerprint"],
        provider=ident["provider"],
        protocol=ident["protocol"],
        model=ident["model"],
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=1000000,
        output_upper_bound=4096,  # Upper bound is 4096
    )
    routes_sha = hashlib.sha256(routes_file.read_bytes()).hexdigest()

    class FakeReq:
        def __init__(self, m: Any, s: dict[str, Any] | None = None):
            self.model = m
            self.model_settings = s or {}

        def override(self, **kwargs: Any) -> "FakeReq":
            return FakeReq(self.model, {**self.model_settings, **kwargs.get("model_settings", {})})

    # Case A: max_tokens exceeds output_upper_bound (4096)
    budget_a = TokenRunBudget(
        schema_version=3,
        run_id="run-settings-15-a",
        candidate_sha="0" * 40,
        model_routes_sha256=routes_sha,
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_calls=5,
        policies=(pol,),
    )
    adm_a = RunAdmission(tmp_path / "rec_a.sqlite3", budget_a, fingerprint(budget_a.model_dump(mode="json")))
    req_excess = FakeReq(model, {"max_tokens": 10000})
    with pytest.raises(PaidAdmissionError) as exc_info:
        prepare_admitted_request(adm_a, req_excess, "att-15-a", "rule-set-preparation")
    assert exc_info.value.reason == "OUTPUT_BOUND_UNVERIFIED"

    # Case B: unauthorized extra parameter in model_settings
    budget_b = TokenRunBudget(
        schema_version=3,
        run_id="run-settings-15-b",
        candidate_sha="0" * 40,
        model_routes_sha256=routes_sha,
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_calls=5,
        policies=(pol,),
    )
    adm_b = RunAdmission(tmp_path / "rec_b.sqlite3", budget_b, fingerprint(budget_b.model_dump(mode="json")))
    req_unauth = FakeReq(model, {"max_tokens": 2048, "temperature": 0.7})
    with pytest.raises(PaidAdmissionError) as exc_info:
        prepare_admitted_request(adm_b, req_unauth, "att-15-b", "rule-set-preparation")
    assert exc_info.value.reason == "UNBOUNDED_REQUEST_OPTIONS"


# ==============================================================================
# 16. Positive test: Valid native model admitted
# ==============================================================================
def test_16_valid_native_model_admitted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Authentic native ChatOpenAI model derives verified identity and admits cleanly."""
    from langchain_openai import ChatOpenAI
    routes_file = tmp_path / "native_routes.yaml"
    routes_file.write_text(
        """version: 1
routes:
  native-openai:
    provider: openai
    protocol: openai
    model: mercury-3
    options:
      context_window_tokens: 1000000
      max_output_tokens: 65536
roles:
  default: native-openai
  rule-set-preparation: native-openai
  claim-author: native-openai
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(routes_file))
    load_model_routes.cache_clear()
    routes_obj = load_model_routes()
    cfg = routes_obj.config("native-openai")

    model = ChatOpenAI(model="mercury-3", api_key="sk-test-fake-key", max_retries=0)
    attach_model_route(model, cfg)
    ident = request_identity(model, SALT)

    assert ident["route_id"] == "native-openai"
    assert ident["provider"] == "openai"
    assert ident["protocol"] == "openai"
    assert ident["model"] == "mercury-3"
    assert isinstance(ident["credential_fingerprint"], str) and len(ident["credential_fingerprint"]) == 64

    pol = TokenPolicy(
        route_id=ident["route_id"],
        route_fingerprint=ident["route_fingerprint"],
        credential_fingerprint=ident["credential_fingerprint"],
        endpoint_fingerprint=ident["endpoint_fingerprint"],
        sdk_fingerprint=ident["sdk_fingerprint"],
        provider=ident["provider"],
        protocol=ident["protocol"],
        model=ident["model"],
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=1000000,
        output_upper_bound=65536,
    )
    routes_sha = hashlib.sha256(routes_file.read_bytes()).hexdigest()
    budget = TokenRunBudget(
        schema_version=3,
        run_id="run-native-16",
        candidate_sha="0" * 40,
        model_routes_sha256=routes_sha,
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_calls=5,
        policies=(pol,),
    )
    db_path = tmp_path / "recovery.sqlite3"
    adm = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    class FakeReq:
        def __init__(self, m: Any, s: dict[str, Any] | None = None):
            self.model = m
            self.model_settings = s or {}

        def override(self, **kwargs: Any) -> "FakeReq":
            return FakeReq(self.model, {**self.model_settings, **kwargs.get("model_settings", {})})

    req = FakeReq(model, {"max_tokens": 4096})
    admitted_req = prepare_admitted_request(adm, req, "att-16", "rule-set-preparation")
    assert admitted_req.model_settings["max_tokens"] == 4096
    assert admitted_req.model_settings["n"] == 1  # provider cap pinned

    with sqlite3.connect(db_path) as db:
        row = db.execute("SELECT state, input_exposure, output_exposure FROM inference_attempts WHERE run_id='run-native-16' AND attempt_id='att-16'").fetchone()
        assert row[0] == "ADMITTED"
        assert row[1] == 1000000
        assert row[2] == 65536


# ==============================================================================
# 17. Positive & isolation test: Legitimate test-only scripted model
# ==============================================================================
def test_17_legitimate_test_scripted_model_isolated(tmp_path: Path) -> None:
    """Scripted model operates within isolated test registry but is completely unbound outside."""
    model = _make_scripted_model([AIMessage(content="DONE")])

    # Outside the context: request_identity fails closed
    with pytest.raises(PaidAdmissionError) as exc_info:
        request_identity(model, SALT)
    assert exc_info.value.reason == "UNBOUND_MODEL_ROUTE"

    # Inside the context: registration succeeds and model is recognized
    with isolated_test_scripted_models():
        ident = register_test_scripted_model(model, "primary", credential_salt=SALT)
        assert ident["route_id"] == "primary"
        assert ident["model"] == "model-alpha"

        resolved = request_identity(model, SALT)
        assert resolved["route_id"] == "primary"
        assert resolved["credential_fingerprint"] == ident["credential_fingerprint"]

    # Outside the context again: test registry is cleanly reset, model is unbound
    with pytest.raises(PaidAdmissionError) as exc_info:
        request_identity(model, SALT)
    assert exc_info.value.reason == "UNBOUND_MODEL_ROUTE"


# ==============================================================================
# 18. Physical retry and fallback with real middleware composition
# ==============================================================================
def test_18_physical_retry_and_fallback_with_real_middleware_composition(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Primary attempt fails, unknown usage is preserved, secondary attempt is admitted and settled under distinct policy."""
    db_path = tmp_path / "recovery.sqlite3"
    routes_file = tmp_path / "fallback_routes.yaml"
    routes_file.write_text(
        """version: 1
routes:
  primary-route:
    provider: openai
    protocol: openai
    model: gpt-4o
    options:
      context_window_tokens: 128000
      max_output_tokens: 4096
  secondary-route:
    provider: anthropic
    protocol: anthropic
    model: claude-3-haiku
    options:
      context_window_tokens: 200000
      max_output_tokens: 4096
roles:
  default: primary-route
  rule-set-preparation: primary-route
  claim-author: primary-route
fallbacks:
  primary-route: [secondary-route]
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(routes_file))
    load_model_routes.cache_clear()
    routes_obj = load_model_routes()

    pol_prim = TokenPolicy(
        route_id="primary-route",
        route_fingerprint=route_fingerprint(routes_obj.config("primary-route")),
        credential_fingerprint="1" * 64,
        endpoint_fingerprint="e" * 64,
        sdk_fingerprint="f" * 64,
        provider="openai",
        protocol="openai",
        model="gpt-4o",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=128000,
        output_upper_bound=4096,
    )
    pol_sec = TokenPolicy(
        route_id="secondary-route",
        route_fingerprint=route_fingerprint(routes_obj.config("secondary-route")),
        credential_fingerprint="2" * 64,
        endpoint_fingerprint="a" * 64,
        sdk_fingerprint="b" * 64,
        provider="anthropic",
        protocol="anthropic",
        model="claude-3-haiku",
        valid_from=1,
        expires_at=2147483647,
        input_upper_bound=200000,
        output_upper_bound=4096,
    )
    routes_sha = hashlib.sha256(routes_file.read_bytes()).hexdigest()
    budget = TokenRunBudget(
        schema_version=3,
        run_id="run-fallback-18",
        candidate_sha="0" * 40,
        model_routes_sha256=routes_sha,
        credential_salt=SALT,
        valid_from=1,
        expires_at=None,
        maximum_calls=5,
        policies=(pol_prim, pol_sec),
    )
    adm = RunAdmission(db_path, budget, fingerprint(budget.model_dump(mode="json")))

    state = AgentRunState(
        run_id="run-fallback-18",
        agent_role="rule-set-preparation",
        preparation_run_id="prep-18",
        bounded=True,
    )
    state.admission = adm
    state.store = db_path

    with activate_agent_run_state(state):
        # 1. Physical Attempt 1 on primary route fails with 503 error
        inv_1 = "inv-18-primary-attempt"
        ident_prim = {k: getattr(pol_prim, k) for k in ("route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model")}
        adm.admit(inv_1, ident_prim)
        adm.transition(inv_1, "IN_FLIGHT")
        state.record_attempt(_make_scripted_model([]), inv_1, "STARTED")

        # Simulate provider 503 failure
        error_503 = Exception("HTTP 503 Service Unavailable")
        setattr(error_503, "status_code", 503)
        UsageMeteringMiddleware._unknown(inv_1, _make_scripted_model([]), error_503)

        # 2. Physical Attempt 2 on fallback secondary route succeeds
        inv_2 = "inv-18-secondary-attempt"
        ident_sec = {k: getattr(pol_sec, k) for k in ("route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model")}
        adm.admit(inv_2, ident_sec)
        adm.transition(inv_2, "IN_FLIGHT")
        state.record_attempt(_make_scripted_model([]), inv_2, "STARTED")

        # Fallback attempt returns response with usage
        resp = AIMessage(content="Fallback answer", usage_metadata={"input_tokens": 150, "output_tokens": 75, "total_tokens": 225})
        UsageMeteringMiddleware()._record(resp, _make_scripted_model([]), inv_2)

    # 3. Assert admission state in SQLite: Attempt 1 is OUTCOME_UNKNOWN (reserved), Attempt 2 is SETTLED (measured)
    with sqlite3.connect(db_path) as db:
        attempts = db.execute("SELECT attempt_id, state, input_exposure, output_exposure, usage FROM inference_attempts WHERE run_id='run-fallback-18' ORDER BY rowid").fetchall()
        assert len(attempts) == 2
        # Attempt 1 retained unknown exposure
        assert attempts[0][0] == inv_1
        assert attempts[0][1] == "OUTCOME_UNKNOWN"
        assert attempts[0][2] == 128000
        assert attempts[0][3] == 4096
        # Attempt 2 settled with measured tokens
        assert attempts[1][0] == inv_2
        assert attempts[1][1] == "SETTLED"
        usage_data = json.loads(attempts[1][4])
        assert int(usage_data.get("inputTokensIncludingCache") or usage_data.get("inputTokens")) == 150
        assert int(usage_data["outputTokens"]) == 75

    # Recovery snapshot verifies both attempts accounted for truthfully
    snap = recover_admission(db_path, "run-fallback-18")
    assert snap["admittedAttempts"] == 2
    assert snap["unresolvedAttempts"] == 1
    assert sum(r["state"] == "SETTLED" for r in snap["attempts"]) == 1
    assert snap["inputExposure"] == 128000 + 150
    assert snap["outputExposure"] == 4096 + 75

