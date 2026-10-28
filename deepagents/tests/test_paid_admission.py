"""Offline admission proofs. Synthetic tariffs here are never provider price evidence."""
import asyncio
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from contextvars import copy_context
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

import httpx
import pytest
from langchain.agents import create_agent
from langchain.agents.middleware import ModelRequest, ModelResponse, ModelRetryMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from middleware import paid_admission, usage_metering
from middleware.failure_policy import PaidAdmissionError, retry_model_error
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE, _GovernedInternalModelRunnable
from middleware.paid_admission import ChargePolicy, RunAdmission, RunBudget, fingerprint, recover_admission, request_identity as native_request_identity
from middleware.provider_fallback import ProviderFallbackMiddleware, provider_fallback_failure
from middleware.token_fallback import TokenFallbackMiddleware
from middleware.usage_metering import AgentRoleMiddleware, UsageMeteringMiddleware, activate_agent_run_state
from model_policy import DEFAULT_ROUTES_FILE, build_model, load_model_routes, model_route_config
from vertical.live_preparation import LiveUsage, recover_usage

OFFLINE_CREDENTIAL_SALT = "c" * 64


def request_identity(model):
    return native_request_identity(model, OFFLINE_CREDENTIAL_SALT)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(DEFAULT_ROUTES_FILE))
    for key in ["MIRAI_API_KEY", "INCEPTION_API_KEY", "GOOGLE_API_KEY", "APX_API_KEY"]:
        monkeypatch.setenv(key, "offline-admission-key")
    load_model_routes.cache_clear()
    def blocked(*args, **kwargs):
        raise AssertionError("Provider networking is prohibited in admission tests")
    import anthropic._base_client as anthropic_client
    sdk_httpx = getattr(anthropic_client, "httpx2", None) or getattr(anthropic_client, "httpx")
    for family in {httpx, sdk_httpx}:
        monkeypatch.setattr(family.HTTPTransport, "handle_request", blocked)
        monkeypatch.setattr(family.AsyncHTTPTransport, "handle_async_request", blocked)


def native(route="primary", key=None):
    config = load_model_routes().config(route)
    model = build_model(config)
    if key:
        from middleware.token_fallback import model_with_token
        model = model_with_token(model, config.provider, key)
    return model


def policy_for(model):
    return ChargePolicy(**request_identity(model), evidence_url="https://example.invalid/offline-contract",
        evidence_sha256="e" * 64, verified_by="OFFLINE_FIXTURE_ONLY", valid_from=1, expires_at=4102444800,
        coverage="ALL_CHARGES_AND_PROVIDER_HARD_TOKEN_LIMITS", input_upper_bound=1000,
        output_upper_bound=262144, input_rate=10, cache_read_rate=2, cache_write_rate=15,
        output_rate=30, reasoning_rate=40, fixed_charge=7, minimum_charge=10, rounding_quantum=10)


def budget_for(*models, **changes):
    data = dict(schema_version=2, run_id="run", candidate_sha="1" * 40,
        credential_salt=OFFLINE_CREDENTIAL_SALT,
        model_routes_sha256=hashlib.sha256(DEFAULT_ROUTES_FILE.read_bytes()).hexdigest(),
        valid_from=1, expires_at=4102444800, maximum_calls=20, maximum_input_tokens=20000,
        maximum_output_tokens=20 * 262144, maximum_charge_nano_usd=100000000,
        policies=tuple(policy_for(m) for m in models))
    data.update(changes)
    return RunBudget(**data)


def state_for(tmp_path, *models, **changes):
    budget = budget_for(*(models or [native()]), **changes)
    return LiveUsage(budget.run_id, str(tmp_path / f"{budget.run_id}.json"), budget=budget,
        budget_fingerprint=fingerprint(budget.model_dump(mode="json")), bounded=True)


def req(model, **settings):
    return ModelRequest(model=model, messages=[HumanMessage("PRIVATE_PROMPT_MUST_NOT_REACH_LEDGER")],
                        tools=[], model_settings=settings)


def answer():
    return ModelResponse(result=[AIMessage(content="CONFIDENTIAL_RESPONSE", usage_metadata={
        "input_tokens": 13, "output_tokens": 3, "total_tokens": 16,
        "input_token_details": {"cache_read": 2, "cache_creation": 1},
        "output_token_details": {"reasoning": 1}})])


def snapshot(state):
    return recover_admission(state.store, state.run_id)


def invoke(state, model=None, handler=None):
    with activate_agent_run_state(state):
        return UsageMeteringMiddleware().wrap_model_call(req(model or native()), handler or (lambda _: answer()))


