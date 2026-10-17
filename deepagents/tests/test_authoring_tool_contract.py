"""Rule Authoring tool contract through the REAL Agent stack: every malformed or mismatched author_* call must be rejected without
touching the draft, recorded durably with a sanitized envelope, explained in the next model request, and then corrected to progress.

REJECT -> FEEDBACK -> CORRECT -> PROGRESS. Rejection alone is not a passing case.
"""
import json
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Callable

import pytest
from langchain_core.messages import AIMessage

import retained_rule_authoring_harness as H
from authoring_contract_harness import BLOCK, FIXTURE48, Step, claim_index, digest_of, run_script
from rule_set_preparation.authoring_rejections import (
    AUTHORING_PRECONDITION, MAX_ARGS_CHARS, REPAIR, SOURCE_PREFLIGHT, SOURCE_UNKNOWN_TOOL, SOURCE_UNPARSEABLE, TOOL_SCHEMA,
    draft_fingerprint,
)

FX = json.loads(FIXTURE48.read_text())
CL = claim_index(FX)


def pick(kind: str, relevant: bool = True, skip: int = 0) -> str:
    return sorted(cid for cid, c in CL.items() if c["claimType"] == kind and (c["state"] == "RELEVANT") == relevant)[skip]


DUTY, DUTY2, SCOPE, DEF, CTX, QUAL = pick("DUTY"), pick("DUTY", skip=1), pick("SCOPE"), pick("DEFINITION"), pick("CONTEXT"), pick("QUALIFIER")
NONRELEVANT = next(cid for cid, c in CL.items() if c["state"] != "RELEVANT")
GHOST = "f" * 64
BASE = {"requirement_key": "R-base", "title": "base", "operative_claim_ids": [DUTY], "applicability_claim_ids": [SCOPE]}
NEW = {"requirement_key": "R-new", "title": "new", "operative_claim_ids": [DUTY2], "applicability_claim_ids": [SCOPE]}
RULE = {"assessment_rule_id": "AR-new", "concept": "new concept", "legal_requirement_ids": ["R-base"]}


def without(args: dict, name: str) -> dict:
    return {k: v for k, v in args.items() if k != name}


@dataclass
class Case:
    id: str
    tool: str
    bad: dict
    fix: dict
    code: str
    layer: str
    fields: list[str]
    repair: str
    needs_base: bool = False
    fix_tool: str | None = None
    extra: Callable[[dict], None] | None = None  # extra assertions on the first failure example
    extra_prereq: list[Step] = field(default_factory=list)


def has_candidates(example: dict) -> None:
    assert example["candidates"] and example["candidateCount"] >= len(example["candidates"])


