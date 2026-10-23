"""Permanent anchor for live failure 0964420f: what was retained, what was not, and what the new runtime does with the same outcome shape.

The rejected argument bodies were never persisted. These tests state that, refuse to reconstruct it, and replay the retained SHAPE
(order of successes and rejections, the Requirement-count dip, the terminal stagnation) with bodies that are explicitly synthetic.
"""
import json
from pathlib import Path

import pytest

import retained_rule_authoring_harness as H
from authoring_contract_harness import FIXTURE48, PLAN48, Step, claim_index, run_script
from middleware.failure_policy import NoProgressDetected

LIVE = json.loads(Path(__file__).with_name("fixtures").joinpath("retained-authoring-rejection-failure-0964420f.json").read_text())
from semantic_pipeline_harness import authoring_fixture
FX = authoring_fixture()
CL = claim_index(FX)


def test_the_retained_identity_and_terminal_receipt_are_exactly_what_the_live_run_recorded():
    identity, receipt = LIVE["identity"], LIVE["terminalReceipt"]
    assert identity["preparationRunId"] == "0964420f-ab57-4f60-833b-c7f4a3029c63" and identity["correlationId"] == "b6c3bd74-6caa-4ec5-b1e1-c82bae1ba83d"
    assert identity["threadId"] == "dcd96331-4db9-5a09-b20b-683830b49116" and identity["nativeRunId"] == "2c2e7310-e01d-4d9a-b771-035b767500ed"
    assert identity["frozenInventory"] == {"revision": 1, "fingerprint": "82327ba2e55736ae6e1dcaad79f059541eba4d054983766ecf323cbdc7c67bac"} and len(identity["checkpointIds"]) == 4
    assert (receipt["executionState"], receipt["failureReason"], receipt["claimPhase"]) == ("FAILED", "RUNTIME_ERROR", "RULE_AUTHORING")
    assert identity["nativeRunStatus"] == "success", "the native run reported success although the Preparation failed: the LCSP event stream is the only truthful terminal record"
    assert receipt["requirementRows"] == receipt["assessmentRuleRows"] == receipt["ruleSetVersions"] == 0


def test_the_mutation_accounting_ties_out_and_the_assessment_rule_tool_was_never_called():
    calls, derived = LIVE["toolCalls"]["authoringPhase"], LIVE["derived"]
    assert calls == {"author_legal_requirement": 21, "author_assessment_rule": 0, "remove_rule_candidate": 3, "start_rule_authoring": 1, "validate_compliance_rule_set": 0, "submit_compliance_rule_set": 0}
    assert derived["mutationCalls"] == 24 == derived["rejectedMutations"] + derived["successfulMutations"] == 12 + 12
    assert derived["assessmentRuleCalls"] == 0 and derived["ruleValidatorRuns"] == 0, "the live run never reached the Requirement -> AssessmentRule step, nor the real Rule validator"
    assert (derived["rejectedAuthorLegalRequirement"], derived["successfulRemovals"], derived["rejectedRemovals"]) == (10, 1, 2)
    assert "supports it but does not prove" in derived["attributionAssumption"]


def test_the_requirement_count_dip_is_one_explicit_removal_not_an_artifact():
    series = [n for n in LIVE["derived"]["requirementCountSeries"] if n]
    falls = [(a, b) for a, b in zip(series, series[1:]) if b < a]
    assert falls == [(10, 9)] and series[-1] == 10 and LIVE["derived"]["requirementDecrements"] == 1 == LIVE["derived"]["successfulRemovals"]


def test_what_was_never_retained_is_declared_and_must_not_be_reconstructed():
    gone = LIVE["notRetained"]
    assert gone["rejectedArgumentBodies"] == gone["modelVisibleRejectionBodies"] == "NOT_RETAINED" and "Do not reconstruct" in gone["instruction"]
    assert all(not row["envelopePresent"] for row in LIVE["authoringTimeline"] if row["kind"] == "RULE_AUTHORING_TOOL_REJECTED"), (
        "the retained rejection events carried only gap counts and fingerprints: no tool arguments, field paths or detail, which is the observability gap")


def test_the_model_route_that_authored_the_run_is_a_recorded_confound():
    accounting = LIVE["providerAccounting"]
    assert accounting["routes"] == {"google_genai/gemini-3.5-flash-lite": {"completions": 147}} and accounting["logicalCalls"] == 147
    assert accounting["failedAttemptsByClass"] == {"AnthropicRateLimitError:429:claude-sonnet-4-6-free": 9, "GoogleRateLimitError:429:gemini-3.5-flash-lite": 7,
                                                   "GoogleAuthenticationError:401:gemini-3.5-flash-lite": 3}


# --- replay of the retained SHAPE with synthetic bodies ----------------------------------------------------------------------------
def full(prefix):
    return next(cid for cid in CL if cid.startswith(prefix))


