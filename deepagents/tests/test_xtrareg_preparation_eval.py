"""XTRAREG (IEEE RE 2025) semantic chain, coverage, grounding, and holdout regression tests."""

from __future__ import annotations

import copy
import json
from hashlib import sha256
from pathlib import Path
from typing import Any

import pytest
from rule_set_preparation.eval_cli import main as eval_cli_main
from rule_set_preparation.xtrareg_eval import (
    compare_direct_draft_vs_preparation,
    evaluate_xtrareg_chain,
    validate_xtrareg_gold_dataset,
)

FIXTURES = Path(__file__).resolve().parents[1] / "evals" / "fixtures"
GOLD_PATH = FIXTURES / "xtrareg_gdpr_gold_v1.json"
SOURCE_PATH = FIXTURES / "xtrareg_gdpr_source_v1.json"


def test_changed_action_requires_review():
    gold, source = _load_gold_and_source()
    candidate = _build_smoke_test_full_prep_from_gold(gold)
    candidate["semanticGraph"]["claims"][0]["operative"]["action"] = "sell personal data"

    report = evaluate_xtrareg_chain(gold, source, candidate)

    assert report["splits"]["ALL"]["classifications"]["full"] == 29
    assert "ACTION_REVIEW_REQUIRED" in report["failedCases"][0]["errorCodes"]


def test_self_declared_review_cannot_unlock_paired_acceptance(tmp_path, capsys):
    gold, source = _load_gold_and_source()
    gold["goldApprovalStatus"] = "INDEPENDENTLY_REVIEWED"
    inputs = {
        "gold": gold,
        "source": source,
        "candidate": _build_smoke_test_full_prep_from_gold(gold),
        "direct-draft": _build_smoke_test_direct_draft_from_gold(gold, drop_cross_clause_exceptions=True),
    }
    args = []
    for name, data in inputs.items():
        path = tmp_path / (name + ".json")
        path.write_text(json.dumps(data), encoding="utf-8")
        args.extend([f"--xtrareg-{name}", str(path)])

    assert eval_cli_main(args) == 2
    report = json.loads(capsys.readouterr().out)
    assert report["fullPreparation"]["passedCriticalGate"] is False
    assert report["semanticGainClaimed"] is False
    assert report["reviewedEvidenceGate"]["status"] == "BLOCKED"
    assert report["inputProvenance"] == {
        f"{key}Sha256": sha256((tmp_path / f"{name}.json").read_bytes()).hexdigest()
        for key, name in (("gold", "gold"), ("source", "source"),
                          ("candidate", "candidate"), ("directDraft", "direct-draft"))
    }


def test_negated_exception_and_conflicting_duplicate_require_review():
    gold, source = _load_gold_and_source()
    candidate = _build_smoke_test_direct_draft_from_gold(gold)
    row = next(row for row in candidate["candidates"] if row["exceptions"])
    duplicate = copy.deepcopy(row)
    duplicate["candidateId"] = "conflicting-duplicate"
    duplicate["action"] = "sell personal data"
    candidate["candidates"].append(duplicate)
    row["exceptions"][0] = "not " + row["exceptions"][0]

    report = evaluate_xtrareg_chain(gold, source, candidate)

    errors = {code for row in report["failedCases"] for code in row["errorCodes"]}
    assert {"ACTION_REVIEW_REQUIRED", "MISSING_EXCEPTION", "DUPLICATE_PREDICTION"} <= errors


def test_valid_citation_to_unrelated_evidence_does_not_receive_full_credit():
    gold, source = _load_gold_and_source()
    candidate = _build_smoke_test_full_prep_from_gold(gold)
    claim = candidate["semanticGraph"]["claims"][0]
    other = gold["obligations"][1]["citation"]
    claim["sourceNodeIds"] = other["sourceNodeIds"]
    claim["sourceQuote"] = other["sourceQuote"]
    candidate["semanticGraph"]["claims"][1]["sourceQuote"] = "quote outside the pinned source"

    report = evaluate_xtrareg_chain(gold, source, candidate)

    assert any(
        case["obligationId"] == claim["obligationId"]
        and "CITATION_REVIEW_REQUIRED" in case["errorCodes"]
        for case in report["failedCases"]
    )
    metrics = report["splits"]["ALL"]["metrics"]
    assert metrics["citationIntegrityRate"] == pytest.approx(29 / 30)
    assert metrics["semanticGroundingRate"] is None
    assert metrics["groundingReviewRequiredCount"] == 29