@pytest.mark.parametrize("limit,value,reason", [
    ("maximum_calls", 0, "CALL_LIMIT"), ("maximum_input_tokens", 999, "INPUT_LIMIT"),
    ("maximum_output_tokens", 262143, "OUTPUT_LIMIT"), ("maximum_charge_nano_usd", 1, "CHARGE_LIMIT"),
])
def test_ceiling_denies_before_handler_and_is_terminal(tmp_path, limit, value, reason):
    model = native()
    state = state_for(tmp_path, model, **{limit: value})
    calls = []
    with pytest.raises(PaidAdmissionError, match=reason):
        invoke(state, model, lambda r: calls.append(r))
    assert calls == [] and snapshot(state)["admittedAttempts"] == 0
    assert snapshot(state)["terminalReason"] == reason
    with pytest.raises(PaidAdmissionError, match=reason):
        invoke(state, model, lambda r: calls.append(r))
    assert calls == []


def test_exact_boundary_commits_before_dispatch_then_refunds_proven_usage(tmp_path):
    model = native()
    policy = policy_for(model)
    state = state_for(tmp_path, model, maximum_calls=1, maximum_input_tokens=1000,
                      maximum_output_tokens=262144, maximum_charge_nano_usd=policy.exposure())
    seen = []
    def handler(request):
        pending = snapshot(state)
        assert pending["attempts"][0]["state"] == "IN_FLIGHT"
        assert pending["chargeExposureNanoUSD"] == policy.exposure()
        seen.append(request)
        return answer()
    invoke(state, model, handler)
    result = snapshot(state)
    assert len(seen) == 1 and result["unresolvedAttempts"] == 0
    assert result["inputExposure"] == 13 and result["outputExposure"] == 3
    assert result["chargeExposureNanoUSD"] == policy.charge(10, 2, 1, 3, 1)
    with pytest.raises(PaidAdmissionError, match="CALL_LIMIT"):
        invoke(state, model, handler)
    assert len(seen) == 1


@pytest.mark.parametrize("failure", [TimeoutError, ConnectionError, asyncio.CancelledError])
def test_unknown_outcomes_retain_full_exposure(tmp_path, failure):
    state = state_for(tmp_path)
    def fail(_):
        raise failure("offline unanswered request")
    with pytest.raises(failure): invoke(state, handler=fail)
    result = snapshot(state)
    assert result["attempts"][0]["state"] == "OUTCOME_UNKNOWN"
    assert result["inputExposure"] == 1000 and result["outputExposure"] == 262144
    assert result["knownActualChargeNanoUSD"] == 0 and result["unresolvedChargeExposureNanoUSD"] > 0


@pytest.mark.parametrize("usage", [None, {}, {"input_tokens": 1, "output_tokens": 2},
                                    {"input_tokens": 1, "output_tokens": 2, "input_token_details": {"cache_read": 0}}])
def test_missing_usage_is_unresolved_and_never_refunded(tmp_path, usage):
    state = state_for(tmp_path)
    invoke(state, handler=lambda _: ModelResponse(result=[AIMessage(content="fixture", usage_metadata={**usage, "total_tokens": 3} if usage else None)]))
    result = snapshot(state)
    assert result["unresolvedAttempts"] == 1 and result["inputExposure"] == 1000
    assert result["attempts"][0]["actual_charge"] is None


@pytest.mark.parametrize("route", ["primary", "fallback", "fallback-01", "fallback-02", "fallback", "fallback-02"])
def test_unknown_tariff_is_terminal_and_cannot_fallback(tmp_path, route):
    model = native(route)
    state = state_for(tmp_path, model, policies=())
    seen = []
    meter = UsageMeteringMiddleware()
    with activate_agent_run_state(state), pytest.raises(PaidAdmissionError, match="UNKNOWN_TARIFF"):
        ProviderFallbackMiddleware().wrap_model_call(req(model), lambda r: meter.wrap_model_call(r, lambda _: seen.append(1)))
    assert seen == [] and snapshot(state)["terminalReason"] == "UNKNOWN_TARIFF"


def test_missing_bounded_policy_and_scope_switches_reject(tmp_path):
    with pytest.raises(PaidAdmissionError, match="MISSING_RUN_BUDGET"):
        LiveUsage("run", str(tmp_path / "missing.json"), bounded=True)
    state = state_for(tmp_path)
    with activate_agent_run_state(state):
        with pytest.raises(PaidAdmissionError, match="BOUNDED_SCOPE_CHANGED"):
            with activate_agent_run_state(None): pass
        with pytest.raises(PaidAdmissionError, match="BOUNDED_SCOPE_CHANGED"):
            with activate_agent_run_state(usage_metering.AgentRunState("run", "reader")): pass


