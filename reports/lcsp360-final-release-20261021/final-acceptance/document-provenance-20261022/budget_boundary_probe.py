"""Provider-free observation of the existing shared dispatch/record boundary; no cap claimed."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from middleware.usage_metering import UsageMeteringMiddleware, activate_agent_run_state
from vertical.live_preparation import LiveUsage, recover_usage

out = str(Path(sys.argv[1]) / "budget-probe-usage.json")
state = LiveUsage("provider-free-budget-boundary", out)
model = SimpleNamespace(provider="apx", protocol="anthropic", model_name="offline-budget-fixture")
request = SimpleNamespace(model=model, messages=[], tools=[], response_format=None)
meter = UsageMeteringMiddleware()
events = []

def provider_handler(request):
    completed = recover_usage(out, state.run_id)["modelCalls"]
    events.append({"event": "SYNTHETIC_DISPATCH", "role": state.agent_role, "alreadyCommittedResponses": completed})
    if len(events) == 3:
        raise ConnectionError("provider-free unanswered transport failure")
    return SimpleNamespace(usage_metadata={"input_tokens": 10, "output_tokens": 3, "total_tokens": 13}, response_metadata={})

# Only the offline fixture model's identity assertion is substituted. _prepare,
# dispatch, cancellation wrapper, durable record and recovery are the real code.
with patch("middleware.usage_metering.assert_model_identity", return_value=None):
    with activate_agent_run_state(state):
        for role in ["rule-set-preparation", "legal-semantic-auditor"]:
            state.agent_role = role
            meter.wrap_model_call(request, provider_handler)
        try:
            meter.wrap_model_call(request, provider_handler)
        except ConnectionError:
            pass
        else:
            raise AssertionError("The synthetic unanswered attempt must fail")
summary = recover_usage(out, state.run_id)
assert [event["alreadyCommittedResponses"] for event in events] == [0, 1, 2]
assert len(events) == 3 and summary["modelCalls"] == 2
assert {row["agentRole"] for row in summary["invocations"]} == {"rule-set-preparation", "legal-semantic-auditor"}
print(json.dumps({"diagnostic": "PASS", "syntheticDispatches": 3, "committedFixtureResponses": 2,
    "events": events, "financialAdmission": "BLOCKED_NOT_IMPLEMENTED",
    "finding": "Shared _prepare dispatches before response accounting; an unanswered attempt is not a completed usage row. Completion callbacks cannot enforce aggregate dispatch or financial caps.",
    "smallestSharedHook": "Run-scoped atomic admission/reservation at UsageMeteringMiddleware before handler, using AgentRunState and existing durable recovery; authoritative per-route upper bounds and provider tariffs are required. No generic forced-finalize prompt or new agent pipeline.",
    "missingPrerequisites": ["verified provider-side tariff/charge upper bounds for all routes", "conservative pre-dispatch token/cost reservation with atomic shared limits", "coverage of every actual SDK retry/credential/fallback dispatch", "approved paid envelope"],
    "syntheticInputTokens": summary["inputTokens"], "syntheticOutputTokens": summary["outputTokens"],
    "paidModelCalls": 0, "paidInputTokens": 0, "paidOutputTokens": 0, "paidCostUSD": 0}))