def test_chain_coverage_counts_missed_assessable_gold():
    gold, source = _load_gold_and_source()
    candidate = _build_smoke_test_full_prep_from_gold(gold)
    assessable = [
        item for item in gold["obligations"]
        if item["split"] == "HOLDOUT" and item["expectedAssessmentRule"]["expectedAssessable"]
    ]
    missed_id = assessable[0]["obligationId"]
    candidate["semanticGraph"]["claims"] = [
        claim for claim in candidate["semanticGraph"]["claims"] if claim["obligationId"] != missed_id
    ]

    holdout = evaluate_xtrareg_chain(gold, source, candidate)["splits"]["HOLDOUT"]

    assert holdout["denominators"]["expectedAssessableGoldObligations"] == len(assessable)
    assert holdout["denominators"]["matchedAssessableGoldObligations"] == len(assessable) - 1
    assert holdout["metrics"]["matchedAssessableToRulesRate"] == 1.0
    assert holdout["metrics"]["endToEndAssessableRuleCoverage"] == pytest.approx(
        (len(assessable) - 1) / len(assessable)
    )


def test_paired_comparison_requires_source_identity():
    gold, source = _load_gold_and_source()
    direct = _build_smoke_test_direct_draft_from_gold(gold)
    del direct["legalSourceVersionId"]
    preparation = _build_smoke_test_full_prep_from_gold(gold)

    with pytest.raises(ValueError, match="XTRAREG_SOURCE_VERSION_IDENTITY_FAILED"):
        compare_direct_draft_vs_preparation(gold, source, direct, preparation)


def test_holdout_rejects_dev_content_under_another_source_id():
    gold, source = _load_gold_and_source()
    dev = next(item for item in gold["obligations"] if item["split"] == "DEV")
    duplicate_id = "aliased-dev-source"
    original = next(row for row in source["nodes"] if row["nodeId"] == dev["citation"]["sourceNodeIds"][0])
    source["nodes"].append({**original, "nodeId": duplicate_id})
    held_out = next(item for item in gold["obligations"] if item["split"] == "HOLDOUT")
    held_out["citation"] = {**dev["citation"], "sourceNodeIds": [duplicate_id]}

    errors = validate_xtrareg_gold_dataset(gold, source)

    assert "XTRAREG_SPLIT_SOURCE_CONTENT_OVERLAP" in errors


def _load_gold_and_source() -> tuple[dict[str, Any], dict[str, Any]]:
    return (
        json.loads(GOLD_PATH.read_text(encoding="utf-8")),
        json.loads(SOURCE_PATH.read_text(encoding="utf-8")),
    )


# ---------------------------------------------------------------------------
# P0-01: Smoke-test fixture builders — clearly labeled as scorer arithmetic
# validation only, NOT evidence of agent quality.
# ---------------------------------------------------------------------------

def _build_smoke_test_full_prep_from_gold(gold: dict[str, Any]) -> dict[str, Any]:
    """Builds a structurally valid FULL_PREPARATION prediction by copying gold fields.

    Business purpose: Smoke-test the scorer's arithmetic correctness only.
    Business rules: Output is derived from gold — it is NOT agent output and cannot
    support any claim about agent quality or semantic gain.
    Execution flow: Copies each gold obligation into claim/requirement/rule triples.
    Failure cases: None — gold is assumed structurally valid.
    Side effects: None; pure in-memory construction.
    """
    claims = []
    reqs = []
    rules = []
    for item in gold["obligations"]:
        oid = item["obligationId"]
        cid = f"claim-{oid}"
        rid = f"req-{oid}"
        claims.append({
            "claimId": cid,
            "obligationId": oid,
            "claimType": item["modality"],
            "sourceNodeIds": item["citation"]["sourceNodeIds"],
            "sourceQuote": item["citation"]["sourceQuote"],
            "operative": {
                "actor": item["actor"],
                "modality": item["modality"],
                "action": item["action"],
            },
            "applicability": item["applicability"],
            "exceptions": item["exceptions"],
        })
        reqs.append({
            "legalRequirementId": rid,
            "operativeClaimIds": [cid],
            "requirementType": item["expectedRequirement"]["requirementType"],
            "applicability": item["applicability"],
            "coverageState": item["expectedRequirement"]["coverageState"],
            "nonAssessableReason": item["expectedAssessmentRule"]["nonAssessableReason"],
        })
        if item["expectedAssessmentRule"]["expectedAssessable"]:
            rules.append({
                "assessmentRuleId": f"rule-{oid}",
                "legalRequirementId": rid,
                "concept": item["action"],
            })
    return {
        "mode": "FULL_PREPARATION",
        "semanticGraph": {
            "legalSourceVersionId": gold["legalSourceVersionId"],
            "claims": claims,
            "relations": [],
        },
        "legalRequirements": reqs,
        "assessmentRules": rules,
    }


