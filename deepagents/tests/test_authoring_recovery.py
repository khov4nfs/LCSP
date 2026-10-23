"""Rule Authoring recovery from an imperfect model, through the REAL Agent stack.

Covers what a one-call-at-a-time matrix cannot: a run that makes many mistakes and still converges to a real validator PASS and a
submission, an unresolved rejection that outlives history compaction and a rebuilt agent graph, and the two no-progress paths
(recovery must never terminate; genuine stagnation must).
"""
import json
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

import retained_rule_authoring_harness as H
from authoring_contract_harness import BLOCK, FIXTURE48, PLAN48, Step, claim_index, digest_of, run_script, text_of
from middleware.failure_policy import NoProgressDetected
from rule_set_preparation.agent import create_rule_set_preparation_agent
from rule_set_preparation.authoring_rejections import draft_fingerprint
from rule_set_preparation.draft_history import DraftHistoryMiddleware

from semantic_pipeline_harness import authoring_fixture
FX = authoring_fixture()
CL = claim_index(FX)
FROZEN_FINGERPRINT = FX["frozenInventory"]["fingerprint"]


def full(prefix: str) -> str:
    return next(cid for cid in CL if cid.startswith(prefix))


def args_of(row: tuple, name: str | None = None) -> dict:
    key, op, app, qual, exc, context = row
    return {"requirement_key": name or key, "title": key, "operative_claim_ids": [full(p) for p in op], "applicability_claim_ids": [full(p) for p in app],
            "qualifier_claim_ids": [full(p) for p in qual], "exception_claim_ids": [full(p) for p in exc], "context_claim_ids": [full(p) for p in context]}


def unknown_tool(args: dict) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": "author_requirement", "args": args, "id": "unknown-tool"}])


def unparseable(args: dict) -> AIMessage:
    return AIMessage(content="", invalid_tool_calls=[{"name": "author_legal_requirement", "args": '{"requirement_key": "x", "title":', "id": "unparseable", "error": "bad", "type": "invalid_tool_call"}])


# Each mistake is derived from the correct call, the way a weak model's mistakes are: one thing wrong at a time.
MISTAKES = [
    lambda a: Step("author_legal_requirement", {k: v for k, v in a.items() if k != "title"}),                                      # missing argument
    lambda a: Step("author_legal_requirement", {**a, "operative_claim_ids": a["operative_claim_ids"][0]}),                           # list sent as a string
    lambda a: Step("author_legal_requirement", {**a, "qualifier_claim_ids": ["e" * 64]}),                                            # invented claim ID
    lambda a: Step("author_legal_requirement", {**a, "qualifier_claim_ids": [a["applicability_claim_ids"][0]]}),                     # right claim, wrong role field
    lambda a: Step("author_legal_requirement", {**a, "operative_claim_ids": []}),                                                    # no operative proposition
    lambda a: Step("author_requirement", a, message=unknown_tool),                                                                   # tool that does not exist
    lambda a: Step("author_legal_requirement", {}, message=unparseable),                                                             # arguments that are not JSON
    lambda a: Step("author_legal_requirement", {**a, "operative_claim_ids": a["operative_claim_ids"] * 2}),                          # duplicate IDs
    lambda a: Step("author_legal_requirement", {**a, "bogus": True}),                                                                # unknown argument
]


