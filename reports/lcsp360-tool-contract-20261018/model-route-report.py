"""Which model did each phase of a live Preparation actually use? Built only from persisted runtime events.

  python3 model-route-report.py disposable-observation.json [approved-routes.json] [out-prefix]

Every MODEL_CALL_COMPLETED is attributed to the phase of the latest CLAIM_PHASE_TRANSITION before it. If an approved set is given,
a completion on any other (provider, model) is a ROUTE_POLICY_VIOLATION: acceptance must not be silently judged on a route outside the
set the task approved. Failed attempts (429/401/...) are listed by route ordinal with their fallback eligibility.
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def stream_event(row):
    blob = row["outputSummaryJson"]
    blob = json.loads(blob) if isinstance(blob, str) else blob
    return (blob or {}).get("agentStreamEvent", {})


def build(observation: dict, approved: set[tuple[str, str]] | None = None) -> dict:
    rows = sorted(observation["AssessmentRuntimeEvent"], key=lambda r: int(r["sequence"]))
    phase, per_phase, calls, failures = "CLAIM_DISCOVERY", defaultdict(Counter), [], []
    for row in rows:
        event = stream_event(row)
        data = event.get("data") or {}
        if data.get("activity_kind") == "CLAIM_PHASE_TRANSITION":
            phase = data.get("phase", phase)
        elif data.get("activity_kind") == "MODEL_PROVIDER_ATTEMPT_FAILED":
            failures.append({"phase": phase, "provider": data.get("provider"), "model": data.get("model"), "errorClass": data.get("error_class"), "httpStatus": data.get("http_status"),
                             "routeOrdinal": data.get("route_ordinal"), "credentialSlotSafeId": data.get("credential_slot_safe_id"),
                             "failureCode": data.get("provider_error_code") or data.get("error_class"), "attemptOrdinal": data.get("attempt_ordinal"), "fallbackEligible": data.get("fallback_eligibility"), "invocationId": data.get("invocation_id")})
        elif row["summary"].startswith("Agent stream MODEL_CALL_COMPLETED"):
            usage = data.get("usage") or {}
            call = {"phase": phase, "invocationId": data.get("invocation_id"), "provider": data.get("provider"), "model": data.get("model"), "fallbackUsed": bool(data.get("fallback_used")),
                    "credentialSlotSafeId": data.get("credential_slot_safe_id"), "routeOrdinal": data.get("route_ordinal"),
                    "primaryOrFallback": "FALLBACK" if (data.get("route_ordinal") or 0) > 0 else "PRIMARY",
                    "failedAttempts": [f for f in failures if f["invocationId"] == data.get("invocation_id")],
                    "providerAttempts": data.get("provider_attempts"), "durationMs": data.get("duration_ms"), "inputTokens": usage.get("input_tokens"), "outputTokens": usage.get("output_tokens"),
                    "cacheRead": (usage.get("details") or {}).get("cache_read")}
            calls.append(call)
            call["fallbackReason"] = call["failedAttempts"][-1]["failureCode"] if call["failedAttempts"] else ("RETAINED_FALLBACK_ROUTE" if call["primaryOrFallback"] == "FALLBACK" else None)
            per_phase[phase][f"{call['provider']}/{call['model']}"] += 1
        elif event.get("eventType") in {"MODEL_CALL_FAILED", "MODEL_CALL_TIMEOUT", "MODEL_CALL_CANCELLED"}:
            calls.append({"phase": phase, "invocationId": data.get("invocation_id"), "provider": data.get("provider"), "model": data.get("model"),
                          "credentialSlotSafeId": data.get("credential_slot_safe_id"), "routeOrdinal": data.get("route_ordinal"),
                          "primaryOrFallback": "FALLBACK" if (data.get("route_ordinal") or 0) > 0 else "PRIMARY", "fallbackUsed": False,
                          "failureCode": data.get("error_type") or event["eventType"], "fallbackReason": data.get("last_attempt_error_class"),
                          "failedAttempts": [f for f in failures if f["invocationId"] == data.get("invocation_id")],
                          "inputTokens": None, "outputTokens": None, "cacheRead": None})
    totals = Counter(f"{c['provider']}/{c['model']}" for c in calls)
    violations = [c for c in calls if approved is not None and (c["provider"], c["model"]) not in approved]
    ordered = [c for c in calls]
    return {
        "logicalCalls": len({c["invocationId"] for c in calls}), "terminalReceipts": len(calls), "failedAttempts": len(failures), "fallbackCalls": sum(c["fallbackUsed"] for c in calls),
        "byRoute": dict(totals), "byPhase": {p: dict(c) for p, c in per_phase.items()},
        "failedAttemptsByClass": dict(Counter(f"{f['errorClass']}:{f['httpStatus']}:{f['provider']}/{f['model']}" for f in failures)),
        "inputTokens": sum(c["inputTokens"] or 0 for c in calls), "outputTokens": sum(c["outputTokens"] or 0 for c in calls), "cacheRead": sum(c["cacheRead"] or 0 for c in calls),
        "usageComplete": all(c["inputTokens"] is not None and c["outputTokens"] is not None for c in calls),
        "claimDiscoveryRoutes": sorted(per_phase.get("CLAIM_DISCOVERY", {})), "ruleAuthoringRoutes": sorted(per_phase.get("RULE_AUTHORING", {})),
        "finalCallRoute": f"{ordered[-1]['provider']}/{ordered[-1]['model']}" if ordered else None,
        "approvedRoutes": sorted(f"{p}/{m}" for p, m in approved) if approved is not None else None,
        "ROUTE_POLICY": "NOT_CHECKED" if approved is None else ("PASS" if not violations else "ROUTE_POLICY_VIOLATION"), "violations": violations[:20], "failures": failures, "calls": calls,
    }


if __name__ == "__main__":
    observation = json.loads(Path(sys.argv[1]).read_text())
    approved = {tuple(r.split("/", 1)) for r in json.loads(Path(sys.argv[2]).read_text())["approvedRoutes"]} if len(sys.argv) > 2 and sys.argv[2] != "-" else None
    report = build(observation, approved)
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(sys.argv[1]).with_name("MODEL_ROUTES")
    out.with_suffix(".json").write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({k: report[k] for k in ("logicalCalls", "failedAttempts", "fallbackCalls", "byRoute", "byPhase", "failedAttemptsByClass", "usageComplete", "ROUTE_POLICY")}, indent=1))
