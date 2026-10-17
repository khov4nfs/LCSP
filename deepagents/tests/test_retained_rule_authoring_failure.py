"""Exact retained failure of live Preparation de491791: a frozen 38-claim inventory no Rule Set could be authored from.

Provider-free. Discovery state is rebuilt with the real tools (identical canonical IDs), validators are the real API
domain validators through the bridge, and the semantic claims a repaired discovery would add are scripted Agent output.
"""
import json
from collections import Counter

import pytest
from middleware.failure_policy import NoProgressDetected
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream
from rule_set_preparation.claim_inventory import CLAIM_ROLES

import retained_rule_authoring_harness as H
from claim_protocol_harness import call

FX = H.load()
FROZEN = FX["frozenInventory"]["graph"]
CLAIMS = {c["claimId"]: c for c in FROZEN["claims"]}
NORMATIVE = sorted(cid for cid, c in CLAIMS.items() if CLAIM_ROLES[c["claimType"]] == "OPERATIVE_PROPOSITION")
LIVE_FINGERPRINTS = {  # activity events observed in the failed live run (sequence -> gap/effective-state fingerprints)
    e["sequence"]: e for e in FX["observedTimeline"] if e.get("activity_kind") == "CLAIM_PHASE_VALIDATION"}


def cid(prefix):
    return next(k for k in CLAIMS if k.startswith(prefix))


def capture():
    events = []
    return events, AgentStreamSession(assessment_id=None, run_id="offline", correlation_id="offline", boundary_name="rule-set-preparation",
                                      emit_payload=events.append, boundary_type="RULE_SET_PREPARATION", preparation_run_id=FX["preparationId"])


def kinds(events):
    return Counter(e["data"]["activity_kind"] for e in events if e.get("data", {}).get("activity_kind"))


def test_retained_inventory_has_normative_claims_and_no_claim_that_can_ground_applicability():
    assert len(CLAIMS) == 38 and len(FROZEN["relations"]) == 14
    assert len(NORMATIVE) == 17
    assert not [c for c in CLAIMS.values() if CLAIM_ROLES[c["claimType"]] == "APPLICABILITY_CONDITION"]


def test_finalization_now_rejects_the_exact_retained_inventory_with_machine_readable_gaps():
    """BEFORE the fix this same state froze (live CLAIM_INVENTORY_READY). Now the gate refuses it before the freeze."""
    _, ctx, tools, api = H.rediscover()
    result = call(tools, "finalize_semantic_claim_inventory")
    assert result["outcome"] == "FAILED"
    assert list(result["gaps"]) == ["APPLICABILITY_AUTHORITY_MISSING"] and result["gaps"]["APPLICABILITY_AUTHORITY_MISSING"]["count"] == len(NORMATIVE)
    example = result["gaps"]["APPLICABILITY_AUTHORITY_MISSING"]["examples"][0]
    assert example["ref"].removeprefix("claim:") in NORMATIVE and example["claimType"] in {"DUTY", "PROHIBITION", "PERMISSION"} and example["sourceNodeIds"]
    assert result["requiredAction"] == "register_semantic_claim" and "SCOPE or CONDITION claim" in result["guidance"]
    assert ctx.inventory.frozen is None and ctx.inventory.phase == "CLAIM_DISCOVERY" and api.frozen is None
    # Rule authoring is unavailable until a repaired discovery freezes.
    assert call(tools, "author_legal_requirement", requirement_key="R", title="t", operative_claim_ids=[NORMATIVE[0]], applicability_claim_ids=[])["gaps"]["CLAIM_PHASE_INVALID"]


def test_legacy_frozen_inventory_gets_actionable_authoring_feedback_not_a_role_chase():
    """Defence in depth for an inventory frozen before the gate existed: every assessable attempt names the real obstacle."""
    _, ctx, tools, _ = H.restore()
    result = call(tools, "author_legal_requirement", requirement_key="R", title="t", operative_claim_ids=[NORMATIVE[0]], applicability_claim_ids=[])
    gap = result["gaps"]["APPLICABILITY_SCOPE_MISSING"]["examples"][0]
    assert gap["candidateCount"] == 0 and gap["candidates"] == [] and gap["expectedRole"] == "APPLICABILITY_CONDITION"
    assert result["requiredAction"] == "reopen_semantic_claim_inventory" and not ctx.draft["legalRequirements"]


