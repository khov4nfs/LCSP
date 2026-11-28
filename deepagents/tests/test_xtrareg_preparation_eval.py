"""XTRAREG (IEEE RE 2025) semantic chain, coverage, grounding, and holdout regression tests."""

from __future__ import annotations

import copy
import json
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


def _load_gold_and_source() -> tuple[dict[str, Any], dict[str, Any]]:
    return (
        json.loads(GOLD_PATH.read_text(encoding="utf-8")),
        json.loads(SOURCE_PATH.read_text(encoding="utf-8")),
    )


def _build_full_preparation_from_gold(gold: dict[str, Any]) -> dict[str, Any]:
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


def _build_direct_draft_from_gold(
    gold: dict[str, Any],
    *,
    drop_cross_clause_exceptions: bool = False,
    add_duplicate: bool = False,
) -> dict[str, Any]:
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


def test_xtrareg_gold_dataset_meets_ac1_size_split_and_provenance():
    gold, source = _load_gold_and_source()
    assert validate_xtrareg_gold_dataset(gold, source) == []
    assert len(gold["obligations"]) >= 30
    splits = {o["split"] for o in gold["obligations"]}
    assert splits == {"DEV", "HOLDOUT"}
    assert any(o["disagreementLog"] for o in gold["obligations"])

    bad_gold = copy.deepcopy(gold)
    bad_gold["obligations"][0]["citation"]["sourceQuote"] = "non-existent quote in pinned source"
    assert "XTRAREG_GOLD_QUOTE_NOT_IN_SOURCE:OBL-01" in validate_xtrareg_gold_dataset(bad_gold, source)

    small_gold = copy.deepcopy(gold)
    small_gold["obligations"] = small_gold["obligations"][:10]
    assert "XTRAREG_GOLD_MINIMUM_30_OBLIGATIONS_REQUIRED" in validate_xtrareg_gold_dataset(small_gold, source)


def test_xtrareg_full_preparation_chain_and_direct_draft_comparison(tmp_path, capsys):
    gold, source = _load_gold_and_source()
    full_prep = _build_full_preparation_from_gold(gold)
    direct_draft = _build_direct_draft_from_gold(
        gold,
        drop_cross_clause_exceptions=True,
        add_duplicate=True,
    )

    comparison = compare_direct_draft_vs_preparation(gold, source, direct_draft, full_prep)
    assert comparison["fullPreparation"]["passedCriticalGate"] is True
    assert comparison["directDraft"]["passedCriticalGate"] is False
    assert comparison["semanticGainClaimed"] is True
    assert comparison["holdoutDeltas"]["exceptionPreservationDelta"] > 0
    assert comparison["directDraft"]["splits"]["HOLDOUT"]["metrics"]["duplicateCount"] == 1

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
    assert rc == 0
    cli_report = json.loads(capsys.readouterr().out)
    assert cli_report["schemaVersion"] == "XTRAREG_MODE_COMPARISON_V1"
    assert cli_report["semanticGainClaimed"] is True


def test_xtrareg_ac2_critical_regressions_ungrounded_exception_modality_and_missing():
    gold, source = _load_gold_and_source()
    mutated = _build_full_preparation_from_gold(gold)

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


def test_xtrareg_ac3_partial_duplication_actor_applicability_and_no_unproven_gain():
    gold, source = _load_gold_and_source()
    baseline = _build_full_preparation_from_gold(gold)
    regressed = _build_full_preparation_from_gold(gold)

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
    assert holdout["classifications"]["partial"] == 3
    assert holdout["metrics"]["actorAccuracy"] < 1.0
    assert holdout["metrics"]["applicabilityAccuracy"] < 1.0
    assert holdout["metrics"]["requirementsToRulesRate"] < 1.0

    # Equal/worse candidate vs baseline must never claim semantic gain
    comparison = compare_direct_draft_vs_preparation(gold, source, baseline, regressed)
    assert comparison["semanticGainClaimed"] is False
    assert "does not support" in comparison["gainAssessmentReason"]
