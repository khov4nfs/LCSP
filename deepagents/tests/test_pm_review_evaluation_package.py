"""Pending seven-case review inputs must never be presented as legal/model acceptance."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

from rule_set_preparation.eval_cli import main
from rule_set_preparation.reviewed_eval_gate import PM_REVIEW_CASE_IDS, reviewed_case_package_preflight, paired_eval_preflight, reviewed_cases_in_aggregate_gold
from test_reviewed_eval_gate import inputs

PACKAGE = Path(__file__).resolve().parents[1] / "evals/fixtures/lcsp347_pm_review_package.pending.json"


def test_all_seven_reported_cases_are_pending_without_invented_sources_or_gold():
    raw = PACKAGE.read_bytes()
    package = json.loads(raw)
    assert {row["caseId"] for row in package["cases"]} == set(PM_REVIEW_CASE_IDS)
    contract = PACKAGE.parents[3] / "packages/contracts/src/compliance-rule-set/development-review-cases.ts"
    assert all(identity in contract.read_text(encoding="utf-8") for identity in PM_REVIEW_CASE_IDS)
    assert all(row["sourceText"] is None and row["independentReviewerId"] is None and row["gold"] is None for row in package["cases"])
    errors = reviewed_case_package_preflight(package, raw, sha256(raw).hexdigest())
    assert "PM_REVIEW_PACKAGE_INDEPENDENT_APPROVAL_REQUIRED" in errors
    assert len([error for error in errors if error.startswith("PM_REVIEW_CASE_EVIDENCE_REQUIRED:")]) == 7
    assert len([error for error in errors if error.startswith("PM_REVIEW_CONTROL_REQUIRED:")]) == 3
    assert "PM_MODEL_EVALUATION_AUTHORIZATION_REQUIRED" in errors


def test_preflight_cli_stops_at_external_review_inputs_without_model_or_gold_files(capsys):
    result = main(["--preflight-only", "--review-package", str(PACKAGE)])
    report = json.loads(capsys.readouterr().out)
    assert result == 4
    assert report["status"] == "BLOCKED_EXTERNAL_REVIEW_INPUT"
    assert report["paidModelCalls"] == 0 and report["modelEvaluation"] == "NOT_RUN"
    assert "PM_REVIEW_PACKAGE_EXTERNAL_DIGEST_REQUIRED" in report["blockingReasons"]


def test_paired_comparison_rejects_changed_model_source_and_synthetic_runtime():
    _, _, _, baseline = inputs()
    candidate = deepcopy(baseline)
    candidate["model"] = {"configuredModelId": "different-model"}
    candidate["sourcePins"] = {"legalSourceVersionId": "different-source"}
    candidate["instructionBundle"] = {"id": "test", "approvalIdentity": "TEST_ONLY_OFFLINE_REVIEWER", "approvalRevision": "TEST_ONLY_R1", "enRuntimeBundleDigest": "a" * 64}
    errors = paired_eval_preflight(baseline, candidate)
    assert "PAIRED_EVAL_IDENTITY_MISMATCH:model" in errors
    assert "PAIRED_EVAL_IDENTITY_MISMATCH:sourcePins" in errors
    assert "PAIRED_EVAL_APPROVED_RUNTIME_REQUIRED" in errors
    assert "PAIRED_EVAL_INSTRUCTION_BUNDLE_MISMATCH" in errors


def test_paired_comparison_cannot_omit_actual_billing_holdout_or_rubric():
    _, _, _, baseline = inputs()
    package = json.loads(PACKAGE.read_bytes())
    errors = paired_eval_preflight(baseline, deepcopy(baseline), package)
    assert "PAIRED_EVAL_PROVIDER_BILLING_EVIDENCE_REQUIRED" in errors
    assert "PAIRED_EVAL_AUTHORIZED_MODEL_MISMATCH" in errors


def test_paired_comparison_does_not_hide_cost_above_authorized_budget():
    _, _, _, baseline = inputs()
    package = {"cases": [], "evaluationAuthorization": {"maximumProviderCost": 1, "budgetCurrency": "USD"}}
    errors = paired_eval_preflight(baseline, deepcopy(baseline), package)
    assert "PAIRED_EVAL_AUTHORIZED_BUDGET_EXCEEDED" in errors


def test_reviewed_case_cannot_be_omitted_from_the_scored_holdout():
    gold, _, _, _ = inputs()
    package = {"cases": [{"caseId": PM_REVIEW_CASE_IDS[0], "gold": deepcopy(gold)}], "controls": {}}
    aggregate = deepcopy(gold)
    aggregate["normativeClaims"] = []
    assert "PM_REVIEW_AGGREGATE_GOLD_CASE_MISSING:" + PM_REVIEW_CASE_IDS[0] + ":normativeClaims" in reviewed_cases_in_aggregate_gold(package, aggregate)
