"""Real configured governance with offline handlers; never real billing or semantic acceptance.

usage: PYTHONPATH=deepagents:deepagents/tests python this_file.py <new-output-directory>
"""
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading

import httpx
import pytest
from langchain.agents import create_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from middleware.failure_policy import PaidAdmissionError
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE, _GovernedInternalModelRunnable
from middleware import token_fallback
from middleware.usage_metering import AgentRoleMiddleware, activate_agent_run_state, active_agent_role
from middleware.paid_admission import fingerprint, recover_admission, request_identity
from model_policy import DEFAULT_ROUTES_FILE, load_model_routes
from test_paid_admission import native, answer, budget_for
from vertical.live_preparation import LiveUsage, recover_usage


def main(output: str) -> dict:
    target = Path(output)
    target.mkdir(parents=True, exist_ok=False)
    dispatches, lock = [], threading.Lock()
    class OfflineQuotaError(Exception):
        status_code = 402
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("LCSP_MODEL_ROUTES_FILE", str(DEFAULT_ROUTES_FILE))
        for key in ["MIRAI_API_KEY", "INCEPTION_API_KEY", "GOOGLE_API_KEY", "APX_API_KEY"]:
            patch.setenv(key, "offline-admission-key")
        load_model_routes.cache_clear()
        def no_network(*args, **kwargs):
            raise AssertionError("Rehearsal cannot reach a provider endpoint")
        patch.setattr(httpx.HTTPTransport, "handle_request", no_network)
        patch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", no_network)
        primary, rotated, auditor = native(), native(key="offline-rotated-key"), native("semantic-primary")
        models = [primary, rotated, auditor, native("semantic-primary", key="offline-rotated-key"),
                  native("fallback"), native("fallback-01"), native("fallback-02"), native("semantic-final")]
        candidate = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        budget = budget_for(*models, run_id="offline-admission-rehearsal", maximum_calls=7, candidate_sha=candidate)
        budget_file = target / "offline-budget.json"
        budget_file.write_text(budget.model_dump_json(indent=2) + "\n")
        state = LiveUsage(budget.run_id, str(target / "usage.json"), budget=budget,
                          budget_fingerprint=fingerprint(budget.model_dump(mode="json")), bounded=True)
        patch.setattr(token_fallback, "provider_token_source", lambda p:
            ("MIRAI_API_KEY", ("offline-admission-key", "offline-rotated-key")) if p == "miraiapi" else None)
        token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
        def dispatch(model, *args, **kwargs):
            with lock:
                number = len(dispatches) + 1
                dispatches.append({"number": number, "role": active_agent_role(), **request_identity(model)})
            if number == 1: raise RuntimeError("offline application retry")
            if number == 2: raise TimeoutError("offline unanswered timeout")
            if number == 3: raise OfflineQuotaError("offline fallback")
            return ChatResult(generations=[ChatGeneration(message=answer().result[0])])
        # Provider edge only. LangChain's actual middleware composer, model retry,
        # credential rotation, route fallback and innermost metering remain real.
        patch.setattr(BaseChatModel, "_generate_with_cache", dispatch)
        with activate_agent_run_state(state):
            for role, model in [("rule-set-preparation", primary), ("legal-semantic-auditor", auditor)]:
                create_agent(model, tools=[], middleware=[AgentRoleMiddleware(role), *MODEL_GOVERNANCE_MIDDLEWARE]).invoke({"messages": [HumanMessage("offline fixture")]})
            summary = _GovernedInternalModelRunnable(primary, role="rule-set-preparation", operation_type="SUMMARIZATION")
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(copy_context().run, summary.invoke, "offline summary") for _ in range(2)]
                for future in futures: future.result()
            before = len(dispatches)
            try: summary.invoke("offline denied")
            except PaidAdmissionError as error: denial = error.reason
            else: raise AssertionError("Exhaustion must terminate")
            assert len(dispatches) == before == 7 and denial == "CALL_LIMIT"
        recovered = recover_usage(str(target / "usage.json"), budget.run_id)
        ledger = recover_admission(state.store, budget.run_id)
        assert ledger == recovered["admission"]
        assert ledger["admittedAttempts"] == 7 and ledger["unresolvedAttempts"] == 3
        assert recovered["modelCalls"] == 4
        assert {r["role"] for r in dispatches} == {"rule-set-preparation", "legal-semantic-auditor"}
        with sqlite3.connect(state.store) as db:
            assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert ledger["inputExposure"] <= budget.maximum_input_tokens
        assert ledger["outputExposure"] <= budget.maximum_output_tokens
        assert ledger["chargeExposureNanoUSD"] <= budget.maximum_charge_nano_usd
        result = {"status": "OFFLINE_ADMISSION_PASS", "candidateSha": candidate,
                  "runId": budget.run_id, "budgetFingerprint": state.admission.identity,
                  "tariffAuthority": "SYNTHETIC_OFFLINE_ONLY; no real provider charging contract",
                  "dispatches": dispatches, "physicalOfflineHandlerCalls": len(dispatches),
                  "admission": ledger, "recoveredCompletedResponses": recovered["modelCalls"],
                  "denial": denial, "noDispatchAfterDenial": True, "sqliteIntegrity": "ok",
                  "paidModelCalls": 0, "paidTokens": 0, "paidCostUSD": 0,
                  "realProviderBilling": "NOT_VERIFIED", "semanticAcceptance": "NOT_EVALUATED"}
        (target / "rehearsal.json").write_text(json.dumps(result, indent=2) + "\n")
        return result


if __name__ == "__main__":
    result = main(sys.argv[1])
    print(json.dumps({k: result[k] for k in ["status", "candidateSha", "physicalOfflineHandlerCalls", "recoveredCompletedResponses", "denial", "paidModelCalls"]}))
