"""Provider-free evidence tests; these do not establish legal-model acceptance."""
import json
import os
import signal
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain.agents import create_agent
from langchain.agents.middleware import ModelResponse
from langchain_core.exceptions import ModelError
from langchain_core.messages import AIMessage, HumanMessage

from middleware import usage_metering, usage_recovery
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.usage_metering import AgentRoleMiddleware, activate_agent_run_state
from vertical.live_preparation import LiveUsage, recover_usage, recover_cumulative_usage


def response(input_tokens=10, output_tokens=3):
    return SimpleNamespace(usage_metadata={
        "input_tokens": input_tokens, "output_tokens": output_tokens,
        "input_token_details": {"cache_read": 2, "cache_creation": 1},
    }, response_metadata={"id": "provider-response"})


MODEL = SimpleNamespace(provider="apx", protocol="anthropic", model_name="usage-model")


def test_idempotent_concurrent_recovery_retains_cache_and_run_identity(tmp_path, monkeypatch):
    out = str(tmp_path / "usage.json")
    state = LiveUsage("run-a", out)
    monkeypatch.setattr(usage_recovery, "MAX_PENDING_ROWS", 1)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda i: state.record(response(), MODEL, f"inv-{i % 3}"), range(18)))
    first = recover_usage(out, "run-a")
    again = recover_usage(out, "run-a")
    assert first["invocations"] == again["invocations"]
    assert first["modelCalls"] == 3
    assert (first["inputTokens"], first["cachedInputTokens"], first["cacheWriteTokens"], first["outputTokens"]) == (21, 6, 3, 9)
    assert {r["runId"] for r in first["invocations"]} == {"run-a"}
    assert all(r["usage"]["providerResponseId"] == "provider-response" for r in first["invocations"])
    assert usage_recovery.drain(state.store, object()) == 0
    assert recover_usage(out, "run-a")["modelCalls"] == 3
    with pytest.raises(ValueError, match="requested run"):
        recover_usage(out, "other-run")
    with pytest.raises(ValueError, match="requested run"):
        LiveUsage("other-run", out)
    assert recover_usage(out, "run-a")["modelCalls"] == 3


def test_missing_or_partial_usage_is_not_invented(tmp_path):
    out = str(tmp_path / "usage.json")
    assert recover_usage(out, "run")["modelCalls"] is None
    state = LiveUsage("run", out)
    state.record(response(), MODEL, "known")
    state.record(SimpleNamespace(usage_metadata={"output_tokens": 5}), MODEL, "partial")
    state.record(SimpleNamespace(), MODEL, "unknown")
    summary = recover_usage(out, "run")
    assert summary["accountingState"] == "MISSING_PROVIDER_USAGE"
    assert summary["modelCalls"] == 3 and summary["missingUsageCalls"] == 2
    assert summary["inputTokens"] is None and summary["outputTokens"] is None
    assert summary["knownInputTokens"] == 7 and summary["knownOutputTokens"] == 8
    assert summary["cachedInputTokens"] is None and summary["knownCachedInputTokens"] == 2
    assert summary["invocations"][1]["reportedUsage"] == {"output_tokens": 5}
    assert summary["invocations"][2]["usage"] is None


def test_unanswered_attempt_does_not_promote_response_subtotals_to_run_totals(tmp_path):
    out = str(tmp_path / "usage.json")
    state = LiveUsage("run", out)
    state.record(response(), MODEL, "answered")
    usage_recovery.record_usage_evidence(state.store, "answered", {
        "runId": "run", "event": "MODEL_ATTEMPT", "invocationId": "answered",
        "attemptStatus": "COMPLETED", "provider": "APX", "model": "usage-model",
        "agentRole": "rule-set-preparation",
    })
    usage_recovery.record_usage_evidence(state.store, "unanswered", {
        "runId": "run", "event": "MODEL_ATTEMPT", "invocationId": "unanswered",
        "attemptStatus": "STARTED", "provider": "APX", "model": "usage-model",
        "agentRole": "rule-set-preparation",
    })
    summary = recover_usage(out, "run")
    assert summary["accountingState"] == "MISSING_PROVIDER_USAGE"
    assert (summary["physicalAttempts"], summary["successfulResponses"], summary["unresolvedAttempts"]) == (2, 1, 1)
    assert summary["knownInputTokens"] == 7 and summary["knownOutputTokens"] == 3
    for key in ("inputTokens", "inputTokensIncludingCache", "outputTokens", "cachedInputTokens", "cacheWriteTokens"):
        assert summary[key] is None, key