def _build_smoke_test_direct_draft_from_gold(
    gold: dict[str, Any],
    *,
    drop_cross_clause_exceptions: bool = False,
    add_duplicate: bool = False,
) -> dict[str, Any]:
    """Builds a structurally valid DIRECT_DRAFT prediction by copying gold fields.

    Business purpose: Smoke-test the scorer's arithmetic correctness and validate
    that deliberate degradation (dropped exceptions, added duplicates) produces
    the expected metric changes.
    Business rules: Output is derived from gold — NOT agent output.  semanticGainClaimed
    must always be False when comparing against this smoke-test fixture.
    Execution flow: Copies each obligation; optionally drops exceptions or adds a duplicate.
    Failure cases: None — gold is assumed structurally valid.
    Side effects: None; pure in-memory construction.
    """
    candidates = []
    rules = []
    for item in gold["obligations"]:
        oid = item["obligationId"]
        cid = f"direct-{oid}"
        exceptions = list(item["exceptions"])
        if drop_cross_clause_exceptions and oid in {"OBL-14", "OBL-15"}:
            exceptions = []
        candidates.append({
            "candidateId": cid,
            "obligationId": oid,
            "sourceNodeIds": item["citation"]["sourceNodeIds"],
            "sourceQuote": item["citation"]["sourceQuote"],
            "actor": item["actor"],
            "modality": item["modality"],
            "action": item["action"],
            "applicability": item["applicability"],
            "exceptions": exceptions,
            "requirementType": item["expectedRequirement"]["requirementType"],
            "coverageState": item["expectedRequirement"]["coverageState"],
            "nonAssessableReason": item["expectedAssessmentRule"]["nonAssessableReason"],
        })
        if item["expectedAssessmentRule"]["expectedAssessable"]:
            rules.append({
                "assessmentRuleId": f"drule-{oid}",
                "legalRequirementId": cid,
                "concept": item["action"],
            })
    if add_duplicate:
        dup = copy.deepcopy(candidates[-1])
        dup["candidateId"] = "direct-DUP"
        candidates.append(dup)
    return {
        "mode": "DIRECT_DRAFT",
        "legalSourceVersionId": gold["legalSourceVersionId"],
        "candidates": candidates,
        "assessmentRules": rules,
    }


# ---------------------------------------------------------------------------
# P0-04: AC1 — gold corpus validation, size/split/provenance invariants
# ---------------------------------------------------------------------------

def test_xtrareg_gold_dataset_meets_ac1_size_split_and_provenance():
    """Gold corpus must meet AC1 invariants (>= 30 annotations, both splits, provenance)."""
    gold, source = _load_gold_and_source()

    # P0-04: The corpus is SYNTHETIC_NOT_REVIEWED — validator must flag the soft warning
    # but NOT block validation of corpus structure (size, splits, citation grounding).
    errors = validate_xtrareg_gold_dataset(gold, source)
    assert "XTRAREG_GOLD_SYNTHETIC_NOT_REVIEWED_ACCEPTANCE_BLOCKED" in errors, (
        "Expected synthetic corpus warning; got: " + repr(errors)
    )
    # Only the acceptance-blocking warning is expected — no structural errors.
    assert all(e == "XTRAREG_GOLD_SYNTHETIC_NOT_REVIEWED_ACCEPTANCE_BLOCKED" for e in errors), (
        "Unexpected structural errors in gold corpus: " + repr(errors)
    )

    assert len(gold["obligations"]) >= 30
    splits = {o["split"] for o in gold["obligations"]}
    assert splits == {"DEV", "HOLDOUT"}
    assert any(o["disagreementLog"] for o in gold["obligations"])

    # Structural integrity: bad quote must be caught regardless of approval status.
    bad_gold = copy.deepcopy(gold)
    bad_gold["obligations"][0]["citation"]["sourceQuote"] = "non-existent quote in pinned source"
    assert "XTRAREG_GOLD_QUOTE_NOT_IN_SOURCE:OBL-01" in validate_xtrareg_gold_dataset(bad_gold, source)

    small_gold = copy.deepcopy(gold)
    small_gold["obligations"] = small_gold["obligations"][:10]
    assert "XTRAREG_GOLD_MINIMUM_30_OBLIGATIONS_REQUIRED" in validate_xtrareg_gold_dataset(small_gold, source)