def test_five_authoring_rejections_and_three_malformed_reads_are_zero_rule_validations():
    """The failed live run counted exactly these eight as RULE_VALIDATION:FAILED while the Rule Validator never ran."""
    _, ctx, tools, _ = H.restore()
    events, session = capture()
    duty = NORMATIVE[0]
    with activate_agent_stream(session):
        reads = [call(tools, "get_claim_inventory", kind="CLAIMS", limit=50), call(tools, "get_claim_inventory", kind="NOPE"), call(tools, "get_claim_inventory", kind="CLAIMS", limit=0)]
        assert call(tools, "start_rule_authoring")["relevantClaimsByAccountingRole"]["OPERATIVE_PROPOSITION"] == len(NORMATIVE)
        authoring = [
            call(tools, "author_legal_requirement", requirement_key="R1", title="t", operative_claim_ids=[duty], applicability_claim_ids=[cid("5c10d55e")]),  # DEFINITION as applicability
            call(tools, "author_legal_requirement", requirement_key="R1", title="t", operative_claim_ids=[duty], applicability_claim_ids=[cid("0feb5e44")]),  # CONTEXT
            call(tools, "author_legal_requirement", requirement_key="R1", title="t", operative_claim_ids=[duty], applicability_claim_ids=[cid("e33095b2")]),  # TEMPORAL_RULE
            call(tools, "author_legal_requirement", requirement_key="R1", title="t", operative_claim_ids=[duty], applicability_claim_ids=["f" * 64]),  # unknown claim
            call(tools, "author_legal_requirement", requirement_key="R1", title="t", operative_claim_ids=[duty], applicability_claim_ids=[]),  # no applicability exists
        ]
    assert all(r["outcome"] == "FAILED" for r in reads + authoring)
    counts = kinds(events)
    assert counts["CLAIM_INVENTORY_READ_REJECTED"] == 3 and counts["RULE_AUTHORING_TOOL_REJECTED"] == 5
    assert ctx.validation_calls == 0
    assert not counts["RULE_VALIDATION_STARTED"] and not counts["RULE_VALIDATION_FAILED"] and not counts["RULE_VALIDATION_PASSED"]
    assert not [e for e in events if e.get("data", {}).get("activity_kind") == "CLAIM_PHASE_VALIDATION"]
    assert not [e for e in events if e.get("data", {}).get("phase") == "RULE_VALIDATION"]
    assert all(e["data"]["validation_executed"] is False for e in events if e.get("data", {}).get("activity_kind", "").endswith("_REJECTED"))
    assert not ctx.draft["legalRequirements"], "a rejected mutation must not store anything"


def test_rejection_names_the_claim_its_role_and_the_argument_it_belongs_in():
    _, ctx, tools, _ = H.restore()
    call(tools, "start_rule_authoring")
    for prefix, expected_role, expected_field in (("5c10d55e", "DEFINITION", "context_claim_ids"), ("e33095b2", "QUALIFIER", "qualifier_claim_ids"), ("0feb5e44", "CONTEXT", "context_claim_ids")):
        result = call(tools, "author_legal_requirement", requirement_key="R", title="t", operative_claim_ids=[NORMATIVE[0]], applicability_claim_ids=[cid(prefix)])
        gap = result["gaps"]["CLAIM_REQUIREMENT_MISMATCH"]["examples"][0]
        assert (gap["ref"], gap["suppliedField"], gap["expectedRole"], gap["expectedField"]) == (cid(prefix), "applicability_claim_ids", expected_role, expected_field)
        assert result["requiredAction"] == "author_legal_requirement", "a frozen inventory must never be told to fetch another discovery review unit"


def test_live_fingerprints_of_the_eight_failures_are_still_reproduced_by_their_gaps():
    """The ineffective-repetition detector keys on (code, ref): the same malformed read repeats to a terminal NoProgressDetected."""
    _, ctx, tools, _ = H.restore()
    events, session = capture()
    with activate_agent_stream(session):
        ctx.model_turn = 1
        assert "NO_PROGRESS" not in call(tools, "get_claim_inventory", kind="CLAIMS", limit=50)
        ctx.model_turn = 2
        assert "NO_PROGRESS" in call(tools, "get_claim_inventory", kind="CLAIMS", limit=50)
        ctx.model_turn = 3
        with pytest.raises(NoProgressDetected):
            call(tools, "get_claim_inventory", kind="CLAIMS", limit=50)
    assert kinds(events)["NO_PROGRESS_DETECTED"] == 1 and kinds(events)["CLAIM_INVENTORY_READ_REJECTED"] == 3