def test_24_attempt_interruption_recovery_keeps_unknown_totals(tmp_path):
    out = str(tmp_path / "recovered.json")
    run_id = "interrupted-offline-regression"
    state = LiveUsage(run_id, out)
    for index in range(24):
        invocation = f"attempt-{index}"
        if index < 23:
            state.record(response(), MODEL, invocation)
        usage_recovery.record_usage_evidence(state.store, invocation, {
            "runId": run_id, "event": "MODEL_ATTEMPT", "invocationId": invocation,
            "attemptStatus": "COMPLETED" if index < 23 else "STARTED", "provider": "APX", "model": "usage-model",
            "agentRole": "rule-set-preparation",
        })
    first = recover_usage(out, run_id)
    again = recover_usage(out, run_id)
    assert (first["physicalAttempts"], first["successfulResponses"], first["unresolvedAttempts"]) == (24, 23, 1)
    assert first["knownInputTokensIncludingCache"] == 23 * 10
    assert first["knownOutputTokens"] == 23 * 3
    assert first["inputTokensIncludingCache"] is first["outputTokens"] is None
    assert first["invocations"] == again["invocations"] and first["admission"] == again["admission"]




@pytest.mark.parametrize("fallback_succeeds", [False, True])
def test_rejected_answer_is_committed_before_fallback_or_terminal_failure(tmp_path, monkeypatch, fallback_succeeds):
    from middleware.failure_policy import StructuredOutputRejected
    from middleware.provider_fallback import ProviderFallbackMiddleware
    from test_provider_fallback import _FakeModel, _FakeRequest, _install_fallback_models, _routes

    _routes(monkeypatch, "apx", "google_genai")
    monkeypatch.setenv("GOOGLE_API_KEY", "offline-fixture-key")
    _install_fallback_models(monkeypatch)
    monkeypatch.setattr(usage_metering.UsageMeteringMiddleware, "_prepare", lambda self, request: (request, request.model))
    meter = usage_metering.UsageMeteringMiddleware()
    out = str(tmp_path / "usage.json")
    attempts = []
    def raw(request):
        attempts.append(request.model.provider)
        if request.model.provider == "google_genai" and not fallback_succeeds:
            raise StructuredOutputRejected("fixture terminal fallback failure")
        return ModelResponse(result=[AIMessage(content="fixture", usage_metadata={"input_tokens": 5, "output_tokens": 2, "total_tokens": 7})])
    def checked(request):
        answer = meter.wrap_model_call(request, raw)
        if request.model.provider == "apx":
            raise StructuredOutputRejected("fixture rejected primary answer")
        return answer
    with activate_agent_run_state(LiveUsage("run", out)):
        if fallback_succeeds:
            ProviderFallbackMiddleware().wrap_model_call(_FakeRequest(_FakeModel("apx")), checked)
        else:
            with pytest.raises(StructuredOutputRejected):
                ProviderFallbackMiddleware().wrap_model_call(_FakeRequest(_FakeModel("apx")), checked)
    summary = recover_usage(out, "run")
    assert attempts == ["apx", "google_genai"]
    assert summary["modelCalls"] == (2 if fallback_succeeds else 1)
    assert summary["inputTokens"] is None
    assert summary["inputTokensIncludingCache"] == (10 if fallback_succeeds else None)
    assert summary["knownInputTokensIncludingCache"] == (10 if fallback_succeeds else 5)
    assert summary["unresolvedAttempts"] == (0 if fallback_succeeds else 1)
    assert [r["provider"] for r in summary["invocations"]] == (["APX", "GOOGLE_GENAI"] if fallback_succeeds else ["APX"])