def test_a_model_that_keeps_making_mistakes_still_reaches_a_validated_submission(tmp_path, monkeypatch):
    _, ctx, _, api = H.restore(FX)
    events: list = []
    steps = [Step("start_rule_authoring", {})]
    for index, row in enumerate(PLAN48):
        good = args_of(row)
        for attempt in range(1 + (index % 2 == 0)):
            steps.append(MISTAKES[(index + 4 * attempt) % len(MISTAKES)](good))
        steps.append(Step("author_legal_requirement", good, check=lambda c, r, v, t, k=row[0]: r["outcome"] == "PASSED" or pytest.fail(f"{k}: {r}")))
    rule_mistakes = [
        {"assessment_rule_id": "AR-bad", "concept": "c", "legal_requirement_ids": ["R-does-not-exist"]},
        {"assessment_rule_id": "AR-bad", "legal_requirement_ids": ["x"]},
        {"assessment_rule_id": "AR-bad", "concept": "c", "legal_requirement_ids": "R1-export"},
        {"assessment_rule_id": "AR-bad", "concept": "c", "legal_requirement_ids": []},
    ]
    for index, row in enumerate(PLAN48):
        if any(CL[full(p)]["assessability"] in {"EXTERNAL_FULFILLMENT", "NON_ASSESSABLE"} for p in row[1]):
            continue
        if index < len(rule_mistakes):
            steps.append(Step("author_assessment_rule", rule_mistakes[index]))
        steps.append(Step("author_assessment_rule", {"assessment_rule_id": f"AR-{row[0]}", "concept": row[0], "legal_requirement_ids": [row[0]]},
                          check=lambda c, r, v, t: r["outcome"] == "PASSED" or pytest.fail(str(r))))
    steps.append(Step("validate_compliance_rule_set", {}, check=lambda c, r, v, t: r["outcome"] == "PASSED" or pytest.fail(json.dumps(r)[:600])))
    steps.append(Step("submit_compliance_rule_set", {}))
    probe = run_script(ctx, steps, tmp_path, monkeypatch, events=events, max_turns=200)

    rejections = [e["data"] for e in events if e.get("data", {}).get("activity_kind") == "RULE_AUTHORING_TOOL_REJECTED"]
    assert len(rejections) >= 14, f"the scripted model must be worse than the live run's 12 rejections, got {len(rejections)}"
    assert len(rejections) == len(ctx.rejection_log), "every rejection, including the ones refused before any tool body, reached the durable stream"
    assert not ctx.authoring.outstanding, "every rejection was resolved by a corrected call"
    assert {r["resolution"] for r in ctx.authoring.resolved} <= {"CORRECTED", "REPLACED_BY_LATER_REJECTION"}
    layers = {r["rejection"]["rejectionLayer"] for r in rejections}
    sources = {r["rejection"]["rejectionSource"] for r in rejections}
    assert layers == {"TOOL_SCHEMA", "AUTHORING_PRECONDITION"} and {"TOOL_PREFLIGHT", "FRAMEWORK_UNKNOWN_TOOL", "FRAMEWORK_UNPARSEABLE_ARGUMENTS"} <= sources
    # authoring reached everything the live run never did
    assert len(ctx.draft["legalRequirements"]) == 16 and len(ctx.draft["assessmentRules"]) == 13
    kinds = [e["data"]["activity_kind"] for e in events if e.get("data", {}).get("activity_kind", "").startswith("RULE_VALIDATION_")]
    assert kinds == ["RULE_VALIDATION_STARTED", "RULE_VALIDATION_PASSED"], kinds
    assert ctx.validation_calls == 1, "a rejected authoring call is never a Rule validator attempt"
    assert api.submitted is not None and api.submitted["claimInventory"]["fingerprint"] == FROZEN_FINGERPRINT