def repaired():
    """Retained discovery + the omitted applicability claims -> freeze -> start authoring, all through the real tools."""
    fx, ctx, tools, api = H.rediscover()
    new = H.repair_discovery(fx, ctx, tools)
    assert call(tools, "validate_semantic_claim_inventory")["outcome"] == "PASSED"
    ready = call(tools, "finalize_semantic_claim_inventory")
    assert ready["outcome"] == "PASSED", ready
    assert call(tools, "start_rule_authoring")["relevantClaimsByAccountingRole"]["APPLICABILITY_CONDITION"] == len(H.REPAIR)
    return fx, ctx, tools, api, new


def packet_digest(ctx):
    from rule_set_preparation.claim_inventory import fingerprint
    packet = ctx.draft_packet()
    return fingerprint({k: sorted(packet[k], key=lambda r: r.get("legalRequirementId") or r.get("assessmentRuleId") or r["relationId"]) for k in ("legalRequirements", "assessmentRules", "contextRelations")})


def test_repaired_retained_discovery_freezes_authors_and_passes_the_real_rule_validator_then_submits():
    fx, ctx, tools, api, new = repaired()
    events, session = capture()
    frozen_at_entry, fingerprint_at_entry = json.dumps(ctx.inventory.frozen, sort_keys=True), ctx.inventory.frozen_fingerprint
    with activate_agent_stream(session):
        assert all(r["outcome"] == "PASSED" for r in H.author_plan(tools, CLAIMS, new))
        assert all(r["outcome"] == "PASSED" for r in H.author_rules(tools))
        assert ctx.validation_calls == 0, "authoring alone never runs the Rule Validator"
        result = call(tools, "validate_compliance_rule_set")
        submitted = call(tools, "submit_compliance_rule_set")
    assert result["outcome"] == "PASSED" and result["coverage"]["semanticClaims"] == {"relevant": 44, "accounted": 44, "unaccounted": 0}
    counts = kinds(events)
    assert (counts["RULE_VALIDATION_STARTED"], counts["RULE_VALIDATION_PASSED"], counts["RULE_VALIDATION_FAILED"], ctx.validation_calls) == (1, 1, 0, 1)
    assert counts["RULE_AUTHORING_TOOL_REJECTED"] == 0 and submitted["preparationState"] == "SUCCEEDED"
    # Frozen inventory immutability from Rule Authoring entry through submission.
    assert json.dumps(ctx.inventory.frozen, sort_keys=True) == frozen_at_entry and ctx.inventory.frozen_fingerprint == fingerprint_at_entry
    assert api.submitted["claimInventory"]["fingerprint"] == fingerprint_at_entry and ctx.inventory.revision == 1
    assert all(CLAIMS[c] == next(x for x in api.submitted["semanticGraph"]["claims"] if x["claimId"] == c) for c in CLAIMS), "every retained claim survives unchanged"
    assert all(r["sourceRefs"] for r in api.submitted["legalRequirements"] + api.submitted["assessmentRules"])


