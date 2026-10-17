"""Build the sanitized permanent fixture of live failure 0964420f from its retained evidence. Nothing here is reconstructed:
what was never persisted is marked NOT_RETAINED, and the tool-to-rejection attribution is labelled as derived, with its assumption."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIVE = HERE / "retained-live-0964420f"
OUT = HERE.parents[1] / "deepagents/tests/fixtures/retained-authoring-rejection-failure-0964420f.json"

observation = json.loads((LIVE / "disposable-observation.json").read_text())
summary = json.loads((LIVE / "disposable-summary.json").read_text())
dispatch = json.loads((LIVE / "disposable-dispatch.json").read_text())


def data_of(event):
    payload = event["outputSummaryJson"]
    payload = json.loads(payload) if isinstance(payload, str) else payload
    return ((payload or {}).get("agentStreamEvent", {})).get("data", {})


events = sorted(observation["AssessmentRuntimeEvent"], key=lambda e: int(e["sequence"]))
run = observation["RuleSetPreparationRun"][0]
inventory = observation["RuleSetPreparationClaimInventory"][0]
native = observation["nativeRuns"][0]
tool_counts = summary["agent"]["toolCounts"]

SEQUENCE_KINDS = {"RULE_AUTHORING_TOOL_REJECTED", "NO_PROGRESS_DETECTED", "CLAIM_PHASE_TRANSITION", "RULE_AUTHORING_CONTEXT"}
timeline = []
for event in events:
    data = data_of(event)
    kind = data.get("activity_kind")
    if kind not in SEQUENCE_KINDS or data.get("phase") not in (None, "RULE_AUTHORING") and kind != "RULE_AUTHORING_CONTEXT":
        continue
    if kind == "CLAIM_PHASE_TRANSITION" and data.get("phase") != "RULE_AUTHORING":
        continue
    row = {"runtimeSequence": int(event["sequence"]), "createdAt": event["createdAt"], "kind": kind}
    if kind in {"RULE_AUTHORING_TOOL_REJECTED", "NO_PROGRESS_DETECTED"}:
        row.update(gapCounts=data.get("gap_counts"), gapFingerprint=data.get("gap_fingerprint"), candidateFingerprint=data.get("candidate_fingerprint"),
                   accountingFingerprint=data.get("accounting_fingerprint"), validationExecuted=data.get("validation_executed"), ruleValidationAttempt=data.get("rule_validation_attempt"))
        row["envelopePresent"] = "rejection" in data
    elif kind == "CLAIM_PHASE_TRANSITION":
        row.update(previousPhase=data.get("previous_phase"), phase=data.get("phase"))
    else:
        row.update({k: data.get(k) for k in ("authoringContextRevision", "authoredRequirements", "authoredAssessmentRules", "outstandingRejectionCode", "digestBytes", "inventoryPagesSurfaced", "unreadClaimCount")})
    timeline.append(row)

rejections = [r for r in timeline if r["kind"] == "RULE_AUTHORING_TOOL_REJECTED"]
successes = [r for r in timeline if r["kind"] == "CLAIM_PHASE_TRANSITION" and r["previousPhase"] == "RULE_AUTHORING"]
authoring_calls = {k: tool_counts.get(k, 0) for k in ("author_legal_requirement", "author_assessment_rule", "remove_rule_candidate", "start_rule_authoring", "validate_compliance_rule_set", "submit_compliance_rule_set")}
mutation_calls = authoring_calls["author_legal_requirement"] + authoring_calls["author_assessment_rule"] + authoring_calls["remove_rule_candidate"]
counts = [r["authoredRequirements"] for r in timeline if r["kind"] == "RULE_AUTHORING_CONTEXT"]
assert len(rejections) + len(successes) == mutation_calls, "accounting must tie out or this fixture would be a guess"
increments = sum(1 for a, b in zip([0, *counts], counts) if b > a)
decrements = sum(1 for a, b in zip([0, *counts], counts) if b < a)
successful_removals = len(successes) - increments  # each remaining success is either a requirement-adding author call or a removal

failures = summary["model"]["safeProviderFailures"]
fixture = {
    "label": "0964420f",
    "capturedFrom": "reports/lcsp360-authoring-memory-20261018 (uncommitted live evidence; indexed in retained-live-0964420f/EVIDENCE_INDEX.json)",
    "identity": {
        "preparationRunId": run["id"], "correlationId": run["correlationId"], "legalSourceVersionId": run["legalSourceVersionId"], "threadId": native["thread_id"],
        "nativeRunId": native["run_id"], "nativeRunStatus": native["status"], "checkpointIds": [c["checkpoint_id"] for c in observation["checkpoints"]],
        "frozenInventory": {"revision": inventory["revision"], "fingerprint": inventory["fingerprint"]}, "dispatchedAt": dispatch["dispatchedAt"],
    },
    "terminalReceipt": {"executionState": run["executionState"], "failureReason": run["failureReason"], "claimPhase": run["claimPhase"], "startedAt": run["startedAt"], "completedAt": run["completedAt"],
                        "requirementRows": len(observation["LegalRequirement"]), "assessmentRuleRows": len(observation["AssessmentRule"]), "ruleSetVersions": len(observation["ComplianceRuleSetVersion"])},
    "toolCalls": {"authoringPhase": authoring_calls, "all": tool_counts},
    "authoringTimeline": timeline,
    "derived": {
        "mutationCalls": mutation_calls, "rejectedMutations": len(rejections), "successfulMutations": len(successes),
        "ruleValidatorRuns": sum(1 for r in rejections if r["validationExecuted"]) + (1 if authoring_calls["validate_compliance_rule_set"] else 0),
        "requirementCountSeries": counts, "requirementIncrements": increments, "requirementDecrements": decrements,
        "successfulRemovals": successful_removals, "rejectedRemovals": authoring_calls["remove_rule_candidate"] - successful_removals,
        "rejectedAuthorLegalRequirement": authoring_calls["author_legal_requirement"] - (len(successes) - successful_removals),
        "attributionAssumption": "every mutation call produced exactly one success transition or one rejection event; the accounting above ties out exactly, which supports it but does not prove which individual rejection came from which tool",
        "dip": "the Requirement count fell exactly once (10 -> 9) and rose again; the only code path that deletes a Requirement is remove_rule_candidate, and exactly one of its three calls succeeded",
        "assessmentRuleCalls": authoring_calls["author_assessment_rule"],
    },
    "providerAccounting": {
        "logicalCalls": summary["model"]["logicalCalls"], "providerAttempts": summary["model"]["observedPhysicalProviderAttempts"], "fallbackCalls": summary["model"]["fallbackCalls"],
        "routes": {route: {"completions": v["completions"]} for route, v in summary["model"]["routes"].items()},
        "failedAttemptsByClass": {f"{x['error_class']}:{x['http_status']}:{x['model']}": sum(1 for y in failures if (y["error_class"], y["http_status"], y["model"]) == (x["error_class"], x["http_status"], x["model"])) for x in failures},
    },
    "notRetained": {
        "rejectedArgumentBodies": "NOT_RETAINED",
        "modelVisibleRejectionBodies": "NOT_RETAINED",
        "fieldPathsAndDetails": "NOT_RETAINED (the retained rejection events carry only gap_counts and fingerprints)",
        "toolCallIds": "NOT_RETAINED",
        "reason": "the stack and Agent checkpoint were torn down; the checkpoint holds 4 coarse states and no container log carries tool bodies",
        "instruction": "Do not reconstruct or invent these. Any replay of this failure uses synthetic bodies and must say so.",
    },
}
OUT.write_text(json.dumps(fixture, indent=1, ensure_ascii=False) + "\n")
print(json.dumps({k: fixture["derived"][k] for k in ("mutationCalls", "rejectedMutations", "successfulMutations", "successfulRemovals", "rejectedRemovals", "rejectedAuthorLegalRequirement", "requirementCountSeries")}))