# ---------------------------------------------------------------------------
# P0-01: Comparison smoke test — scorer arithmetic, not agent quality
# ---------------------------------------------------------------------------

def test_xtrareg_smoke_test_fixtures_scorer_arithmetic_and_no_gain_claim(tmp_path, capsys):
    """Verifies scorer arithmetic using smoke-test fixtures derived from gold.

    Key invariants (P0-01):
    - semanticGainClaimed must be False — these are synthetic inputs, not real agent outputs.
    - The comparison report must clearly state the corpus is SYNTHETIC_NOT_REVIEWED.
    - Structural scorer arithmetic (exception delta, duplicate count) must work correctly.
    """
    gold, source = _load_gold_and_source()
    full_prep = _build_smoke_test_full_prep_from_gold(gold)
    direct_draft = _build_smoke_test_direct_draft_from_gold(
        gold,
        drop_cross_clause_exceptions=True,
        add_duplicate=True,
    )

    comparison = compare_direct_draft_vs_preparation(gold, source, direct_draft, full_prep)

    # P0-01: Synthetic corpus MUST NOT claim semantic gain.
    assert comparison["semanticGainClaimed"] is False, (
        "Smoke-test fixtures derived from gold must never claim semantic gain. "
        "semanticGainClaimed=True would falsely imply the agent improved over direct draft."
    )
    # P0-01: The reason must clearly state the corpus is not independently reviewed.
    assert "SYNTHETIC_NOT_REVIEWED" in comparison["gainAssessmentReason"] or "NOT_EVALUATED" in comparison["gainAssessmentReason"], (
        "gainAssessmentReason must reference synthetic/not-evaluated status. Got: " + comparison["gainAssessmentReason"]
    )

    # Scorer arithmetic must still work correctly even on smoke-test fixtures.
    # Full preparation (copied from gold) should pass the critical gate.
    assert comparison["fullPreparation"]["passedCriticalGate"] is False, (
        "passedCriticalGate is False because corpus is SYNTHETIC_NOT_REVIEWED — "
        "acceptance is always blocked for synthetic corpora regardless of scorer metrics."
    )
    # Direct draft (with dropped exceptions) should have critical errors.
    assert comparison["directDraft"]["splits"]["HOLDOUT"]["criticalErrorCounts"]["MISSING_EXCEPTION"] > 0
    # Exception preservation must be better in full_prep than in degraded direct_draft.
    assert comparison["holdoutDeltas"]["exceptionPreservationDelta"] > 0, (
        "Full preparation (gold-derived) must have better exception preservation than "
        "deliberately degraded direct draft."
    )
    # Duplication must be detected in direct draft.
    assert comparison["directDraft"]["splits"]["HOLDOUT"]["metrics"]["duplicateCount"] == 1

    # CLI round-trip: XTRAREG mode must succeed (exit 2 because passedCriticalGate=False for synthetic corpus).
    cand_path = tmp_path / "full_prep.json"
    direct_path = tmp_path / "direct_draft.json"
    cand_path.write_text(json.dumps(full_prep), encoding="utf-8")
    direct_path.write_text(json.dumps(direct_draft), encoding="utf-8")

    rc = eval_cli_main([
        "--xtrareg-gold", str(GOLD_PATH),
        "--xtrareg-source", str(SOURCE_PATH),
        "--xtrareg-candidate", str(cand_path),
        "--xtrareg-direct-draft", str(direct_path),
    ])
    # Exit 2: passedCriticalGate=False (synthetic corpus blocks acceptance).
    assert rc in {0, 2}, f"eval_cli must exit 0 or 2 for XTRAREG mode, got {rc}"
    cli_report = json.loads(capsys.readouterr().out)
    assert cli_report["schemaVersion"] == "XTRAREG_MODE_COMPARISON_V1"
    # CLI must also report semanticGainClaimed=False for synthetic corpus.
    assert cli_report["semanticGainClaimed"] is False


# ---------------------------------------------------------------------------
# AC2: Critical regression detection
# ---------------------------------------------------------------------------