def test_bad_changed_stale_policy_and_route_identity_reject(tmp_path, monkeypatch):
    from pydantic import ValidationError
    model = native()
    budget = budget_for(model)
    with pytest.raises(PaidAdmissionError, match="BUDGET_IDENTITY"):
        RunAdmission(tmp_path / "bad.sqlite3", budget, "f" * 64)
    with pytest.raises(ValidationError): RunBudget(**{**budget.model_dump(), "maximum_calls": -1})
    state = state_for(tmp_path, model)
    changed = budget_for(model, maximum_calls=21)
    with pytest.raises(PaidAdmissionError, match="BUDGET_CHANGED"):
        RunAdmission(state.store, changed, fingerprint(changed.model_dump(mode="json")))
    monkeypatch.setattr(paid_admission.time, "time", lambda: 4102444801)
    with pytest.raises(PaidAdmissionError, match="BUDGET_EXPIRED"): invoke(state, model)


def test_credential_fingerprint_is_salted_and_pinned_in_budget(tmp_path):
    model = native()
    identity = request_identity(model)
    assert identity["credential_fingerprint"] != hashlib.sha256(b"offline-admission-key").hexdigest()
    assert identity["credential_fingerprint"] != native_request_identity(model, "d" * 64)["credential_fingerprint"]
    state = state_for(tmp_path, model, credential_salt="d" * 64)
    with pytest.raises(PaidAdmissionError, match="UNKNOWN_TARIFF"): invoke(state, model)


@pytest.mark.parametrize("change", ["credential", "endpoint", "policy_expired", "route_file", "output_override", "http_override", "sdk_retries", "model_id", "async_key", "sdk_version"])
def test_unverified_request_changes_reject_before_dispatch(tmp_path, monkeypatch, change):
    model = native()
    state = state_for(tmp_path, model)
    request = req(model)
    if change == "credential": model = native(key="other-offline-key"); request = req(model)
    if change == "endpoint": model._client.base_url = "https://other.invalid"
    if change == "policy_expired":
        policy = policy_for(model).model_copy(update={"expires_at": 2})
        state = state_for(tmp_path / "other", model, policies=(policy,))
    if change == "route_file":
        config = tmp_path / "changed-routes.yaml"; config.write_bytes(DEFAULT_ROUTES_FILE.read_bytes() + b"\n")
        monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(config))
    if change == "output_override": request = req(model, max_tokens=262145)
    if change == "http_override": request = req(model, http_options={"retry_options": {"attempts": 10}})
    if change == "sdk_retries": model._client.max_retries = 2
    if change == "model_id": model.model = "other-model"
    if change == "async_key": model._async_client.api_key = "other-offline-key"
    if change == "sdk_version":
        import importlib.metadata
        monkeypatch.setattr(importlib.metadata, "version", lambda _: "different-sdk-version")
    seen = []
    with activate_agent_run_state(state), pytest.raises(PaidAdmissionError):
        UsageMeteringMiddleware().wrap_model_call(request, lambda _: seen.append(1))
    assert seen == []


def test_duplicate_admission_and_settlement_are_idempotent(tmp_path):
    state = state_for(tmp_path)
    invoke(state)
    result = snapshot(state)
    row = result["attempts"][0]
    with pytest.raises(PaidAdmissionError, match="DUPLICATE_ATTEMPT"):
        state.admission.admit(row["attempt_id"], request_identity(native()))
    state.admission.settle(row["attempt_id"], json.loads(row["usage"]))
    state.admission.transition(row["attempt_id"], "OUTCOME_UNKNOWN")
    assert snapshot(state)["attempts"] == result["attempts"]
    assert snapshot(state)["chargeExposureNanoUSD"] == result["chargeExposureNanoUSD"]
    assert snapshot(state)["terminalReason"] == "DUPLICATE_ATTEMPT"
    with pytest.raises(PaidAdmissionError, match="CONFLICTING_SETTLEMENT"):
        state.admission.settle(row["attempt_id"], {})


def test_late_response_reconciles_unknown_once(tmp_path):
    model = native()
    state = state_for(tmp_path, model)
    with pytest.raises(TimeoutError): invoke(state, model, lambda _: (_ for _ in ()).throw(TimeoutError()))
    row = snapshot(state)["attempts"][0]
    meter = UsageMeteringMiddleware()
    with activate_agent_run_state(state):
        meter._record(answer(), model, row["attempt_id"])
        meter._record(answer(), model, row["attempt_id"])
    assert snapshot(state)["admittedAttempts"] == 1 and snapshot(state)["unresolvedAttempts"] == 0
    assert recover_usage(str(tmp_path / "run.json"), "run")["modelCalls"] == 1