def test_real_validator_failure_counts_one_attempt_and_local_repair_keeps_unrelated_requirements():
    fx, ctx, tools, api, new = repaired()
    events, session = capture()
    with activate_agent_stream(session):
        assert all(r["outcome"] == "PASSED" for r in H.author_plan(tools, CLAIMS, new, only={"R1-export", "R2-no-obstacles"}))
        before = packet_digest(ctx)
        bad = call(tools, "author_legal_requirement", requirement_key="R3-compensation", title="t", operative_claim_ids=[cid("a904a30b")], applicability_claim_ids=[cid("5cae9cc6")])
        assert bad["gaps"]["CLAIM_REQUIREMENT_MISMATCH"]["examples"][0]["expectedField"] == "context_claim_ids"
        assert packet_digest(ctx) == before, "a locally rejected mutation changes nothing"
        assert all(r["outcome"] == "PASSED" for r in H.author_plan(tools, CLAIMS, new, only={"R3-compensation"}))
        assert all(r["outcome"] == "PASSED" for r in H.author_plan(tools, CLAIMS, new, only={"R3-compensation"})), "idempotent"
        assert len(ctx.draft["legalRequirements"]) == 3
        rest = {p[0] for p in H.PLAN} - {"R1-export", "R2-no-obstacles", "R3-compensation", "R9-access-rights"}
        assert all(r["outcome"] == "PASSED" for r in H.author_plan(tools, CLAIMS, new, only=rest))
        assert all(r["outcome"] == "PASSED" for r in H.author_rules(tools))
        before_validation = packet_digest(ctx)
        incomplete = call(tools, "validate_compliance_rule_set")  # two permissions are still unaccounted: only the real validator can say so
        assert incomplete["outcome"] == "FAILED" and incomplete["gaps"]["UNACCOUNTED_SEMANTIC_CLAIM"]["count"] == 2
        assert ctx.validation_calls == 1 and ctx.inventory.phase == "RULE_AUTHORING" and packet_digest(ctx) == before_validation
        assert len(ctx.draft["legalRequirements"]) == 8, "a validator gap never makes the Agent regenerate valid Requirements"
        assert all(r["outcome"] == "PASSED" for r in H.author_plan(tools, CLAIMS, new, only={"R9-access-rights"}))
        assert call(tools, "validate_compliance_rule_set")["outcome"] == "PASSED"
    counts = kinds(events)
    assert (counts["RULE_VALIDATION_STARTED"], counts["RULE_VALIDATION_FAILED"], counts["RULE_VALIDATION_PASSED"], ctx.validation_calls) == (2, 1, 1, 2)
    assert counts["RULE_AUTHORING_TOOL_REJECTED"] == 1


def test_authoring_is_order_independent_and_restart_deterministic():
    fx, ctx_a, tools_a, api_a, new_a = repaired()
    H.author_plan(tools_a, CLAIMS, new_a)
    H.author_rules(tools_a)
    fx, ctx_b, tools_b, api_b, new_b = repaired()  # a restarted Agent re-derives the same frozen inventory, then replays the same mutations
    H.author_plan(tools_b, CLAIMS, new_b, order=list(reversed(range(len(H.PLAN)))))
    H.author_rules(tools_b)
    assert new_a == new_b and ctx_a.inventory.frozen_fingerprint == ctx_b.inventory.frozen_fingerprint
    assert packet_digest(ctx_a) == packet_digest(ctx_b)
    assert call(tools_a, "validate_compliance_rule_set")["outcome"] == call(tools_b, "validate_compliance_rule_set")["outcome"] == "PASSED"


def authored():
    fx, ctx, tools, api, new = repaired()
    assert all(r["outcome"] == "PASSED" for r in H.author_plan(tools, CLAIMS, new))
    assert all(r["outcome"] == "PASSED" for r in H.author_rules(tools))
    return ctx, tools, new


def test_authored_draft_keeps_every_structured_semantic_the_matrix_requires():
    ctx, tools, new = authored()
    reqs = ctx.draft["legalRequirements"]
    claim_of = lambda prefix: CLAIMS[cid(prefix)]
    # H actor direction / I delegated fulfilment / L combined duties: operative triples are copied from the claims, none merged away.
    for key, operative, *_ in H.PLAN:
        assert [(o["actor"], o["modality"], o["action"]) for o in reqs[key]["operativePropositions"]] == [
            (claim_of(p)["operative"]["actor"], claim_of(p)["operative"]["modality"], claim_of(p)["operative"]["action"]) for p in operative]
    assert {o["actor"] for o in reqs["R4-provider"]["operativePropositions"]} != {o["actor"] for o in reqs["R5-operator-delegation"]["operativePropositions"]}
    assert len(reqs["R7-audit"]["operativePropositions"]) == 2
    # D context never becomes a duty; E/M qualifiers and G temporal branches survive verbatim.
    operative_claims = {b["claimId"] for r in reqs.values() for b in r["claimBindings"] if b["role"] == "OPERATIVE_PROPOSITION"}
    assert not [c for c in operative_claims if CLAIMS[c]["claimType"] in {"CONTEXT", "DEFINITION"}]
    assert claim_of("a4f6de36")["statement"] in reqs["R2-no-obstacles"]["qualifiers"] and claim_of("9b86ca7d")["statement"] in reqs["R6-config-safeguards"]["qualifiers"]
    assert [claim_of(p)["statement"] for p in ("5800187c", "8391d3e7", "e33095b2")] == [q for q in reqs["R1-export"]["qualifiers"]]
    # F the exception stays scoped to the duty it modifies; B several claims aggregate into one Requirement.
    assert [r for r, v in reqs.items() if v["exceptions"]] == ["R2-no-obstacles"]
    assert len(reqs["R1-export"]["operativePropositions"]) == 2 and len(reqs["R4-provider"]["operativePropositions"]) == 2
    # J material cross-references/incorporations become typed directed Requirement dependencies derived from the frozen relations.
    kinds_ = {(r["kind"], r["fromLegalRequirementId"], r["toLegalRequirementId"]) for r in ctx.draft["contextRelations"].values()}
    assert ("CROSS_REFERENCE", "R4-provider", "R1-export") in kinds_ and ("CROSS_REFERENCE", "R5-operator-delegation", "R1-export") in kinds_
    # Applicability grounding: every assessable Requirement binds only claims whose role is applicability-bearing.
    for key, _, applicability, *_ in H.PLAN:
        bound = [b["claimId"] for b in reqs[key]["claimBindings"] if b["role"] == "APPLICABILITY_CONDITION"]
        assert bound == [new[k] for k in applicability or []]
        assert all(ctx.draft["semanticClaims"][c]["claimType"] in {"SCOPE", "CONDITION"} for c in bound)
    assert reqs["R9-access-rights"]["coverage"]["state"] == "NON_ASSESSABLE" and not reqs["R9-access-rights"]["applicabilityConditions"]