def test_xtrareg_ac2_critical_regressions_ungrounded_exception_modality_and_missing():
    """AC2: Critical regressions (UNGROUNDED_OBLIGATION, MISSING_EXCEPTION, MODALITY_INVERSION,
    MISSING_OBLIGATION) must all be detected and must fail the critical gate."""
    gold, source = _load_gold_and_source()
    mutated = _build_smoke_test_full_prep_from_gold(gold)

    # 1. Ungrounded obligation
    mutated["semanticGraph"]["claims"].append({
        "claimId": "claim-UNGROUNDED",
        "claimType": "DUTY",
        "sourceNodeIds": ["gdpr::art-999-fabricated"],
        "sourceQuote": "fabricated clause",
        "operative": {"actor": "Controller", "modality": "DUTY", "action": "do something fabricated"},
    })
    # 2. Missing exception on OBL-15 (holdout)
    for claim in mutated["semanticGraph"]["claims"]:
        if claim.get("obligationId") == "OBL-15":
            claim["exceptions"] = []
        # 3. Modality inversion on OBL-09 (permission -> duty)
        if claim.get("obligationId") == "OBL-09":
            claim["claimType"] = "DUTY"
            claim["operative"]["modality"] = "DUTY"
    # 4. Missing obligation OBL-25
    mutated["semanticGraph"]["claims"] = [
        c for c in mutated["semanticGraph"]["claims"] if c.get("obligationId") != "OBL-25"
    ]

    report = evaluate_xtrareg_chain(gold, source, mutated)
    assert report["passedCriticalGate"] is False
    crit = report["splits"]["ALL"]["criticalErrorCounts"]
    assert crit["UNGROUNDED_OBLIGATION"] == 1
    assert crit["MISSING_EXCEPTION"] == 1
    assert crit["MODALITY_INVERSION"] == 1
    assert crit["MISSING_OBLIGATION"] == 1
    failed_ids = {row["obligationId"] for row in report["failedCases"]}
    assert {"claim-UNGROUNDED", "OBL-15", "OBL-09", "OBL-25"}.issubset(failed_ids)


# ---------------------------------------------------------------------------
# AC3: Partial/duplication/actor/applicability metrics and no unproven gain
# ---------------------------------------------------------------------------

def test_xtrareg_ac3_partial_duplication_actor_applicability_and_no_unproven_gain():
    """AC3: Partial classification, metric denominators, actor/applicability accuracy,
    and requirementsToRulesRate must all be computed correctly.
    A regressed or equal candidate must never claim semantic gain."""
    gold, source = _load_gold_and_source()
    baseline = _build_smoke_test_direct_draft_from_gold(gold)
    regressed = _build_smoke_test_full_prep_from_gold(gold)

    # Introduce actor mismatch + applicability drift + missing AssessmentRule on holdout obligations -> PARTIAL
    for claim in regressed["semanticGraph"]["claims"]:
        if claim.get("obligationId") == "OBL-21":
            claim["operative"]["actor"] = "Processor"
        if claim.get("obligationId") == "OBL-23":
            claim["applicability"] = {"mode": "UNCONDITIONAL", "conditions": []}
    for req in regressed["legalRequirements"]:
        if req["legalRequirementId"] == "req-OBL-23":
            req["applicability"] = {"mode": "UNCONDITIONAL", "conditions": []}
    regressed["assessmentRules"] = [
        r for r in regressed["assessmentRules"] if r["legalRequirementId"] != "req-OBL-17"
    ]

    report = evaluate_xtrareg_chain(gold, source, regressed)
    holdout = report["splits"]["HOLDOUT"]
    assert holdout["denominators"]["totalGoldObligations"] == 16
    # P0-05 structural classification:
    # - OBL-21 (actor mismatch: Controller→Processor) → INCORRECT (actor invariant is a hard blocker)
    # - OBL-17 (missing AssessmentRule) → PARTIAL
    # - OBL-23 (applicability drift) → PARTIAL
    assert holdout["classifications"]["partial"] == 2
    assert holdout["classifications"]["incorrect"] == 1
    assert holdout["metrics"]["actorAccuracy"] < 1.0
    assert holdout["metrics"]["applicabilityAccuracy"] < 1.0
    assert holdout["metrics"]["requirementsToRulesRate"] < 1.0

    # Equal/worse candidate vs baseline must never claim semantic gain (P0-01, P1-05).
    comparison = compare_direct_draft_vs_preparation(gold, source, baseline, regressed)
    assert comparison["semanticGainClaimed"] is False
    assert "NOT_EVALUATED" in comparison["gainAssessmentReason"]