CASES = [
    # --- author_legal_requirement: layer A (argument contract) ---
    Case("A-missing-required-argument", "author_legal_requirement", without(NEW, "title"), NEW, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["title"], "MISSING_ARGUMENT"),
    Case("B-wrong-type-list-as-string", "author_legal_requirement", {**NEW, "operative_claim_ids": DUTY2}, NEW, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["operative_claim_ids"], "WRONG_TYPE"),
    Case("N-nested-list-shape", "author_legal_requirement", {**NEW, "operative_claim_ids": [[DUTY2]]}, NEW, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["operative_claim_ids.0"], "WRONG_TYPE"),
    Case("unknown-argument", "author_legal_requirement", {**NEW, "bogus": 1}, NEW, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["bogus"], "UNKNOWN_ARGUMENT"),
    Case("M-externally-supplied-inventory-revision", "author_legal_requirement", {**NEW, "inventory_revision": 7}, NEW, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["inventory_revision"], "UNKNOWN_ARGUMENT"),
    Case("duplicate-ids-in-list", "author_legal_requirement", {**NEW, "operative_claim_ids": [DUTY2, DUTY2]}, NEW, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["operative_claim_ids"], "DUPLICATE_ITEMS"),
    Case("empty-text", "author_legal_requirement", {**NEW, "title": ""}, NEW, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["title"], "INVALID_VALUE"),
    # --- author_legal_requirement: layer B (semantic preconditions) ---
    Case("I-no-operative-proposition", "author_legal_requirement", {**NEW, "operative_claim_ids": []}, NEW, "OPERATIVE_PROPOSITION_REQUIRED", AUTHORING_PRECONDITION,
         ["operative_claim_ids"], "OPERATIVE_REQUIRED", extra=has_candidates),
    Case("C-empty-applicability-list", "author_legal_requirement", {**NEW, "applicability_claim_ids": []}, NEW, "APPLICABILITY_SCOPE_MISSING", AUTHORING_PRECONDITION,
         ["applicability_claim_ids"], "APPLICABILITY_REQUIRED", extra=has_candidates),
    Case("D-unknown-claim-id", "author_legal_requirement", {**NEW, "operative_claim_ids": [GHOST]}, NEW, "CLAIM_REQUIREMENT_MISMATCH", AUTHORING_PRECONDITION,
         ["operative_claim_ids[0]"], "UNKNOWN_CLAIM", extra=has_candidates),
    Case("E-scope-in-qualifier-field", "author_legal_requirement", {**NEW, "qualifier_claim_ids": [pick("CONDITION")]}, NEW, "CLAIM_REQUIREMENT_MISMATCH", AUTHORING_PRECONDITION,
         ["qualifier_claim_ids[0]"], "ROLE_MISMATCH", extra=lambda e: (e["expectedField"] == "applicability_claim_ids" and e["actualRole"] == "APPLICABILITY_CONDITION") or pytest.fail(str(e))),
    Case("F-context-as-operative", "author_legal_requirement", {**NEW, "operative_claim_ids": [CTX]}, NEW, "CLAIM_REQUIREMENT_MISMATCH", AUTHORING_PRECONDITION,
         ["operative_claim_ids[0]"], "ROLE_MISMATCH", extra=lambda e: e["actualRole"] == "CONTEXT" or pytest.fail(str(e))),
    Case("G-definition-as-applicability", "author_legal_requirement", {**NEW, "applicability_claim_ids": [SCOPE, DEF]}, NEW, "CLAIM_REQUIREMENT_MISMATCH", AUTHORING_PRECONDITION,
         ["applicability_claim_ids[1]"], "ROLE_MISMATCH", extra=lambda e: e["expectedField"] == "context_claim_ids" or pytest.fail(str(e))),
    Case("H-scope-as-qualifier", "author_legal_requirement", {**NEW, "qualifier_claim_ids": [SCOPE]}, NEW, "CLAIM_REQUIREMENT_MISMATCH", AUTHORING_PRECONDITION,
         ["qualifier_claim_ids[0]"], "ROLE_MISMATCH"),
    Case("non-relevant-claim", "author_legal_requirement", {**NEW, "context_claim_ids": [NONRELEVANT]}, NEW, "CLAIM_REQUIREMENT_MISMATCH", AUTHORING_PRECONDITION,
         ["context_claim_ids[0]"], "NON_RELEVANT_CLAIM"),
    # --- author_assessment_rule ---
    Case("assessment-missing-argument", "author_assessment_rule", without(RULE, "concept"), RULE, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["concept"], "MISSING_ARGUMENT", needs_base=True),
    Case("assessment-wrong-type", "author_assessment_rule", {**RULE, "legal_requirement_ids": "R-base"}, RULE, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["legal_requirement_ids"], "WRONG_TYPE", needs_base=True),
    Case("assessment-empty-parent-list", "author_assessment_rule", {**RULE, "legal_requirement_ids": []}, RULE, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["legal_requirement_ids"], "EMPTY_REQUIRED_LIST", needs_base=True),
    Case("assessment-nested-list", "author_assessment_rule", {**RULE, "legal_requirement_ids": [["R-base"]]}, RULE, "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["legal_requirement_ids.0"], "WRONG_TYPE", needs_base=True),
    Case("J-unknown-parent-requirement", "author_assessment_rule", {**RULE, "legal_requirement_ids": ["R-typo"]}, RULE, "ORPHAN_ASSESSMENT_RULE", AUTHORING_PRECONDITION,
         ["legal_requirement_ids[0]"], "UNKNOWN_REQUIREMENT", needs_base=True, extra=lambda e: any(c["legalRequirementId"] == "R-base" for c in e["candidates"]) or pytest.fail(str(e))),
    Case("K-parent-is-non-assessable", "author_assessment_rule", {**RULE, "legal_requirement_ids": ["R-external"]}, RULE, "ORPHAN_ASSESSMENT_RULE", AUTHORING_PRECONDITION,
         ["legal_requirement_ids[0]"], "UNKNOWN_REQUIREMENT", needs_base=True,
         extra_prereq=[Step("author_legal_requirement", {"requirement_key": "R-external", "title": "external", "operative_claim_ids": [DUTY2], "applicability_claim_ids": [],
                                                       "non_assessable_reason": "performed outside the repository"})]),
    # --- remove_rule_candidate ---
    Case("O-invalid-enum", "remove_rule_candidate", {"kind": "BOGUS", "candidate_id": "R-base", "reason": "r"}, {"kind": "LEGAL_REQUIREMENT", "candidate_id": "R-base", "reason": "r"},
         "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["kind"], "INVALID_ENUM", needs_base=True),
    Case("remove-missing-reason", "remove_rule_candidate", {"kind": "LEGAL_REQUIREMENT", "candidate_id": "R-base"}, {"kind": "LEGAL_REQUIREMENT", "candidate_id": "R-base", "reason": "r"},
         "CLAIM_SCHEMA_INVALID", TOOL_SCHEMA, ["reason"], "MISSING_ARGUMENT", needs_base=True),
    Case("remove-unknown-candidate", "remove_rule_candidate", {"kind": "LEGAL_REQUIREMENT", "candidate_id": "R-typo", "reason": "r"},
         {"kind": "LEGAL_REQUIREMENT", "candidate_id": "R-base", "reason": "r"}, "CLAIM_SCHEMA_INVALID", AUTHORING_PRECONDITION, ["candidate_id"], "UNKNOWN_CANDIDATE", needs_base=True,
         extra=lambda e: any(c["candidateId"] == "R-base" for c in e["candidates"]) or pytest.fail(str(e))),
]


def rejection_events(events: list) -> list[dict]:
    return [e["data"] for e in events if e.get("data", {}).get("activity_kind") == "RULE_AUTHORING_TOOL_REJECTED"]


def snapshot(ctx: Any, events: list, into: dict) -> None:
    into.update(fp=draft_fingerprint(ctx.draft), rev=ctx.draft_revision, validations=ctx.validation_calls, log=len(ctx.rejection_log), events=len(rejection_events(events)),
                requirements=deepcopy(ctx.draft["legalRequirements"]), rules=deepcopy(ctx.draft["assessmentRules"]))


def expect_rejection(case: Case, snap: dict, events: list) -> Callable:
    def check(ctx, result, view, text):
        assert result["outcome"] == "FAILED", result
        example = result["gaps"][case.code]["examples"][0]
        assert example["layer"] == case.layer and set(case.fields) <= set(example["fieldPaths"]), example
        assert example["repair"] == REPAIR[case.repair]
        if case.extra:
            case.extra(example)
        # durable envelope: one new, complete, bounded, sanitized record
        assert len(ctx.rejection_log) == snap["log"] + 1
        envelope = ctx.rejection_log[-1]
        assert envelope["toolName"] == case.tool and envelope["rejectionCode"] == case.code and envelope["rejectionLayer"] == case.layer
        assert envelope["rejectionSource"] in {SOURCE_PREFLIGHT, "TOOL_BODY"} and set(case.fields) <= set(envelope["fieldPaths"])
        assert envelope["argsFingerprint"] and envelope["toolCallId"].startswith("probe-")
        assert envelope["inventoryFingerprint"] == FX["frozenInventory"]["fingerprint"] and envelope["inventoryRevision"] == 1
        assert len(json.dumps(envelope["sanitizedArgs"])) <= MAX_ARGS_CHARS
        # the draft did not move, and no real Rule validation ran
        assert envelope["draftUnchanged"] and envelope["draftFingerprintBefore"] == envelope["draftFingerprintAfter"] == snap["fp"]
        assert draft_fingerprint(ctx.draft) == snap["fp"] and ctx.draft_revision == snap["rev"] and ctx.validation_calls == snap["validations"]
        assert ctx.draft["legalRequirements"] == snap["requirements"] and ctx.draft["assessmentRules"] == snap["rules"]
        # the same envelope reached the durable event stream, under the rejection kind, never as a validator run
        fresh = rejection_events(events)[snap["events"]:]
        assert len(fresh) == 1 and fresh[0]["rejection"]["sequence"] == envelope["sequence"] == fresh[0]["event_sequence"]
        assert fresh[0]["validation_executed"] is False and fresh[0]["rule_validation_attempt"] == snap["validations"]
        assert not [e for e in events if e.get("data", {}).get("activity_kind") == "CLAIM_PHASE_VALIDATION" and e["data"]["phase"] == "RULE_AUTHORING"]
        # the model-facing state explains what to repair in the very next request
        digest = digest_of(view)
        assert BLOCK in digest and case.code in digest and REPAIR[case.repair] in digest and "draft unchanged: true" in digest
        assert any(field_path in digest for field_path in case.fields)
    return check


def expect_correction(case: Case, snap: dict, events: list) -> Callable:
    def check(ctx, result, view, text):
        assert result["outcome"] == "PASSED", result
        assert not ctx.authoring.outstanding and BLOCK not in digest_of(view), "a resolved rejection must leave the next request"
        assert ctx.authoring.resolved[-1]["resolution"] == "CORRECTED" and ctx.authoring.resolved[-1]["rejectionResolvedByToolCallId"].startswith("probe-")
        resolved = [e["data"] for e in events if e.get("data", {}).get("activity_kind") == "RULE_AUTHORING_REJECTION_RESOLVED"]
        assert len(resolved) == 1 and resolved[0]["rejection_sequence"] == ctx.rejection_log[-1]["sequence"] and resolved[0]["resolution"] == "CORRECTED"
        assert resolved[0]["resolved_by_tool_call_id"] == ctx.authoring.resolved[-1]["rejectionResolvedByToolCallId"] and resolved[0]["resolved_by_tool"] == (case.fix_tool or case.tool)
        assert ctx.draft_revision == snap["rev"] + 1, "the corrected call advanced the draft exactly once"
        assert ctx.validation_calls == snap["validations"]
        for key, row in snap["requirements"].items():  # unrelated draft state is untouched
            if not (case.tool == "remove_rule_candidate" and case.fix.get("candidate_id") == key):
                assert ctx.draft["legalRequirements"][key] == row
    return check


def script(case: Case, snap: dict, events: list) -> list[Step]:
    steps = [Step("start_rule_authoring", {})]
    if case.needs_base:
        steps.append(Step("author_legal_requirement", BASE, check=lambda ctx, r, v, t: r["outcome"] == "PASSED" or pytest.fail(str(r))))
    steps.extend(case.extra_prereq)
    steps.append(Step("get_rule_authoring_status", {}, check=lambda ctx, r, v, t: snapshot(ctx, events, snap)))
    steps.append(Step(case.tool, case.bad, check=expect_rejection(case, snap, events), label="bad"))
    steps.append(Step(case.fix_tool or case.tool, case.fix, check=expect_correction(case, snap, events), label="fix"))
    return steps


@pytest.mark.parametrize("case", CASES, ids=[c.id for c in CASES])
def test_reject_feedback_correct_progress(case, tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    snap, events = {}, []
    probe = run_script(ctx, script(case, snap, events), tmp_path, monkeypatch, events=events)
    assert probe.index == len(probe.steps) and probe.results[-1]["outcome"] == "PASSED"


# --- framework-level refusals: no tool body ever ran ----------------------------------------------------------------------
def test_unknown_tool_name_is_recorded_explained_and_resolved_by_the_next_valid_call(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    snap, events = {}, []

    def bad(ctx, result, view, text):
        assert text.startswith("Error:") and "not a valid tool" in text  # the framework's own answer is unchanged
        envelope = ctx.rejection_log[-1]
        assert envelope["rejectionLayer"] == TOOL_SCHEMA and envelope["rejectionSource"] == SOURCE_UNKNOWN_TOOL and envelope["toolName"] == "author_requirement"
        assert envelope["toolCallId"] == "unknown-1" and "author_legal_requirement" in envelope["detail"], envelope["detail"]
        assert envelope["draftUnchanged"] and draft_fingerprint(ctx.draft) == snap["fp"] and ctx.validation_calls == snap["validations"]
        digest = digest_of(view)
        assert BLOCK in digest and "author_requirement" in digest and REPAIR["UNKNOWN_TOOL"] in digest
        assert len(rejection_events(events)) - snap["events"] == 1 and rejection_events(events)[-1]["rejection"]["rejectionSource"] == SOURCE_UNKNOWN_TOOL

    def fixed(ctx, result, view, text):
        assert result["outcome"] == "PASSED" and not ctx.authoring.outstanding and BLOCK not in digest_of(view)
        assert ctx.authoring.resolved[-1]["rejectionResolvedByToolCallId"].startswith("probe-")

    steps = [Step("start_rule_authoring", {}), Step("get_rule_authoring_status", {}, check=lambda c, r, v, t: snapshot(c, events, snap)),
             Step("author_requirement", BASE, check=bad, message=lambda args: AIMessage(content="", tool_calls=[{"name": "author_requirement", "args": args, "id": "unknown-1"}])),
             Step("author_legal_requirement", BASE, check=fixed)]
    run_script(ctx, steps, tmp_path, monkeypatch, events=events)


def test_unparseable_arguments_are_recorded_explained_and_resolved_by_the_next_valid_call_of_that_tool(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    snap, events = {}, []

    def bad(ctx, result, view, text):
        envelope = ctx.rejection_log[-1]
        assert envelope["rejectionLayer"] == TOOL_SCHEMA and envelope["rejectionSource"] == SOURCE_UNPARSEABLE and envelope["toolName"] == "author_legal_requirement"
        assert envelope["draftUnchanged"] and draft_fingerprint(ctx.draft) == snap["fp"]
        # the model got NO tool answer for a call that never ran, so the digest is its only feedback
        digest = digest_of(view)
        assert BLOCK in digest and REPAIR["UNPARSEABLE_ARGUMENTS"] in digest and "author_legal_requirement" in digest
        assert len(rejection_events(events)) - snap["events"] == 1

    def fixed(ctx, result, view, text):
        assert result["outcome"] == "PASSED" and not ctx.authoring.outstanding and BLOCK not in digest_of(view)

    broken = AIMessage(content="", invalid_tool_calls=[{"name": "author_legal_requirement", "args": '{"requirement_key": "R-base", "title":', "id": "broken-1", "error": "bad json", "type": "invalid_tool_call"}])
    steps = [Step("start_rule_authoring", {}), Step("get_rule_authoring_status", {}, check=lambda c, r, v, t: snapshot(c, events, snap)),
             Step("author_legal_requirement", {}, message=lambda args: broken, check=bad), Step("author_legal_requirement", BASE, check=fixed)]
    run_script(ctx, steps, tmp_path, monkeypatch, events=events)


# --- L: an identical resend is a no-op success, not a rejection and not a second mutation ----------------------------------------------------
def test_L_duplicate_mutation_is_idempotent_and_leaves_no_trace_in_the_draft_or_the_rejection_state(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    events: list = []
    seen: dict[str, Any] = {}

    def first(c, r, v, t):
        assert r["outcome"] == "PASSED"
        seen.update(fp=draft_fingerprint(c.draft), rev=c.draft_revision, row=deepcopy(c.draft["legalRequirements"]["R-base"]), log=len(c.rejection_log))

    def resent(c, r, v, t):
        assert r["outcome"] == "PASSED" and r["draftRevision"] == seen["rev"], r
        assert draft_fingerprint(c.draft) == seen["fp"] and c.draft_revision == seen["rev"], "an identical resend must not move the draft"
        assert c.draft["legalRequirements"]["R-base"] == seen["row"] and len(c.draft["legalRequirements"]) == 1
        assert len(c.rejection_log) == seen["log"] and not c.authoring.outstanding and BLOCK not in digest_of(v)
        assert not rejection_events(events), "an idempotent resend is not a rejection"

    steps = [Step("start_rule_authoring", {}), Step("author_legal_requirement", BASE, check=first), Step("author_legal_requirement", BASE, check=resent)]
    run_script(ctx, steps, tmp_path, monkeypatch, events=events)