@pytest.mark.parametrize("stage", ["ADMITTED", "IN_FLIGHT"])
def test_killed_process_retains_unresolved_reservations(tmp_path, stage):
    model = native(); state = state_for(tmp_path, model)
    script = """
import json,os,signal,sys
from middleware.paid_admission import RunBudget,RunAdmission,fingerprint
b=RunBudget.model_validate_json(sys.argv[2])
a=RunAdmission(sys.argv[1],b,fingerprint(b.model_dump(mode='json')))
a.admit('killed',json.loads(sys.argv[3]))
if sys.argv[4]=='IN_FLIGHT': a.transition('killed','IN_FLIGHT')
os.kill(os.getpid(),signal.SIGKILL)
"""
    child = subprocess.run([sys.executable, "-c", script, str(state.store), state.admission.budget.model_dump_json(), json.dumps(request_identity(model)), stage])
    assert child.returncode == -9
    result = recover_usage(str(tmp_path / "run.json"), "run")["admission"]
    assert result["unresolvedAttempts"] == 1 and result["inputExposure"] == 1000
    assert result["attempts"][0]["state"] == stage and result["knownActualChargeNanoUSD"] == 0


def test_recovery_finishes_crash_between_usage_commit_and_settlement(tmp_path):
    model = native(); state = state_for(tmp_path, model)
    state.admission.admit("crashed-after-usage", request_identity(model))
    state.admission.transition("crashed-after-usage", "IN_FLIGHT")
    state.record(answer(), model, "crashed-after-usage")
    assert snapshot(state)["unresolvedAttempts"] == 1
    result = recover_usage(str(tmp_path / "run.json"), "run")
    assert result["modelCalls"] == 1 and result["admission"]["unresolvedAttempts"] == 0
    again = recover_usage(str(tmp_path / "run.json"), "run")
    assert result["admission"] == again["admission"]


def test_provider_bound_breach_is_terminal_without_refund(tmp_path):
    state = state_for(tmp_path)
    invoke(state)
    row = snapshot(state)["attempts"][0]
    state.admission.admit("breach", request_identity(native()))
    original = snapshot(state)["chargeExposureNanoUSD"]
    with pytest.raises(PaidAdmissionError, match="PROVIDER_BOUND_BREACH"):
        state.admission.settle("breach", {**json.loads(row["usage"]), "inputTokens": 1001})
    assert snapshot(state)["chargeExposureNanoUSD"] == original
    with pytest.raises(PaidAdmissionError, match="PROVIDER_BOUND_BREACH"): invoke(state)


def test_provider_overcharge_is_visible_even_when_it_breaks_the_contract(tmp_path):
    model = native(); policy = policy_for(model)
    state = state_for(tmp_path, model, maximum_charge_nano_usd=policy.exposure())
    state.admission.admit("provider-breach", request_identity(model))
    with pytest.raises(PaidAdmissionError, match="PROVIDER_BOUND_BREACH"):
        state.admission.settle("provider-breach", {"inputTokens": 1000, "cachedInputTokens": 1000,
            "cacheWriteTokens": 1000, "outputTokens": 262144, "reasoningTokens": 262144})
    result = snapshot(state)
    assert result["chargeExposureNanoUSD"] > policy.exposure()
    assert result["actualChargeNanoUSD"] is None
    assert result["terminalReason"] == "PROVIDER_BOUND_BREACH"


def test_legacy_journal_is_not_retroactively_called_bounded(tmp_path):
    state = LiveUsage("legacy", str(tmp_path / "legacy.json"))
    assert recover_usage(str(tmp_path / "legacy.json"), "legacy")["admission"]["state"] == "LEGACY_UNBOUNDED"
    state.record(answer(), native(), "legacy-call")
    budget = budget_for(native(), run_id="legacy")
    with pytest.raises(PaidAdmissionError, match="HISTORICAL_UNRESERVED_USAGE"):
        LiveUsage("legacy", str(tmp_path / "legacy.json"), budget=budget, budget_fingerprint=fingerprint(budget.model_dump(mode="json")))


