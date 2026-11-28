"""Focused tests for LCSP-400's candidate annotations and deterministic scorer."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest
from evals.legal_reasoning.reporting import build_r1_reports
from evals.legal_reasoning.scorer import score_dataset
from evals.legal_reasoning.review_overlay import merge_review_overlay
from evals.legal_reasoning.validation import load_dataset, validate_dataset

DEEPAGENTS = Path(__file__).resolve().parents[1]
PACKAGE = DEEPAGENTS / "evals" / "legal_reasoning"
FIXTURE_PATH = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "legal_reasoning"
    / "synthetic-scorer-fixture.v1.json"
)


def inputs():
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    rubric = json.loads((PACKAGE / "rubric.v1.json").read_text(encoding="utf-8"))
    pins = json.loads((PACKAGE / "source-pins.v1.json").read_text(encoding="utf-8"))
    return fixture, rubric, pins


def candidate_records():
    return load_dataset(PACKAGE / "candidate-cases.v1.jsonl")


def fixture_report(fixture=None):
    fixture = fixture or inputs()[0]
    _, rubric, pins = inputs()
    return score_dataset(fixture["annotations"], fixture["predictions"], rubric, pins)


def synthetic_predictions(fixture, rows):
    return {
        "predictionVersion": fixture["predictions"]["predictionVersion"],
        "evaluationTarget": "SYNTHETIC_SCORER_VERIFICATION",
        "sourceKind": "SYNTHETIC_TEST_FIXTURE",
        "syntheticOnly": True,
        "casePredictions": rows,
    }


def test_candidate_dataset_schema_labels_and_inventory_are_valid():
    records = candidate_records()
    rubric = inputs()[1]
    pins = inputs()[2]

    inventory = validate_dataset(records, rubric, pins)

    assert inventory == {
        "caseCount": 30,
        "uniqueCaseCount": 30,
        "counterfactualPairCount": 4,
        "reviewStatusCounts": {
            "CANDIDATE": 30,
            "INDEPENDENT_REVIEW": 0,
            "REVIEWED": 0,
            "ADJUDICATED": 0,
            "PROVISIONAL": 0,
            "UNCERTAIN": 0,
            "EXCLUDED": 0,
        },
    }
    assert all(not row["reviewers"] for row in records)
    assert all(row["reviewStatus"] == "CANDIDATE" for row in records)


def test_dataset_has_required_primary_dimension_allocation_and_both_stages():
    from collections import Counter

    records = candidate_records()
    primary = Counter(row["primaryDimension"] for row in records)
    stages = Counter(row["stage"] for row in records)

    assert primary == {
        "APPLICABILITY": 6,
        "COMPLIANCE": 6,
        "CONDITIONS": 3,
        "EXCEPTIONS": 3,
        "ACTOR": 4,
        "EVIDENCE_SUFFICIENCY": 4,
        "UNSUPPORTED_CONCLUSION": 4,
    }
    assert stages["RULE_SET_PREPARATION"] > 0
    assert stages["ASSESSMENT_ROOT"] > 0


def test_annotation_labels_and_duplicate_identifiers_are_rejected():
    records = candidate_records()
    rubric, pins = inputs()[1:]

    invalid_label = deepcopy(records)
    invalid_label[0]["expected"]["applicability"]["label"] = "MAYBE"
    with pytest.raises(ValueError, match="ANNOTATION_LABEL_INVALID"):
        validate_dataset(invalid_label, rubric, pins)

    duplicate = deepcopy(records)
    duplicate.append(deepcopy(duplicate[0]))
    with pytest.raises(ValueError, match="ANNOTATION_DUPLICATE_CASE_ID"):
        validate_dataset(duplicate, rubric, pins)


@pytest.mark.parametrize(
    ("field", "value", "error"),
    [
        ("sourceVersion", "CELEX:UNPINNED", "LEGAL_SOURCE_VERSION_MISMATCH"),
        ("sourceUrl", "https://example.invalid/legal.pdf", "LEGAL_SOURCE_URL_MISMATCH"),
        ("citations", ["Article 99"], "LEGAL_CITATION_MISMATCH"),
        ("provisionRefs", ["NO_SUCH_PROVISION"], "LEGAL_PROVISION_REFERENCE_INVALID"),
    ],
)
def test_unpinned_legal_provenance_is_rejected(field, value, error):
    records = candidate_records()
    records[0]["legalSource"][field] = value
    with pytest.raises(ValueError, match=error):
        validate_dataset(records, inputs()[1], inputs()[2])


def test_counterfactual_pairs_are_reciprocal_and_counted_once():
    records = candidate_records()
    paired = [row for row in records if row["counterfactualPair"]]
    assert len(paired) == 8
    assert len({row["counterfactualPair"]["pairId"] for row in paired}) == 4

    records[1]["counterfactualPair"]["counterpartCaseId"] = "missing-case"
    with pytest.raises(ValueError, match="COUNTERFACTUAL_COUNTERPART_MISSING"):
        validate_dataset(records, inputs()[1], inputs()[2])


def test_review_states_require_real_review_metadata_and_reason_codes():
    fixture, rubric, pins = inputs()
    reviewed = deepcopy(fixture["annotations"][:1])
    reviewed[0]["reviewers"][0].pop("identityVerificationRef")
    with pytest.raises(ValueError, match="ANNOTATION_SCHEMA_INVALID"):
        validate_dataset(reviewed, rubric, pins, allow_synthetic_reviews=True)

    excluded = deepcopy(fixture["annotations"][:1])
    excluded[0]["reviewStatus"] = "EXCLUDED"
    with pytest.raises(ValueError, match="EXCLUSION_REASON_REQUIRED"):
        validate_dataset(excluded, rubric, pins, allow_synthetic_reviews=True)

    uncertain = deepcopy(fixture["annotations"][:1])
    uncertain[0]["reviewStatus"] = "UNCERTAIN"
    with pytest.raises(ValueError, match="UNCERTAINTY_REASON_REQUIRED"):
        validate_dataset(uncertain, rubric, pins, allow_synthetic_reviews=True)


def test_unresolved_reviewer_disagreement_remains_provisional_and_unscored():
    fixture, rubric, pins = inputs()
    row = deepcopy(fixture["annotations"][0])
    row["reviewStatus"] = "PROVISIONAL"
    second_reviewer = deepcopy(row["reviewers"][0])
    second_reviewer["reviewerId"] = "SYNTHETIC_FIXTURE_REVIEWER_B"
    second_reviewer["identityVerificationRef"] = "synthetic-fixture-only://reviewer-b"
    second_reviewer["decision"] = "REVISE"
    second_reviewer["dimensionJudgments"] = [
        {
            "dimension": "ACTOR",
            "label": "INCORRECT",
            "priorLabel": "CORRECT",
            "rationale": "Synthetic disagreement only.",
        }
    ]
    row["reviewers"].append(second_reviewer)
    row["reviewerDisagreements"] = [
        {
            "dimension": "ACTOR",
            "reviewerIds": [
                "SYNTHETIC_FIXTURE_REVIEWER_A",
                "SYNTHETIC_FIXTURE_REVIEWER_B",
            ],
            "issue": "Synthetic disagreement for scorer-gate testing.",
            "proposedLabels": [
                {"reviewerId": "SYNTHETIC_FIXTURE_REVIEWER_A", "label": "CORRECT"},
                {"reviewerId": "SYNTHETIC_FIXTURE_REVIEWER_B", "label": "INCORRECT"},
            ],
        }
    ]
    predictions = synthetic_predictions(fixture, fixture["predictions"]["casePredictions"][:1])
    result = score_dataset([row], predictions, rubric, pins)

    assert result["scoringStatus"] == "NOT_SCORED"
    assert result["coverage"]["humanReviewedAnnotationCount"] == 0
    assert result["coverage"]["unresolvedDisagreementCount"] == 1
    assert result["coverage"]["provisionalOrUncertainAnnotationCount"] == 1
    assert result["perDimension"]["ACTOR"]["denominator"] == 0
    assert result["perDimension"]["ACTOR"]["macroF1"] is None


def test_adjudicated_disagreement_is_eligible_only_with_resolution_metadata():
    fixture, rubric, pins = inputs()
    row = deepcopy(fixture["annotations"][0])
    row["reviewStatus"] = "ADJUDICATED"
    second_reviewer = deepcopy(row["reviewers"][0])
    second_reviewer["reviewerId"] = "SYNTHETIC_FIXTURE_REVIEWER_B"
    second_reviewer["identityVerificationRef"] = "synthetic-fixture-only://reviewer-b"
    second_reviewer["decision"] = "REVISE"
    second_reviewer["dimensionJudgments"] = [
        {
            "dimension": "ACTOR",
            "label": "INCORRECT",
            "priorLabel": "CORRECT",
            "rationale": "Synthetic disagreement only.",
        }
    ]
    row["reviewers"].append(second_reviewer)
    row["reviewerDisagreements"] = [
        {
            "dimension": "ACTOR",
            "reviewerIds": [
                "SYNTHETIC_FIXTURE_REVIEWER_A",
                "SYNTHETIC_FIXTURE_REVIEWER_B",
            ],
            "issue": "Synthetic disagreement resolved for scorer-gate testing.",
            "proposedLabels": [
                {"reviewerId": "SYNTHETIC_FIXTURE_REVIEWER_A", "label": "CORRECT"},
                {"reviewerId": "SYNTHETIC_FIXTURE_REVIEWER_B", "label": "INCORRECT"},
            ],
        }
    ]
    row["adjudication"] = {
        "reviewerType": "HUMAN",
        "reviewerId": "SYNTHETIC_FIXTURE_ADJUDICATOR",
        "identityVerificationRef": "synthetic-fixture-only://adjudicator",
        "reviewEvidenceRef": "synthetic-fixture-only://adjudication-record",
        "outcome": "CONFIRM",
        "rationale": "Synthetic resolution control.",
        "adjudicatedAt": "2026-11-28T00:00:00Z",
        "resolvedLabels": [
            {
                "dimension": "ACTOR",
                "label": "CORRECT",
                "rationale": "Synthetic resolution control.",
            }
        ],
    }
    result = score_dataset(
        [row],
        synthetic_predictions(fixture, fixture["predictions"]["casePredictions"][:1]),
        rubric,
        pins,
    )

    assert result["coverage"]["humanReviewedAnnotationCount"] == 0
    assert result["coverage"]["syntheticFixtureAnnotationCount"] == 1
    assert result["coverage"]["unresolvedDisagreementCount"] == 0
    assert result["perDimension"]["ACTOR"]["denominator"] == 1


def test_fixture_confusion_matrix_f1_precision_recall_fp_fn_are_manual_values():
    result = fixture_report()
    applicability = result["perDimension"]["APPLICABILITY"]
    cm = applicability["confusionMatrix"]["cells"]

    assert applicability["confusionMatrix"]["rows"] == "OBSERVED_GOLD_RUBRIC_LABELS"
    assert applicability["confusionMatrix"]["columns"] == "RUBRIC_LABELS_AND_MISSING_UNKNOWN_ERRORS"
    assert cm["APPLICABLE"]["APPLICABLE"] == 1
    assert cm["NOT_APPLICABLE"]["APPLICABLE"] == 1
    assert cm["UNRESOLVED"]["UNRESOLVED"] == 1
    assert applicability["macroF1"] == 0.555556
    assert applicability["perClass"]["APPLICABLE"]["precision"] == 0.5
    assert applicability["perClass"]["APPLICABLE"]["recall"] == 1.0
    assert applicability["perClass"]["NOT_APPLICABLE"]["precision"] is None
    assert applicability["perClass"]["NOT_APPLICABLE"]["recall"] == 0.0
    assert applicability["falsePositives"] == 1
    assert applicability["falseNegatives"] == 1


def test_stage_dimension_semantic_and_evidence_reports_are_separate():
    result = fixture_report()

    assert result["perStage"]["RULE_SET_PREPARATION"]["ACTOR"]["denominator"] == 1
    assert result["perStage"]["ASSESSMENT_ROOT"]["APPLICABILITY"]["denominator"] == 3
    assert result["semanticQuality"]["dimensionIds"] == [
        "APPLICABILITY",
        "COMPLIANCE",
        "ACTOR",
        "CONDITIONS",
        "EXCEPTIONS",
        "UNSUPPORTED_CONCLUSION",
    ]
    assert result["evidenceQuality"]["dimensionIds"] == ["EVIDENCE_SUFFICIENCY"]
    assert "accuracy" not in result
    assert result["perDimension"]["EVIDENCE_SUFFICIENCY"]["denominator"] == 2


def test_missing_and_unknown_predictions_stay_in_denominator_and_are_counted():
    result = fixture_report()
    evidence = result["perDimension"]["EVIDENCE_SUFFICIENCY"]
    unsupported = result["perDimension"]["UNSUPPORTED_CONCLUSION"]

    assert evidence["denominator"] == 2
    assert evidence["missingPredictionCount"] == 1
    assert evidence["scoringCoverage"] == 0.5
    assert evidence["falseNegatives"] == 1
    assert "__MISSING__" in evidence["confusionMatrix"]["columnLabels"]
    assert "__MISSING__" not in evidence["macroF1Labels"]
    assert unsupported["invalidPredictionCount"] == 1
    assert unsupported["unknownPredictionCount"] == 1
    assert "__UNKNOWN__" in unsupported["confusionMatrix"]["columnLabels"]
    assert "__UNKNOWN__" not in unsupported["macroF1Labels"]


def test_empty_reviewed_dataset_returns_not_scored_with_null_quality_metrics():
    candidate = candidate_records()
    fixture = inputs()[0]
    predictions = {
        "predictionVersion": fixture["predictions"]["predictionVersion"],
        "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
        "sourceKind": "EMPTY_CONTROL",
        "casePredictions": [],
    }
    result = score_dataset(candidate, predictions, inputs()[1], inputs()[2])

    assert result["scoringStatus"] == "NOT_SCORED"
    assert result["coverage"]["candidateAnnotationCount"] == 30
    assert result["coverage"]["humanReviewedAnnotationCount"] == 0
    assert result["perDimension"]["APPLICABILITY"]["denominator"] == 0
    assert result["perDimension"]["APPLICABILITY"]["macroF1"] is None
    assert result["perDimension"]["APPLICABILITY"]["scoringCoverage"] is None


def test_assessment_contract_normalization_handles_not_applicable_null_compliance():
    fixture, rubric, pins = inputs()
    annotation = deepcopy(fixture["annotations"][3])
    annotation["caseId"] = "synthetic-ar-null-compliance"
    annotation["primaryDimension"] = "COMPLIANCE"
    annotation["expected"] = {
        "compliance": {
            "label": "NOT_APPLICABLE",
            "details": ["Synthetic contract mapping control."],
        }
    }
    annotation["reviewers"][0]["dimensionsReviewed"] = ["COMPLIANCE"]
    annotation["reviewers"][0]["dimensionJudgments"] = [
        {
            "dimension": "COMPLIANCE",
            "label": "NOT_APPLICABLE",
            "rationale": "Synthetic contract mapping control.",
        }
    ]
    prediction = {
        "caseId": annotation["caseId"],
        "stage": "ASSESSMENT_ROOT",
        "evaluationTarget": "SYNTHETIC_SCORER_VERIFICATION",
        "observationKind": "SYNTHETIC_FIXTURE_CONTROL",
        "dimensionPredictions": {"applicability": "NOT_APPLICABLE", "compliance": None},
        "humanJudgments": {},
    }
    report = score_dataset(
        [annotation],
        synthetic_predictions(fixture, [prediction]),
        rubric,
        pins,
    )

    assert report["perDimension"]["COMPLIANCE"]["denominator"] == 1
    assert (
        report["perDimension"]["COMPLIANCE"]["confusionMatrix"]["cells"][
            "NOT_APPLICABLE"
        ]["NOT_APPLICABLE"]
        == 1
    )


def test_prediction_ids_stages_and_versions_are_integrity_checked():
    fixture, rubric, pins = inputs()
    duplicate = deepcopy(fixture["predictions"])
    duplicate["casePredictions"].append(deepcopy(duplicate["casePredictions"][0]))
    with pytest.raises(ValueError, match="PREDICTION_DUPLICATE_CASE_ID"):
        score_dataset(fixture["annotations"], duplicate, rubric, pins)

    wrong_stage = deepcopy(fixture["predictions"])
    wrong_stage["casePredictions"][0]["stage"] = "ASSESSMENT_ROOT"
    with pytest.raises(ValueError, match="PREDICTION_STAGE_MISMATCH"):
        score_dataset(fixture["annotations"], wrong_stage, rubric, pins)

    wrong_version = deepcopy(fixture["predictions"])
    wrong_version["predictionVersion"] = "V0"
    with pytest.raises(ValueError, match="PREDICTIONS_VERSION_INVALID"):
        score_dataset(fixture["annotations"], wrong_version, rubric, pins)


def test_repeated_scoring_is_deterministic_and_fixture_provenance_is_explicit():
    fixture = inputs()[0]
    first = fixture_report(fixture)
    second = fixture_report(fixture)

    assert first == second
    assert first["provenance"]["fixtureOnly"] is True
    assert first["provenance"]["productionAcceptance"] == "NOT_PROVEN"
    assert first["provenance"]["deepAgentAccuracyClaim"] == "NOT_MADE"
    assert len(first["provenance"]["inputDigests"]["annotationsCanonicalSha256"]) == 64
    assert "synthetic test controls" in inputs()[0]["warning"]


def test_candidate_and_synthetic_review_records_are_physically_separate():
    candidates = candidate_records()
    fixture = inputs()[0]
    candidate_ids = {row["caseId"] for row in candidates}
    fixture_ids = {row["caseId"] for row in fixture["annotations"]}

    assert candidate_ids.isdisjoint(fixture_ids)
    assert fixture["fixtureType"] == "SYNTHETIC_SCORER_VERIFICATION_ONLY"
    assert "not human-reviewed gold" in fixture["warning"]
    assert all(row["reviewStatus"] == "CANDIDATE" for row in candidates)
    assert all(
        "SYNTHETIC_FIXTURE_REVIEWER" not in str(row["reviewers"]) for row in candidates
    )


def test_r1_reports_are_reproducible_and_keep_provenance_separate(tmp_path):
    historical_paths = [
        PACKAGE / "reports" / "candidate-diagnostics.v1.json",
        PACKAGE / "reports" / "scorer-verification.v1.json",
    ]
    historical_before = [path.read_bytes() for path in historical_paths]
    generated = build_r1_reports(tmp_path)

    assert [path.read_bytes() for path in historical_paths] == historical_before
    assert generated["candidateDiagnostics"]["candidateAnnotationCount"] == 30
    assert generated["candidateDiagnostics"]["humanReviewedAnnotationCount"] == 0
    assert (
        generated["syntheticScorerVerification"]["reportClassification"]
        == "SYNTHETIC_SCORER_VERIFICATION_ONLY"
    )
    assert generated["syntheticScorerVerification"]["candidateDatasetUsed"] is False


def test_review_overlay_progression_keeps_candidate_snapshot_and_updates_workflow(tmp_path):
    candidates = candidate_records()
    rubric, pins = inputs()[1:]
    candidate_path = PACKAGE / "candidate-cases.v1.jsonl"
    base_bytes = candidate_path.read_bytes()
    row = candidates[0]
    expected = row["expected"]
    dimension_names = {
        "applicability": "APPLICABILITY",
        "compliance": "COMPLIANCE",
        "actor": "ACTOR",
        "conditions": "CONDITIONS",
        "exceptions": "EXCEPTIONS",
        "evidenceSufficiency": "EVIDENCE_SUFFICIENCY",
        "unsupportedConclusion": "UNSUPPORTED_CONCLUSION",
    }
    judgments = [
        {
            "dimension": dimension_names[field],
            "label": value["label"],
            "rationale": "Temporary workflow progression fixture only.",
        }
        for field, value in expected.items()
        if value is not None
    ]
    reviewer = {
        "reviewerType": "HUMAN",
        "reviewerId": "test-reviewer",
        "identityVerificationRef": "https://reviews.acme.com/test-only",
        "reviewedAt": "2026-12-01T10:00:00Z",
        "decision": "CONFIRM",
        "dimensionsReviewed": [item["dimension"] for item in judgments],
        "dimensionJudgments": judgments,
    }
    digest = lambda value: __import__("hashlib").sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    overlay = {
        "overlayVersion": "LCSP-400-REVIEW-OVERLAY-V1",
        "candidateDatasetSha256": digest(candidates),
        "caseReviews": [
            {
                "caseId": row["caseId"],
                "candidateRecordSha256": digest(row),
                "reviewStatus": "REVIEWED",
                "reviewers": [reviewer],
                "reviewerDisagreements": [],
                "adjudication": None,
                "uncertaintyReason": None,
                "exclusionReason": None,
                "expectedOverrides": {},
            }
        ],
    }
    overlay_path = tmp_path / "review-overlay.json"
    overlay_path.write_text(json.dumps(overlay), encoding="utf-8")
    effective = merge_review_overlay(candidates, overlay_path, rubric, pins)
    assert effective[0]["reviewStatus"] == "REVIEWED"
    assert all("confidence" not in value for value in effective[0]["expected"].values() if value)

    report = score_dataset(
        effective,
        {
            "predictionVersion": "LCSP-400-NORMALIZED-PREDICTIONS-V1",
            "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
            "sourceKind": "REVIEW_LIFECYCLE_UNIT_FIXTURE",
            "casePredictions": [
                {
                    "caseId": row["caseId"],
                    "stage": row["stage"],
                    "evaluationTarget": row["evaluationTarget"],
                    "observationKind": "GENERATED_LCSP_OUTPUT",
                    "dimensionPredictions": {"applicability": "APPLICABLE"},
                    "humanJudgments": {},
                }
            ],
        },
        rubric,
        pins,
    )
    diagnostics = build_r1_reports(tmp_path / "reports", review_overlay_path=overlay_path)[
        "candidateDiagnostics"
    ]
    assert report["perDimension"]["APPLICABILITY"]["denominator"] == 1
    assert diagnostics["humanReviewedAnnotationCount"] == 1
    assert diagnostics["humanReviewedSemanticEvaluation"]["authenticityStatus"] == "NOT_AUTHENTICATED_BY_TOOL"
    assert candidate_path.read_bytes() == base_bytes