def test_store_failure_stops_without_model_retry(tmp_path, monkeypatch):
    from middleware.failure_policy import retry_model_error
    from middleware.provider_fallback import provider_fallback_failure
    state = LiveUsage("run", str(tmp_path / "usage.json"))
    monkeypatch.setattr("vertical.live_preparation.record_usage_evidence", lambda *_: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(ModelError, match="Durable live usage commit failed") as failure:
        state.record(response(), MODEL, "answered")
    assert not retry_model_error(failure.value)
    assert not provider_fallback_failure(failure.value)


def test_same_provider_resampling_keeps_usage_for_rejected_answer(tmp_path, monkeypatch):
    from langchain.agents.middleware import ModelRetryMiddleware
    from langchain_core.tools import tool
    from middleware.failure_policy import retry_model_error
    from middleware.model_governance import StopSchemaRepairMiddleware
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel

    @tool
    def fixture_tool(number: int) -> str:
        """Return the supplied integer as text for the provider-free resampling regression."""
        return str(number)

    rejected = AIMessage(content="", tool_calls=[{"name": "fixture_tool", "args": {"number": "invalid"}, "id": "rejected"}],
                         usage_metadata={"input_tokens": 4, "output_tokens": 2, "total_tokens": 6})
    accepted = AIMessage(content="done", usage_metadata={"input_tokens": 6, "output_tokens": 3, "total_tokens": 9})
    model = RuleSetPreparationScriptedModel(responses=[rejected, accepted])
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda *_: None)
    out = str(tmp_path / "usage.json")
    with activate_agent_run_state(LiveUsage("run", out)):
        create_agent(model, tools=[fixture_tool], middleware=[
            AgentRoleMiddleware("rule-set-preparation"),
            ModelRetryMiddleware(max_retries=1, initial_delay=0, retry_on=retry_model_error),
            StopSchemaRepairMiddleware(), usage_metering.UsageMeteringMiddleware(),
        ]).invoke({"messages": [HumanMessage("fixture")]})
    summary = recover_usage(out, "run")
    assert summary["modelCalls"] == 2 and summary["inputTokens"] == 10 and summary["outputTokens"] == 5
    assert len({r["invocationId"] for r in summary["invocations"]}) == 2


@pytest.mark.parametrize("termination", ["crash", "terminate", "kill"])
def test_completed_records_survive_process_interruption(tmp_path, termination):
    out = str(tmp_path / "usage.json")
    ready = tmp_path / "ready"
    code = '''
import os, sys, time
from pathlib import Path
from types import SimpleNamespace
from vertical.live_preparation import LiveUsage
state = LiveUsage("interrupted", sys.argv[1])
model = SimpleNamespace(provider="apx", protocol="anthropic", model_name="fixture")
for role, invocation in [("rule-set-preparation", "producer"), ("claim-author", "author")]:
    state.record(SimpleNamespace(usage_metadata={"input_tokens": 7, "output_tokens": 3}), model, invocation, agent_role=role)
Path(sys.argv[2]).touch()
if sys.argv[3] == "crash": os._exit(23)
time.sleep(30)
'''
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(Path(__file__).parents[1]), str(Path(__file__).parent)])}
    child = subprocess.Popen([sys.executable, "-c", code, out, str(ready), termination], env=env, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 15
        while not ready.exists() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        assert ready.exists(), child.communicate(timeout=1)[1].decode()
        if termination != "crash":
            child.send_signal(signal.SIGTERM if termination == "terminate" else signal.SIGKILL)
        child.wait(timeout=5)
        assert not Path(out).exists()  # no orderly-finally summary was needed
        cli = Path(__file__).parent / "vertical/live_preparation.py"
        recovered = subprocess.check_output([sys.executable, str(cli), "--recover-usage", out, "interrupted"], env=env, text=True)
        summary = json.loads(recovered.strip().splitlines()[-1])
        assert summary["modelCalls"] == 2 and summary["inputTokens"] is None and summary["inputTokensIncludingCache"] == 14 and summary["outputTokens"] == 6
        assert {r["agentRole"] for r in summary["invocations"]} == {"rule-set-preparation", "claim-author"}
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=5)