def test_old_unsalted_policy_ledger_is_retained_without_repricing(tmp_path):
    model = native(); state = state_for(tmp_path, model)
    state.admission.admit("old-unanswered", request_identity(model))
    old = state.admission.budget.model_dump(mode="json")
    old["schema_version"] = 1
    old.pop("credential_salt")
    with sqlite3.connect(state.store) as db:
        db.execute("UPDATE inference_budgets SET envelope=?,fingerprint=? WHERE run_id=?", (json.dumps(old), fingerprint(old), state.run_id))
    before = state.store.read_bytes()
    recovered = recover_usage(str(tmp_path / "run.json"), "run")["admission"]
    assert recovered["state"] == "LEGACY_RESERVATIONS_RETAINED"
    assert recovered["unresolvedAttempts"] == 1 and recovered["chargeExposureNanoUSD"] > 0
    assert state.store.read_bytes() == before


def test_durability_commit_failure_prevents_handler(tmp_path, monkeypatch):
    state = state_for(tmp_path)
    real_connect = paid_admission._connect
    class FailingCommit:
        def __init__(self, connection): self.connection = connection
        def __getattr__(self, name): return getattr(self.connection, name)
        def __setattr__(self, name, value):
            if name == "connection": object.__setattr__(self, name, value)
            else: setattr(self.connection, name, value)
        def commit(self): raise sqlite3.OperationalError("offline forced fsync failure")
    monkeypatch.setattr(paid_admission, "_connect", lambda path: FailingCommit(real_connect(path)))
    seen = []
    with pytest.raises(PaidAdmissionError, match="DURABILITY"):
        invoke(state, handler=lambda _: seen.append(1))
    assert seen == [] and snapshot(state)["admittedAttempts"] == 0


def test_parallel_threads_cannot_over_admit_and_runs_are_isolated(tmp_path):
    model = native()
    state = state_for(tmp_path, model, maximum_calls=3)
    seen = []
    def attempt(_):
        try: invoke(state, model, lambda r: (seen.append(1), answer())[1])
        except PaidAdmissionError: pass
    with ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(attempt, range(12)))
    assert len(seen) == snapshot(state)["admittedAttempts"] == 3
    other = state_for(tmp_path, model, run_id="other", maximum_calls=1)
    invoke(other, model)
    assert snapshot(other)["admittedAttempts"] == 1


def _process_attempt(path, raw_budget, identity, attempt):
    budget = RunBudget.model_validate(raw_budget)
    admission = RunAdmission(path, budget, fingerprint(budget.model_dump(mode="json")))
    try: admission.admit(attempt, identity)
    except PaidAdmissionError: return False
    return True


def test_processes_cannot_race_past_shared_ceiling(tmp_path):
    model = native(); state = state_for(tmp_path, model, maximum_calls=2)
    with ProcessPoolExecutor(max_workers=3, mp_context=multiprocessing.get_context("spawn")) as pool:
        futures = [pool.submit(_process_attempt, str(state.store), state.admission.budget.model_dump(mode="json"), request_identity(model), str(i)) for i in range(6)]
        assert sum(f.result(timeout=45) for f in futures) == 2
    assert snapshot(state)["admittedAttempts"] == 2 and snapshot(state)["unresolvedAttempts"] == 2


@pytest.mark.asyncio
async def test_async_parallel_and_cancellation_preserve_shared_exposure(tmp_path):
    model = native(); state = state_for(tmp_path, model, maximum_calls=2)
    seen = []
    async def handler(request):
        seen.append(request)
        await asyncio.sleep(0)
        return answer()
    with activate_agent_run_state(state):
        results = await asyncio.gather(*(UsageMeteringMiddleware().awrap_model_call(req(model), handler) for _ in range(6)), return_exceptions=True)
    assert len(seen) == 2 and sum(isinstance(r, PaidAdmissionError) for r in results) == 4
    assert snapshot(state)["admittedAttempts"] == 2
    other = state_for(tmp_path, model, run_id="cancelled")
    async def cancelled(_): raise asyncio.CancelledError()
    with activate_agent_run_state(other), pytest.raises(asyncio.CancelledError):
        await UsageMeteringMiddleware().awrap_model_call(req(model), cancelled)
    assert snapshot(other)["unresolvedAttempts"] == 1


