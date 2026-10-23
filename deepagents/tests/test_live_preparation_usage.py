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
from vertical.live_preparation import LiveUsage, recover_usage


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


def test_real_producer_and_independent_auditor_share_the_journal(tmp_path, monkeypatch):
    from rule_set_preparation.semantic_audit import SemanticAuditor, audit_input
    from semantic_verifier_fixture import model_response
    from structural_semantic_fixture import StructuralFixtureAuditor
    from test_semantic_auditor import example
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel

    monkeypatch.setenv("LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY", "7c" * 32)
    source, graph, node = example()
    value = audit_input(source, graph, node, 1)
    verdict = StructuralFixtureAuditor().audit(value)
    wire = model_response(verdict, value=value)
    # Single-pass schema also requires source-unit omissions, even when empty.
    wire["omissions"] = []
    producer_message = AIMessage(content="producer", usage_metadata={"input_tokens": 11, "output_tokens": 2, "total_tokens": 13})
    auditor_message = AIMessage(content="", tool_calls=[{"name": "SourceSemanticAuditVerdict", "args": wire, "id": "audit"}],
                                usage_metadata={"input_tokens": 17, "output_tokens": 4, "total_tokens": 21})
    producer = RuleSetPreparationScriptedModel(model_name="producer-usage", responses=[producer_message])
    auditor = RuleSetPreparationScriptedModel(model_name="auditor-usage", responses=[auditor_message])
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda *_: None)  # provider-free fixture identities
    import model_policy
    monkeypatch.setattr(model_policy, "resolve_agent_model", lambda role: auditor if role == "legal-semantic-auditor" else producer)
    out = str(tmp_path / "usage.json")
    with activate_agent_run_state(LiveUsage("run", out)):
        create_agent(producer, tools=[], middleware=[AgentRoleMiddleware("rule-set-preparation"), *MODEL_GOVERNANCE_MIDDLEWARE]).invoke({"messages": [HumanMessage("fixture")]})
        assert recover_usage(out, "run")["modelCalls"] == 1
        SemanticAuditor(single_pass=True).audit(value)
    summary = recover_usage(out, "run")
    assert summary["modelCalls"] == 2
    assert summary["inputTokens"] == 28 and summary["outputTokens"] == 6
    assert {r["agentRole"] for r in summary["invocations"]} == {"rule-set-preparation", "legal-semantic-auditor"}
    assert {r["model"] for r in summary["invocations"]} == {"producer-usage", "auditor-usage"}


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
for role, invocation in [("rule-set-preparation", "producer"), ("legal-semantic-auditor", "auditor")]:
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
        assert {r["agentRole"] for r in summary["invocations"]} == {"rule-set-preparation", "legal-semantic-auditor"}
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=5)