def test_usage_accounting_cross_checks_totals_across_all_resumes_without_resetting_cumulative_budget(tmp_path):
    from middleware.paid_admission import TokenRunBudget, TokenPolicy, RunAdmission, fingerprint, PaidAdmissionError, request_identity

    # PART 1: Multi-session resumption on the same persistent SQLite store
    same_store_out = str(tmp_path / "same_store_usage.json")
    run_id = "run-same-store-resumed"

    # Session 1: 3 calls
    session1 = LiveUsage(run_id, same_store_out)
    session1.record(response(10, 3), MODEL, "sess1-call1")
    session1.record(response(15, 5), MODEL, "sess1-call2")
    session1.record(response(20, 6), MODEL, "sess1-call3")
    rec1 = recover_usage(same_store_out, run_id)
    assert rec1["modelCalls"] == 3
    # Canonical input tokens exclude cache_read (2) and cache_creation (1): (10-3) + (15-3) + (20-3) = 7 + 12 + 17 = 36
    assert rec1["inputTokens"] == (10 - 3) + (15 - 3) + (20 - 3)
    assert rec1["outputTokens"] == 3 + 5 + 6  # 14

    # Session 2: Resumes on the SAME persistent SQLite store with 2 more calls
    session2 = LiveUsage(run_id, same_store_out)
    session2.record(response(12, 4), MODEL, "sess2-call1")
    session2.record(response(18, 7), MODEL, "sess2-call2")
    rec2 = recover_usage(same_store_out, run_id)
    assert rec2["modelCalls"] == 5
    assert rec2["inputTokens"] == 36 + (12 - 3) + (18 - 3)  # 36 + 9 + 15 = 60
    assert rec2["outputTokens"] == 14 + 4 + 7  # 25

    # Session 3: Resumes again with 1 call
    session3 = LiveUsage(run_id, same_store_out)
    session3.record(response(30, 10), MODEL, "sess3-call1")
    rec3 = recover_usage(same_store_out, run_id)
    assert rec3["modelCalls"] == 6
    assert rec3["inputTokens"] == 60 + (30 - 3)  # 60 + 27 = 87
    assert rec3["outputTokens"] == 25 + 10  # 35
    assert len({inv["invocationId"] for inv in rec3["invocations"]}) == 6

    # Cumulative budget enforcement across resume boundaries:
    # A bounded admission with maximum 2 calls must admit call 1 and call 2, then reject call 3 even across process re-instantiation
    from test_paid_admission import native, policy_for, budget_for
    from middleware.paid_admission import request_identity

    model_admit = native()
    original_budget = budget_for(model_admit)
    p_dict = {k: v for k, v in policy_for(model_admit).model_dump().items() if k in TokenPolicy.model_fields}
    policy = TokenPolicy.model_validate(p_dict)
    b_values = {k: v for k, v in original_budget.model_dump().items() if k in TokenRunBudget.model_fields}
    b_values.update(schema_version=3, policies=(policy,), maximum_calls=2)
    budget = TokenRunBudget.model_validate(b_values)
    b_fp = fingerprint(budget.model_dump(mode="json"))

    budget_store = tmp_path / "budget_bound.sqlite3"
    adm_a = RunAdmission(budget_store, budget, b_fp)
    req_id = request_identity(model_admit, budget.credential_salt)
    adm_a.admit("att-1", req_id)

    # Session B resumes on same budget store
    adm_b = RunAdmission(budget_store, budget, b_fp)
    adm_b.admit("att-2", req_id)

    # Attempt 3 must fail because maximum_calls=2 is cumulative and was NOT reset on resume
    with pytest.raises(PaidAdmissionError) as err:
        adm_b.admit("att-3", req_id)
    assert "CALL_LIMIT" in str(err.value)

    # PART 2: Multi-store reconciliation across distinct session SQLite files
    multi_dir = tmp_path / "multi_sessions"
    multi_dir.mkdir()
    multi_run = "run-multi-store-resumed"

    s1_out = str(multi_dir / "usage-session1.json")
    u1 = LiveUsage(multi_run, s1_out)
    u1.record(response(20, 5), MODEL, "multi-sess1-call1")
    u1.record(response(25, 6), MODEL, "multi-sess1-call2")

    s2_out = str(multi_dir / "usage-session2.json")
    u2 = LiveUsage(multi_run, s2_out)
    u2.record(response(30, 8), MODEL, "multi-sess2-call1")

    s3_out = str(multi_dir / "usage-session3.json")
    u3 = LiveUsage(multi_run, s3_out)
    u3.record(response(15, 3), MODEL, "multi-sess3-call1")
    u3.record(response(40, 12), MODEL, "multi-sess3-call2")

    # Reconcile all stores in directory
    summary_dir = recover_cumulative_usage(multi_dir, multi_run)
    assert summary_dir["runId"] == multi_run
    assert summary_dir["sessionCount"] == 3
    assert summary_dir["modelCalls"] == 5
    expected_in = (20 - 3) + (25 - 3) + (30 - 3) + (15 - 3) + (40 - 3)  # 17 + 22 + 27 + 12 + 37 = 115
    expected_out = 5 + 6 + 8 + 3 + 12  # 34
    assert summary_dir["inputTokens"] == expected_in
    assert summary_dir["outputTokens"] == expected_out
    assert summary_dir["accountingState"] == "COMPLETE"
    assert len({inv["invocationId"] for inv in summary_dir["invocations"]}) == 5

    # Reconcile explicit list of stores with write_out file
    summary_file = multi_dir / "cumulative-summary.json"
    summary_list = recover_cumulative_usage(
        [Path(s1_out + ".sqlite3"), Path(s2_out + ".sqlite3"), Path(s3_out + ".sqlite3")],
        multi_run,
        write_out=summary_file,
    )
    assert summary_list["modelCalls"] == 5
    assert summary_file.exists()
    written = json.loads(summary_file.read_text(encoding="utf-8"))
    assert written["modelCalls"] == 5
    assert written["inputTokens"] == expected_in