def test_retry_rotation_fallback_and_terminal_exhaustion_are_all_admitted(tmp_path, monkeypatch):
    from middleware import token_fallback
    primary, rotated, fallback = native(), native(key="offline-rotated-key"), native("fallback")
    state = state_for(tmp_path, primary, rotated, fallback, maximum_calls=3)
    monkeypatch.setattr(token_fallback, "provider_token_source", lambda p: ("MIRAI_API_KEY", ("offline-admission-key", "offline-rotated-key")) if p == "miraiapi" else None)
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    attempts = []
    class OfflineAuthError(Exception): status_code = 401
    class OfflineQuotaError(Exception): status_code = 402
    def raw(request):
        attempts.append(request_identity(request.model))
        if len(attempts) == 1: raise OfflineAuthError()
        if len(attempts) == 2: raise OfflineQuotaError()
        return answer()
    meter, rotate, providers = UsageMeteringMiddleware(), TokenFallbackMiddleware(), ProviderFallbackMiddleware()
    with activate_agent_run_state(state):
        providers.wrap_model_call(req(primary), lambda r: rotate.wrap_model_call(r, lambda rr: meter.wrap_model_call(rr, raw)))
        with pytest.raises(PaidAdmissionError, match="CALL_LIMIT"):
            providers.wrap_model_call(req(primary), lambda r: rotate.wrap_model_call(r, lambda rr: meter.wrap_model_call(rr, raw)))
    assert len(attempts) == 3 and snapshot(state)["unresolvedAttempts"] == 2
    assert [a["provider"] for a in attempts] == ["miraiapi", "miraiapi", "inception"]
    error = PaidAdmissionError("CALL_LIMIT", "run")
    error.__cause__ = OfflineAuthError()
    assert not provider_fallback_failure(error) and not retry_model_error(error)


def test_real_governed_parent_author_and_internal_runnable_share_budget(tmp_path, monkeypatch):
    from langchain_anthropic import ChatAnthropic
    primary, author = native(), native("primary")
    primary.streaming = author.streaming = False
    state = state_for(tmp_path, primary, maximum_calls=3)
    seen = []
    def generate(self, *args, **kwargs):
        seen.append(model_route_config(self).route_id)
        return ChatResult(generations=[ChatGeneration(message=answer().result[0])])
    monkeypatch.setattr(ChatAnthropic, "_generate", generate)
    with activate_agent_run_state(state):
        for role, model in [("rule-set-preparation", primary), ("claim-author", author)]:
            create_agent(model, tools=[], middleware=[AgentRoleMiddleware(role), *MODEL_GOVERNANCE_MIDDLEWARE]).invoke({"messages": [HumanMessage("offline")]})
        _GovernedInternalModelRunnable(primary, role="rule-set-preparation", operation_type="SUMMARIZATION").invoke("offline")
        with pytest.raises(PaidAdmissionError, match="CALL_LIMIT"):
            _GovernedInternalModelRunnable(primary, role="rule-set-preparation", operation_type="SOURCE_READER").invoke("offline")
    assert seen == ["primary", "primary", "primary"]
    assert {json.loads(r["identity"])["agent_role"] for r in snapshot(state)["attempts"]} == {"rule-set-preparation", "claim-author"}
    serialized = json.dumps(snapshot(state))
    assert "PRIVATE_PROMPT" not in serialized and "CONFIDENTIAL_RESPONSE" not in serialized and "offline-admission-key" not in serialized




def test_application_retry_has_a_new_physical_reservation(tmp_path, monkeypatch):
    from langchain_anthropic import ChatAnthropic
    model = native(); model.streaming = False
    state = state_for(tmp_path, model, maximum_calls=2)
    seen = []
    def generate(self, *args, **kwargs):
        seen.append(1)
        if len(seen) == 1: raise TimeoutError("offline timeout")
        return ChatResult(generations=[ChatGeneration(message=answer().result[0])])
    monkeypatch.setattr(ChatAnthropic, "_generate", generate)
    with activate_agent_run_state(state):
        create_agent(model, tools=[], middleware=[ModelRetryMiddleware(max_retries=1, initial_delay=0, retry_on=retry_model_error), UsageMeteringMiddleware()]).invoke({"messages": [HumanMessage("offline")]})
    assert len(seen) == 2 and snapshot(state)["admittedAttempts"] == 2 and snapshot(state)["unresolvedAttempts"] == 1


@pytest.mark.parametrize("route", ["primary", "fallback", "fallback-01", "fallback-02", "fallback", "fallback-02"])
def test_every_configured_route_uses_single_attempt_and_native_output_cap(tmp_path, route):
    model = native(route); state = state_for(tmp_path, model)
    seen = []
    invoke(state, model, lambda r: (seen.append(r.model_settings), answer())[1])
    assert len(seen) == 1
    assert snapshot(state)["chargeExposureNanoUSD"] == policy_for(model).charge(10, 2, 1, 3, 1)
    if model_route_config(model).protocol == "google_genai":
        assert seen[0]["max_retries"] == 1 and seen[0]["max_output_tokens"] == 65536
        prepared = model._prepare_request([HumanMessage("offline")], **seen[0])["config"]
        assert prepared.http_options.retry_options.attempts == 1
        assert prepared.automatic_function_calling.disable
    else:
        assert seen[0]["max_tokens"] > 0