def test_rule_authoring_state_model_has_no_false_progress_cycle():
    """EMPTY -> PARTIAL -> LOCAL_GAP -> REPAIRED over every 3-step mutation sequence.

    Invariants: a rejected mutation never changes the draft; the run terminates only on the third identical rejection
    in an unchanged draft (a witness of real stagnation); any change to the draft, or a different rejection, is progress.
    """
    import itertools
    ops = {"good": ("R1-export", True), "bad_a": ("R1-export", False), "bad_b": ("R3-compensation", False)}
    bad_args = {"bad_a": cid("0feb5e44"), "bad_b": cid("5c10d55e")}  # CONTEXT / DEFINITION offered as applicability
    for sequence in itertools.product(ops, repeat=3):
        _, ctx, tools, api, new = repaired()
        ctx.model_turn, rejected_in_state = 0, {}
        for name in sequence:
            key, good = ops[name]
            before, ctx.model_turn = packet_digest(ctx), ctx.model_turn + 1
            try:
                result = H.author_plan(tools, CLAIMS, new, only={key})[0] if good else call(
                    tools, "author_legal_requirement", requirement_key=key, title="t", operative_claim_ids=[cid("14b91c88")], applicability_claim_ids=[bad_args[name]])
            except NoProgressDetected:
                assert rejected_in_state[(before, name)] == 2, f"terminated without stagnation witness: {sequence}"
                break
            assert (result["outcome"] == "PASSED") == good, "validity of a mutation does not depend on history"
            if not good:
                assert packet_digest(ctx) == before, "a rejected mutation never poisons the draft"
                rejected_in_state[(before, name)] = rejected_in_state.get((before, name), 0) + 1
        else:
            assert all(count < 3 for count in rejected_in_state.values())


def test_model_facing_surface_states_the_applicability_requirement_where_the_model_reads_it():
    """The live model must write SCOPE/CONDITION claims unprompted; the requirement is stated in instructions AND in the tool schemas."""
    from rule_set_preparation.agent import INSTRUCTIONS
    _, _, tools, _ = H.restore()
    text = " ".join(INSTRUCTIONS.split())
    for phrase in ("Only SCOPE and CONDITION claims can ground a Requirement's applicability", "never leave the trigger only inside the DUTY text", "APPLICABILITY_AUTHORITY_MISSING",
                   "reopen_source_review each owning unit", "no later phase can add a missing one", "A DEFINITION, CONTEXT, TEMPORAL_RULE or any normative claim never counts as applicability"):
        assert phrase in text, phrase
    register = tools["register_semantic_claim"].args_schema["properties"]["claim_type"]["description"]
    assert "SCOPE = whom or what" in register and "CONDITION = a trigger" in register and "cannot be finalized without one" in register
    assert "APPLICABILITY_AUTHORITY_MISSING" in tools["finalize_semantic_claim_inventory"].description and "reopen_source_review" in tools["finalize_semantic_claim_inventory"].description