def good(index):
    key, op, app, qual, exc, ctx = PLAN48[index]
    return {"requirement_key": key, "title": key, "operative_claim_ids": [full(p) for p in op], "applicability_claim_ids": [full(p) for p in app],
            "qualifier_claim_ids": [full(p) for p in qual], "exception_claim_ids": [full(p) for p in exc], "context_claim_ids": [full(p) for p in ctx]}


# One synthetic malformed call per retained rejection code. Which call produced which retained rejection is NOT known; this only
# gives each code a body that provokes it, so the runtime's handling of the retained order can be exercised.
OMIT = ["title", "applicability_claim_ids", "operative_claim_ids", "requirement_key"]
WRONG_ROLE = [lambda a: {"qualifier_claim_ids": [a["applicability_claim_ids"][0]]}, lambda a: {"operative_claim_ids": [next(cid for cid,c in CL.items() if c["claimType"] == "CONTEXT")]},
              lambda a: {"applicability_claim_ids": [a["applicability_claim_ids"][0], next(cid for cid,c in CL.items() if c["claimType"] == "DEFINITION")]}]


def synthetic(code, plan, variant):
    """A body that provokes the retained code, varied so repeats differ in the field at fault. Synthetic: the live bodies are NOT retained."""
    if code == "CLAIM_SCHEMA_INVALID":
        return Step("author_legal_requirement", {k: v for k, v in plan.items() if k != OMIT[variant % len(OMIT)]})
    if code == "CLAIM_REQUIREMENT_MISMATCH":
        return Step("author_legal_requirement", {**plan, **WRONG_ROLE[variant % len(WRONG_ROLE)](plan)})
    return Step("author_legal_requirement", {**plan, "operative_claim_ids": []})  # OPERATIVE_PROPOSITION_REQUIRED


def test_the_retained_outcome_order_replays_through_the_new_runtime_with_a_durable_envelope_for_every_rejection(tmp_path, monkeypatch):
    outcomes = [("OK", None) if row["kind"] == "CLAIM_PHASE_TRANSITION" else ("REJECT", next(iter(row["gapCounts"])))
                for row in LIVE["authoringTimeline"] if row["kind"] in {"CLAIM_PHASE_TRANSITION", "RULE_AUTHORING_TOOL_REJECTED"}]
    # drop the READY -> AUTHORING transition and the terminal duplicate of the last rejection
    outcomes = [o for o in outcomes][1:]
    assert [o[0] for o in outcomes].count("REJECT") == 12 and [o[0] for o in outcomes].count("OK") == 12
    _, ctx, _, _ = H.restore(FX)
    events: list = []
    steps, authored, removed_once, rejected = [Step("start_rule_authoring", {})], 0, False, 0
    for kind, code in outcomes:
        next_plan = good(min(authored, 8))
        if kind == "REJECT":
            steps.append(synthetic(code, next_plan, rejected))
            rejected += 1
            continue
        if authored == 9 and not removed_once:      # the retained 10 -> 9 -> 10: an explicit removal, then the Requirement again
            steps.append(Step("remove_rule_candidate", {"kind": "LEGAL_REQUIREMENT", "candidate_id": PLAN48[8][0], "reason": "re-author"}))
            removed_once = True
            authored -= 1
            continue
        steps.append(Step("author_legal_requirement", next_plan))
        authored += 1
    steps.append(Step("author_legal_requirement", good(8)))       # the replay is allowed to finish what the live run could not
    run_script(ctx, steps, tmp_path, monkeypatch, events=events, max_turns=200)
    rejections = [e["data"] for e in events if e.get("data", {}).get("activity_kind") == "RULE_AUTHORING_TOOL_REJECTED"]
    assert len(rejections) == 12 and all("rejection" in r and r["rejection"]["argsFingerprint"] and r["rejection"]["fieldPaths"] for r in rejections), (
        "every rejection of the retained order now carries a diagnosable envelope")
    assert len(ctx.draft["legalRequirements"]) == 9


def test_the_retained_terminal_class_is_reproduced_with_a_synthetic_repeated_call_and_classified_as_stagnation(tmp_path, monkeypatch):
    """The live run ended on repeated rejected calls with an unchanged draft. Synthetic body; the class of termination is what is checked."""
    _, ctx, _, _ = H.restore(FX)
    stuck = synthetic("CLAIM_SCHEMA_INVALID", good(0), 0)
    with pytest.raises(NoProgressDetected):
        run_script(ctx, [Step("start_rule_authoring", {}), *[Step(stuck.tool, stuck.args) for _ in range(5)]], tmp_path, monkeypatch)
    assert len(ctx.rejection_log) == 3 and not ctx.draft["legalRequirements"]