def test_openai_gateway_normalization_counts_cache_buckets_once():
    model = native("fallback")
    usage = usage_metering.extract_provider_usage(answer(), model)
    assert (usage["inputTokens"], usage["cachedInputTokens"], usage["cacheWriteTokens"]) == ("10", "2", "1")
    assert sum(int(usage[k]) for k in ["inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens"]) == int(usage["totalTokens"])


@pytest.mark.parametrize("route", ["primary", "fallback", "fallback-01"])
@pytest.mark.parametrize("asynchronous", [False, True])
def test_native_sdk_error_sends_exactly_one_mock_http_request(tmp_path, route, asynchronous):
    from google import genai
    from google.genai import types
    model = native(route)
    requests = []
    protocol = model_route_config(model).protocol
    # Anthropic 1.x uses httpx2; the locked 0.x SDK uses httpx. Exercise the
    # actual SDK transport family rather than substituting an incompatible URL type.
    if protocol == "anthropic":
        import anthropic._base_client as anthropic_client
        sdk_httpx = getattr(anthropic_client, "httpx2", None) or getattr(anthropic_client, "httpx")
    else:
        sdk_httpx = httpx
    def http_handler(request):
        requests.append(json.loads(request.content))
        return sdk_httpx.Response(503, json={"error": {"code": 503, "message": "offline server failure", "type": "api_error"}})
    transport = sdk_httpx.MockTransport(http_handler)
    clients = []
    if protocol == "anthropic":
        sync, async_ = sdk_httpx.Client(transport=transport), sdk_httpx.AsyncClient(transport=transport)
        model._client._client, model._async_client._client = sync, async_
        clients = [sync, async_]
    elif protocol == "openai":
        sync, async_ = httpx.Client(transport=transport), httpx.AsyncClient(transport=transport)
        model.root_client._client, model.root_async_client._client = sync, async_
        clients = [sync, async_]
    else:
        model.client = genai.Client(api_key="offline-admission-key", http_options=types.HttpOptions(
            retry_options=types.HttpRetryOptions(attempts=1), client_args={"transport": transport},
            async_client_args={"transport": transport}))
    state = state_for(tmp_path, model)
    async def execute():
        async def handler(request): return await request.model.ainvoke(request.messages, **request.model_settings)
        with activate_agent_run_state(state):
            with pytest.raises(Exception) as captured: await UsageMeteringMiddleware().awrap_model_call(req(model), handler)
        return captured.value
    try:
        if asynchronous: error = asyncio.run(execute())
        else:
            with pytest.raises(Exception) as captured:
                invoke(state, model, lambda r: r.model.invoke(r.messages, **r.model_settings))
            error = captured.value
        assert len(requests) == 1, repr(error)
        payload = requests[0]
        cap = payload.get("max_tokens") or payload.get("max_completion_tokens") or payload.get("generationConfig", {}).get("maxOutputTokens")
        assert cap == usage_metering.output_token_limit(model)
        assert snapshot(state)["admittedAttempts"] == 1 and snapshot(state)["unresolvedAttempts"] == 1
    finally:
        if clients:
            clients[0].close(); asyncio.run(clients[1].aclose())
        else:
            model.client.close(); asyncio.run(model.client.aio.aclose())


@pytest.mark.asyncio
async def test_async_exhaustion_does_not_rotate_or_fallback(tmp_path, monkeypatch):
    from middleware import token_fallback
    primary, rotated = native(), native(key="offline-rotated-key")
    state = state_for(tmp_path, primary, rotated, maximum_calls=1)
    monkeypatch.setattr(token_fallback, "provider_token_source", lambda p:
        ("MIRAI_API_KEY", ("offline-admission-key", "offline-rotated-key")) if p == "miraiapi" else None)
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    seen = []
    async def raw(request):
        seen.append(request_identity(request.model))
        raise TimeoutError("offline unanswered")
    meter, rotate = UsageMeteringMiddleware(), TokenFallbackMiddleware()
    async def handler(r):
        async def metered(rr): return await meter.awrap_model_call(rr, raw)
        return await rotate.awrap_model_call(r, metered)
    with activate_agent_run_state(state), pytest.raises(PaidAdmissionError, match="CALL_LIMIT"):
        await ProviderFallbackMiddleware().awrap_model_call(req(primary), handler)
    assert len(seen) == 1 and snapshot(state)["unresolvedAttempts"] == 1