# --- compaction stress -------------------------------------------------------------------------------------------------------
def test_an_unresolved_rejection_outlives_history_compaction_and_the_correction_still_succeeds(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    target = args_of(PLAN48[0], "R-target")
    bad = {**target, "operative_claim_ids": ["d" * 64]}
    seen: dict[str, Any] = {}

    def rejected(c, r, v, t):
        assert r["outcome"] == "FAILED"
        seen["raw_feedback"] = "Unknown claim ID" in "".join(text_of(m) for m in v if isinstance(m, ToolMessage))

    def still_visible(c, r, v, t):
        digest = digest_of(v)
        assert BLOCK in digest and "CLAIM_REQUIREMENT_MISMATCH" in digest and "operative_claim_ids[0]" in digest, "the rejection left the model's view while unresolved"
        seen["raw_feedback"] = "Unknown claim ID" in "".join(text_of(m) for m in v if isinstance(m, ToolMessage))

    fillers = [Step("author_legal_requirement", args_of(PLAN48[i]), check=still_visible) for i in (1, 2, 3, 4)]
    fillers += [Step("get_claim_inventory", {"kind": "CLAIMS", "limit": 20, "offset": 20 * i}, check=still_visible) for i in range(3)]
    fillers += [Step("get_rule_authoring_context", {}, check=still_visible)]

    def fixed(c, r, v, t):
        assert r["outcome"] == "PASSED" and not c.authoring.outstanding and BLOCK not in digest_of(v)
        assert c.authoring.resolved[-1]["resolution"] == "CORRECTED" and "R-target" in c.draft["legalRequirements"]

    steps = [Step("start_rule_authoring", {}), Step("author_legal_requirement", bad, check=rejected), *fillers, Step("author_legal_requirement", target, check=fixed)]
    run_script(ctx, steps, tmp_path, monkeypatch)
    assert seen["raw_feedback"] is False, "compaction must actually have dropped the raw rejection message, otherwise this proves nothing"


# --- rebuilt graph / new transcript ---------------------------------------------------------------------------------------------
def test_an_unresolved_rejection_survives_a_rebuilt_agent_graph_a_summarized_transcript_and_a_provider_retry(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    target = args_of(PLAN48[0], "R-target")
    bad = {**target, "applicability_claim_ids": [next(cid for cid, c in CL.items() if c["claimType"] == "CONTEXT")]}  # a context claim offered as applicability
    run_script(ctx, [Step("start_rule_authoring", {}), Step("author_legal_requirement", bad)], tmp_path, monkeypatch)
    assert list(ctx.authoring.outstanding) == ["author_legal_requirement:R-target"]

    # (1) summarization replaced the whole transcript with one summary message: the next request still carries the rejection
    summarized = DraftHistoryMiddleware(ctx)._view([HumanMessage(content="Summary of earlier work: Requirements were being authored.")])
    assert BLOCK in digest_of(summarized) and "CLAIM_REQUIREMENT_MISMATCH" in digest_of(summarized)

    # (2) a brand-new agent graph and an empty transcript over the same run context (nothing carried over but the run state)
    def reread(c, r, v, t):
        assert BLOCK in digest_of(v) and "applicability_claim_ids[0]" in digest_of(v)
        assert [x["rejectionCode"] for x in r["outstandingRejections"]] == ["CLAIM_REQUIREMENT_MISMATCH"]
        assert "Repair the unresolved author_legal_requirement rejection" in r["nextValidActions"][0]

    def fixed(c, r, v, t):
        assert r["outcome"] == "PASSED" and not c.authoring.outstanding and BLOCK not in digest_of(v)

    good = dict(target)
    run_script(ctx, [Step("get_rule_authoring_status", {}, check=reread), Step("author_legal_requirement", good, check=fixed)], tmp_path, monkeypatch)


def test_the_preparation_graph_is_claim_once_so_an_agent_process_restart_has_no_checkpoint_to_resume(tmp_path):
    """Boundary, pinned: nothing resumes an in-flight Rule Set Preparation run, so 'restart' means a rebuilt graph over live run state."""
    _, ctx, _, _ = H.restore(FX)
    from authoring_memory_harness import ViewDrivenModel
    graph = create_rule_set_preparation_agent(context=ctx, legal_source_root=tmp_path, model=ViewDrivenModel(policy=lambda v, m: AIMessage(content="")))
    assert not getattr(graph, "checkpointer", None)


# --- no-progress paths ------------------------------------------------------------------------------------------------------------
def test_path_a_recovery_never_terminates_even_when_each_attempt_fixes_a_different_missing_argument(tmp_path, monkeypatch):
    """invalid -> feedback -> a different mistake -> feedback -> corrected -> progress. Different missing fields are different gaps."""
    _, ctx, _, _ = H.restore(FX)
    good = args_of(PLAN48[0], "R-a")
    steps = [Step("start_rule_authoring", {}),
             Step("author_legal_requirement", {k: v for k, v in good.items() if k != "title"}),
             Step("author_legal_requirement", {k: v for k, v in good.items() if k != "applicability_claim_ids"}),
             Step("author_legal_requirement", {k: v for k, v in good.items() if k != "operative_claim_ids"}),
             Step("author_legal_requirement", good, check=lambda c, r, v, t: r["outcome"] == "PASSED" or pytest.fail(str(r)))]
    probe = run_script(ctx, steps, tmp_path, monkeypatch)
    assert "NO_PROGRESS" not in "".join(t or "" for t in probe.texts), "three different missing arguments are not stagnation"
    assert "R-a" in ctx.draft["legalRequirements"]


def test_path_b_the_same_invalid_call_repeated_with_an_unchanged_draft_is_stagnation(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    stuck = {k: v for k, v in args_of(PLAN48[0], "R-stuck").items() if k != "title"}
    texts: list[str] = []
    steps = [Step("start_rule_authoring", {}), *[Step("author_legal_requirement", stuck, check=lambda c, r, v, t: texts.append(t or "")) for _ in range(5)]]
    with pytest.raises(NoProgressDetected):
        run_script(ctx, steps, tmp_path, monkeypatch)
    assert len(texts) == 2, "rejection, then ONE explicit no-progress warning, then termination on the third identical attempt"
    assert "NO_PROGRESS" not in texts[0] and "NO_PROGRESS" in texts[1]
    assert not ctx.draft["legalRequirements"], "stagnation changed nothing"


def test_path_b_also_applies_to_a_repeated_call_to_a_tool_that_does_not_exist(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    steps = [Step("start_rule_authoring", {}), *[Step("author_requirement", args_of(PLAN48[0]), message=unknown_tool) for _ in range(6)]]
    with pytest.raises(NoProgressDetected):
        run_script(ctx, steps, tmp_path, monkeypatch)
    assert len(ctx.rejection_log) == 3 and {e["rejectionSource"] for e in ctx.rejection_log} == {"FRAMEWORK_UNKNOWN_TOOL"}


def test_feedback_for_an_identical_invalid_call_is_identical_every_time(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    bad = {**args_of(PLAN48[0], "R-same"), "operative_claim_ids": ["c" * 64]}
    seen: list[dict] = []
    steps = [Step("start_rule_authoring", {}), *[Step("author_legal_requirement", bad, check=lambda c, r, v, t: seen.append(r)) for _ in range(2)],
             Step("author_legal_requirement", args_of(PLAN48[0], "R-same"))]
    run_script(ctx, steps, tmp_path, monkeypatch)
    assert json.dumps(seen[0]["gaps"], sort_keys=True) == json.dumps(seen[1]["gaps"], sort_keys=True) and seen[0]["requiredAction"] == seen[1]["requiredAction"]
    assert "NO_PROGRESS" not in seen[0] and "NO_PROGRESS" in seen[1]


# --- ordering telemetry and the Requirement-count dip -------------------------------------------------------------------------------
def test_events_are_ordered_by_sequence_and_the_requirement_count_only_falls_through_an_explicit_removal(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    events: list = []
    r1, r2 = args_of(PLAN48[0], "R1"), args_of(PLAN48[1], "R2")
    steps = [Step("start_rule_authoring", {}),
             Step("author_legal_requirement", r1), Step("author_legal_requirement", r2),
             Step("author_legal_requirement", {**r2, "operative_claim_ids": ["b" * 64]}),                                  # rejected: nothing moves
             Step("author_legal_requirement", {**r1, "title": "R1 renamed"}),                                                # replacement: same count, new revision
             Step("remove_rule_candidate", {"kind": "LEGAL_REQUIREMENT", "candidate_id": "R2", "reason": "re-author it"}),   # the ONLY way the count falls
             Step("author_legal_requirement", r2),
             Step("author_legal_requirement", r2),                                                                           # identical resend: idempotent
             Step("get_rule_authoring_status", {})]
    probe = run_script(ctx, steps, tmp_path, monkeypatch, events=events)
    every = [e["data"] for e in events if "event_sequence" in e.get("data", {}) or "eventSequence" in e.get("data", {})]
    sequences = [d.get("event_sequence") or d.get("eventSequence") for d in every]
    assert sequences == sorted(set(sequences)) and len(sequences) > 20, "one strictly increasing sequence across every authoring event kind, context telemetry included"
    data = [d for d in every if "event_sequence" in d]
    counts = [d["requirement_count"] for d in data if d["activity_kind"] == "CLAIM_PHASE_TRANSITION" and d["phase"] == "RULE_AUTHORING"]
    revisions = [d["draft_revision"] for d in data if d["activity_kind"] == "CLAIM_PHASE_TRANSITION" and d["phase"] == "RULE_AUTHORING"]
    # transitions after: start(READY->AUTHORING), R1, R2, replace R1, remove R2, re-add R2, identical resend of R2 (a no-op success still transitions)
    assert counts[-6:] == [1, 2, 2, 1, 2, 2] and revisions[-6:] == [1, 2, 3, 4, 5, 5]
    falls = [(a, b) for a, b in zip(counts, counts[1:]) if b < a]
    assert len(falls) == 1, "the live run's 10 -> 9 -> 10 dip is an explicit remove_rule_candidate followed by a re-author, never a side effect"
    context_events = [d for d in every if d["activity_kind"] == "RULE_AUTHORING_CONTEXT"]
    assert context_events and all({"eventSequence", "modelTurn", "draftRevision", "draftFingerprint", "requirementCount", "assessmentRuleCount", "frozenInventoryRevision"} <= set(d)
                                  for d in context_events)
    fall = next(d for d in context_events if d["requirementCount"] == 1 and d["lastMutationTool"] == "remove_rule_candidate")
    assert fall["draftRevision"] == 5 - 1 and fall["draftFingerprint"] != next(d for d in context_events if d["requirementCount"] == 2)["draftFingerprint"]
    assert draft_fingerprint(ctx.draft) == ctx.draft_fp
    assert probe.results[-1]["requirements"]["total"] == 2


# --- the Requirement -> AssessmentRule handoff ----------------------------------------------------------------------------------------
def test_the_model_always_sees_which_requirements_still_need_an_assessment_rule(tmp_path, monkeypatch):
    _, ctx, _, _ = H.restore(FX)
    r1 = args_of(PLAN48[0], "R1")
    external = {"requirement_key": "R-ext", "title": "performed outside", "operative_claim_ids": [next(cid for cid, c in CL.items() if c["assessability"] == "EXTERNAL_FULFILLMENT" and c["operative"])], "applicability_claim_ids": [], "non_assessable_reason": "outside the repository"}

    def before_rule(c, r, v, t):
        digest = digest_of(v)
        assert r["requirements"] == {**r["requirements"], "total": 2, "assessable": 1, "nonAssessable": 1, "withoutRule": 1}
        assert f"- R1 | {PLAN48[0][0]} | NEEDS AssessmentRule" in digest and "- R-ext | performed outside | non-assessable" in digest
        assert any("author_assessment_rule for the 1 assessable Requirement(s) without a rule: R1" in action for action in r["nextValidActions"])

    def after_rule(c, r, v, t):
        assert r["requirements"]["withoutRule"] == 0 and f"- R1 | {PLAN48[0][0]} | rules: AR-1" in digest_of(v)
        assert r["assessmentRules"] == {"total": 1, "ids": ["AR-1"]}

    steps = [Step("start_rule_authoring", {}), Step("author_legal_requirement", r1), Step("author_legal_requirement", external),
             Step("get_rule_authoring_status", {}, check=before_rule),
             Step("author_assessment_rule", {"assessment_rule_id": "AR-1", "concept": "c", "legal_requirement_ids": ["R1"]}),
             Step("get_rule_authoring_status", {}, check=after_rule)]
    run_script(ctx, steps, tmp_path, monkeypatch)