@pytest.mark.parametrize("configured", [False, True])
def test_live_entrypoint_rejects_absent_or_wrong_candidate_budget_before_models(tmp_path, monkeypatch, configured):
    from vertical import live_preparation
    monkeypatch.setattr(live_preparation, "_load_llm_env", lambda: None)
    monkeypatch.setattr(sys, "argv", ["live_preparation.py", "http://127.0.0.1:1", "offline", "run", str(tmp_path / "usage.json")])
    monkeypatch.delenv("LCSP_LIVE_BUDGET_FILE", raising=False)
    monkeypatch.delenv("LCSP_LIVE_BUDGET_SHA256", raising=False)
    if configured:
        budget = budget_for(native())
        file = tmp_path / "budget.json"; file.write_text(budget.model_dump_json())
        monkeypatch.setenv("LCSP_LIVE_BUDGET_FILE", str(file))
        monkeypatch.setenv("LCSP_LIVE_BUDGET_SHA256", fingerprint(budget.model_dump(mode="json")))
    import model_policy
    monkeypatch.setattr(model_policy, "resolve_agent_model", lambda *_: (_ for _ in ()).throw(AssertionError("No model may be constructed")))
    with pytest.raises(PaidAdmissionError, match="CANDIDATE_CHANGED" if configured else "MISSING_RUN_BUDGET"):
        live_preparation.main()


def test_bounded_offline_rehearsal(tmp_path):
    from vertical.bounded_admission_rehearsal import main
    result = main(str(tmp_path / "rehearsal"))
    assert result["physicalOfflineHandlerCalls"] == 7 and result["noDispatchAfterDenial"]
    assert result["admission"]["unresolvedAttempts"] == 3
    assert result["admission"]["actualChargeNanoUSD"] is None


def test_unrestricted_authorization_keeps_accounting_unknown_usage_and_provider_constraints(tmp_path):
    from middleware.paid_admission import TokenPolicy, UnrestrictedRunBudget, parse_run_budget

    model = native()
    policy = policy_for(model)
    token_policy = TokenPolicy.model_validate({key: getattr(policy, key) for key in TokenPolicy.model_fields})
    raw = budget_for(model).model_dump()
    raw.update(schema_version=4, mode="UNRESTRICTED", paid_inference_approved=True,
               approval_reference="Direct user authorization in conversation: unrestricted LCSP acceptance",
               expires_at=None, maximum_calls=None, maximum_input_tokens=None, maximum_output_tokens=None,
               policies=[token_policy.model_dump()])
    del raw["maximum_charge_nano_usd"]
    budget = parse_run_budget(raw)
    assert isinstance(budget, UnrestrictedRunBudget)
    admission = RunAdmission(tmp_path / "usage.sqlite3", budget, fingerprint(budget.model_dump(mode="json")))
    for index in range(25):
        attempt = f"attempt-{index}"
        admission.admit(attempt, request_identity(model))
        admission.transition(attempt, "IN_FLIGHT")
        if index:
            admission.settle(attempt, {"inputTokensIncludingCache": 20, "outputTokens": 10})
        else:
            admission.settle(attempt, None)
    receipt = recover_admission(admission.path, budget.run_id)
    assert receipt["state"] == "UNRESTRICTED" and receipt["admittedAttempts"] == 25
    assert receipt["unresolvedAttempts"] == 1 and receipt["actualChargeNanoUSD"] is None
    with pytest.raises(PaidAdmissionError, match="UNKNOWN_TOKEN_POLICY"):
        admission.admit("unknown-route", {**request_identity(model), "route_id": "unapproved"})
    assert recover_admission(admission.path, budget.run_id)["state"] == "STOPPED"


@pytest.mark.parametrize("change", [{"paid_inference_approved": False}, {"maximum_calls": 1}, {"mode": "BOUNDED"}, {"approval_reference": ""}])
def test_unrestricted_schema_requires_explicit_authorization_and_cannot_hide_finite_caps(change):
    from middleware.paid_admission import UnrestrictedRunBudget
    from pydantic import ValidationError

    raw = budget_for(native()).model_dump()
    raw.update(schema_version=4, mode="UNRESTRICTED", paid_inference_approved=True,
               approval_reference="Explicit user conversation authorization", expires_at=None,
               maximum_calls=None, maximum_input_tokens=None, maximum_output_tokens=None, policies=[])
    del raw["maximum_charge_nano_usd"]
    with pytest.raises(ValidationError):
        UnrestrictedRunBudget.model_validate({**raw, **change})
