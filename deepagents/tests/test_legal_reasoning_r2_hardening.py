"""Regression tests for LCSP-400 R2 review, target, and metric integrity."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from evals.legal_reasoning.scorer import (
    MISSING,
    UNKNOWN,
    _calculate_metric,
    _expected_for_target,
    _prediction_label,
    _valid_human_judgment,
    score_dataset,
)
from evals.legal_reasoning.p14_adapter import _normalize_assessment_verdict
from evals.legal_reasoning.validation import load_dataset, validate_dataset

DEEPAGENTS = Path(__file__).resolve().parents[1]
PACKAGE = DEEPAGENTS / "evals" / "legal_reasoning"
FIXTURE = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "legal_reasoning"
    / "synthetic-scorer-fixture.v1.json"
)


def _inputs():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rubric = json.loads((PACKAGE / "rubric.v1.json").read_text(encoding="utf-8"))
    pins = json.loads((PACKAGE / "source-pins.v1.json").read_text(encoding="utf-8"))
    return fixture, rubric, pins


def _reviewed_candidate():
    row = load_dataset(PACKAGE / "candidate-cases.v1.jsonl")[0]
    for expected in row["expected"].values():
        if expected is not None:
            expected.pop("confidence", None)
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
            "dimension": dimension_names[dimension],
            "label": expected["label"],
            "rationale": "Review fixture for validator regression.",
        }
        for dimension, expected in row["expected"].items()
        if expected is not None
    ]
    reviewer = {
        "reviewerType": "HUMAN",
        "reviewerId": "reviewer-a",
        "identityVerificationRef": "https://reviews.acme.com/records/a",
        "reviewedAt": "2026-12-01T10:00:00Z",
        "decision": "CONFIRM",
        "dimensionsReviewed": [item["dimension"] for item in judgments],
        "dimensionJudgments": judgments,
    }
    row.update(
        {
            "reviewStatus": "REVIEWED",
            "reviewers": [reviewer],
            "reviewerDisagreements": [],
        }
    )
    return row


def _actual_output_review():
    binding = {
        "runId": "run-a",
        "manifestSha256": "a" * 64,
        "candidateCaseId": "gdpr-case-a",
        "p14CaseId": "CASE-A",
        "evaluationStage": "ASSESSMENT_ROOT",
        "lifecycleStage": "INITIAL",
        "trialIndex": 0,
        "threadId": "thread-a",
        "traceSha256": "b" * 64,
        "observedOutputSha256": "c" * 64,
        "repositoryCommitSha": "d" * 40,
        "corpusId": "corpus-a",
        "corpusVersion": "v1",
        "ruleSetVersionId": "rules-v1",
        "modelRoute": "offline",
        "instructionBundleDigest": "bundle-a",
        "legalSourceId": "source-a",
        "legalSourceVersion": "v1",
        "legalProvisionRefs": "provision-a",
        "legalCitations": "Article 1",
        "p14RuleId": "rule-a",
    }
    judgment = {
        "label": "CORRECT",
        "reviewStatus": "REVIEWED",
        "reviewerDisagreements": [],
        "reviewers": [
            {
                "reviewerType": "HUMAN",
                "reviewerId": "reviewer-actual-a",
                "identityVerificationRef": "https://reviews.acme.com/records/a",
                "reviewedAt": "2026-12-01T10:00:00Z",
                "decision": "CONFIRM",
                "dimensionsReviewed": ["ACTOR"],
                "dimensionJudgments": [
                    {"dimension": "ACTOR", "label": "CORRECT", "rationale": "Verified."}
                ],
            }
        ],
        "targetBinding": deepcopy(binding),
    }
    return judgment, {"p14Binding": binding}


@pytest.mark.parametrize(
    ("mutation", "description"),
    [
        (lambda judgment: judgment["reviewers"][0].update(reviewedAt="not-a-date"), "timestamp"),
        (
            lambda judgment: judgment["reviewers"][0].update(
                identityVerificationRef="synthetic-fixture-only://reviewer"
            ),
            "synthetic identity reference",
        ),
        (lambda judgment: judgment["reviewers"][0].update(decision="REJECT"), "decision"),
        (lambda judgment: judgment.pop("label"), "label"),
    ],
)
def test_malformed_human_output_judgments_are_not_eligible(mutation, description):
    _, rubric, _ = _inputs()
    judgment, prediction = _actual_output_review()
    mutation(judgment)

    assert not _valid_human_judgment(
        judgment,
        dimension="ACTOR",
        spec=rubric["dimensions"]["ACTOR"],
        prediction=prediction,
    ), description


def test_human_output_judgment_must_bind_to_the_exact_p14_trial_and_trace():
    judgment, prediction = _actual_output_review()
    spec = {"labels": ["CORRECT", "INCORRECT", "MISSING"]}
    assert _valid_human_judgment(judgment, dimension="ACTOR", spec=spec, prediction=prediction)
    prediction["p14Binding"]["traceSha256"] = "e" * 64
    assert not _valid_human_judgment(judgment, dimension="ACTOR", spec=spec, prediction=prediction)


def test_adjudication_must_resolve_every_expected_label_that_reviewers_changed():
    _, rubric, pins = _inputs()
    row = _reviewed_candidate()
    row["reviewStatus"] = "ADJUDICATED"
    row["reviewers"][0]["decision"] = "REVISE"
    for item in row["reviewers"][0]["dimensionJudgments"]:
        if item["dimension"] == "APPLICABILITY":
            item["label"] = "NOT_APPLICABLE"
            item["priorLabel"] = "APPLICABLE"
    row["adjudication"] = {
        "reviewerType": "HUMAN",
        "reviewerId": "independent-adjudicator",
        "identityVerificationRef": "https://reviews.acme.com/records/adjudicator",
        "reviewEvidenceRef": "https://reviews.acme.com/adjudications/a",
        "outcome": "CONFIRM",
        "rationale": "Only the actor dimension was resolved.",
        "adjudicatedAt": "2026-12-01T11:00:00Z",
        "resolvedLabels": [
            {
                "dimension": "ACTOR",
                "label": row["expected"]["actor"]["label"],
                "rationale": "Actor label confirmed.",
            }
        ],
    }

    with pytest.raises(ValueError, match="ADJUDICATION_RESOLUTION_INCOMPLETE"):
        validate_dataset([row], rubric, pins)


def test_review_record_rejects_duplicate_ids_dimensions_and_invalid_timestamps():
    _, rubric, pins = _inputs()

    duplicate_reviewer = _reviewed_candidate()
    duplicate_reviewer["reviewers"].append(deepcopy(duplicate_reviewer["reviewers"][0]))
    with pytest.raises(ValueError, match="DUPLICATE_REVIEWER_ID"):
        validate_dataset([duplicate_reviewer], rubric, pins)

    duplicate_dimension = _reviewed_candidate()
    duplicate_dimension["reviewers"][0]["dimensionJudgments"].append(
        deepcopy(duplicate_dimension["reviewers"][0]["dimensionJudgments"][0])
    )
    with pytest.raises(ValueError, match="DUPLICATE_REVIEW_DIMENSION"):
        validate_dataset([duplicate_dimension], rubric, pins)

    dimensions_mismatch = _reviewed_candidate()
    dimensions_mismatch["reviewers"][0]["dimensionsReviewed"].pop()
    with pytest.raises(ValueError, match="REVIEW_DIMENSIONS_MISMATCH"):
        validate_dataset([dimensions_mismatch], rubric, pins)

    invalid_timestamp = _reviewed_candidate()
    invalid_timestamp["reviewers"][0]["reviewedAt"] = "not-a-date"
    with pytest.raises(ValueError, match="ANNOTATION_SCHEMA_INVALID"):
        validate_dataset([invalid_timestamp], rubric, pins)


def test_adjudicated_review_requires_independent_adjudicator_and_unique_resolutions():
    _, rubric, pins = _inputs()
    row = _reviewed_candidate()
    row["reviewStatus"] = "ADJUDICATED"
    row["adjudication"] = {
        "reviewerType": "HUMAN",
        "reviewerId": "independent-adjudicator",
        "identityVerificationRef": "https://reviews.acme.com/records/adjudicator",
        "reviewEvidenceRef": "https://reviews.acme.com/adjudications/a",
        "outcome": "CONFIRM",
        "rationale": "Each reviewed dimension was confirmed.",
        "adjudicatedAt": "2026-12-01T11:00:00Z",
        "resolvedLabels": [
            {
                "dimension": dimension,
                "label": item["label"],
                "rationale": "Confirmed expected label.",
            }
            for dimension, item in (
                (judgment["dimension"], judgment)
                for judgment in row["reviewers"][0]["dimensionJudgments"]
            )
        ],
    }
    validate_dataset([row], rubric, pins)

    duplicate_resolution = deepcopy(row)
    duplicate_resolution["adjudication"]["resolvedLabels"].append(
        deepcopy(duplicate_resolution["adjudication"]["resolvedLabels"][0])
    )
    with pytest.raises(ValueError, match="DUPLICATE_ADJUDICATION_DIMENSION"):
        validate_dataset([duplicate_resolution], rubric, pins)

    non_independent = deepcopy(row)
    non_independent["adjudication"]["reviewerId"] = non_independent["reviewers"][0]["reviewerId"]
    with pytest.raises(ValueError, match="ADJUDICATOR_MUST_BE_INDEPENDENT"):
        validate_dataset([non_independent], rubric, pins)


def test_generated_output_target_does_not_score_a_fixed_bad_claim_as_agent_gold():
    records = load_dataset(PACKAGE / "candidate-cases.v1.jsonl")
    fixed_claim = next(
        row
        for row in records
        if row["caseId"] == "gdpr-rsp-invented-universal-encryption-duty"
    )

    assert fixed_claim["evaluationTarget"] == "FIXED_CLAIM_DIAGNOSTIC"
    assert fixed_claim["fixedOutputDiagnostic"]["expectedJudgments"][
        "unsupportedConclusion"
    ]["label"] == "INVENTED_OBLIGATION"
    assert fixed_claim["expected"] == {}
    assert _expected_for_target(fixed_claim, "RULE_SET_PREPARATION_OUTPUT") == {}
    assert (
        _expected_for_target(fixed_claim, "FIXED_CLAIM_DIAGNOSTIC")[
            "unsupportedConclusion"
        ]["label"]
        == "INVENTED_OBLIGATION"
    )


def test_generated_output_avoiding_fixed_claim_is_not_scored_as_the_claim():
    records = load_dataset(PACKAGE / "candidate-cases.v1.jsonl")
    _, rubric, pins = _inputs()
    fixed_claim = next(
        row
        for row in records
        if row["caseId"] == "gdpr-rsp-invented-universal-encryption-duty"
    )
    generated_output = {
        "predictionVersion": "LCSP-400-NORMALIZED-PREDICTIONS-V1",
        "evaluationTarget": "RULE_SET_PREPARATION_OUTPUT",
        "sourceKind": "TEST_ONLY_NORMALIZED_OUTPUT",
        "casePredictions": [
            {
                "caseId": fixed_claim["caseId"],
                "stage": "RULE_SET_PREPARATION",
                "evaluationTarget": "RULE_SET_PREPARATION_OUTPUT",
                "observationKind": "GENERATED_LCSP_OUTPUT",
                "dimensionPredictions": {},
                "humanJudgments": {},
            }
        ],
    }
    report = score_dataset(records, generated_output, rubric, pins)

    assert report["scoringStatus"] == "NOT_SCORED"
    assert report["coverage"]["outOfTargetPredictionCaseCount"] == 1
    assert report["perDimension"]["UNSUPPORTED_CONCLUSION"]["denominator"] == 0

    incorrect_diagnostic_use = deepcopy(generated_output)
    incorrect_diagnostic_use["evaluationTarget"] = "FIXED_CLAIM_DIAGNOSTIC"
    incorrect_diagnostic_use["casePredictions"][0]["evaluationTarget"] = "FIXED_CLAIM_DIAGNOSTIC"
    with pytest.raises(ValueError, match="PREDICTION_OBSERVATION_KIND_MISMATCH"):
        score_dataset(records, incorrect_diagnostic_use, rubric, pins)


def test_missing_null_and_invalid_assessment_compliance_are_distinct():
    _, rubric, _ = _inputs()
    compliance_spec = rubric["dimensions"]["COMPLIANCE"]
    missing = {
        "dimensionPredictions": {"applicability": "NOT_APPLICABLE"},
        "humanJudgments": {},
    }
    explicit_null = {
        "dimensionPredictions": {
            "applicability": "NOT_APPLICABLE",
            "compliance": None,
        },
        "humanJudgments": {},
    }
    invalid_pair = {
        "dimensionPredictions": {
            "applicability": "NOT_APPLICABLE",
            "compliance": "COMPLIANT",
        },
        "humanJudgments": {},
    }

    assert _prediction_label("COMPLIANCE", missing, compliance_spec) is None
    assert (
        _prediction_label("COMPLIANCE", explicit_null, compliance_spec)
        == "NOT_APPLICABLE"
    )
    assert _prediction_label("COMPLIANCE", invalid_pair, compliance_spec) == UNKNOWN


def test_p14_unresolved_and_unknown_verdicts_remain_distinct_from_missing():
    _, rubric, _ = _inputs()
    assert _normalize_assessment_verdict("NOT_APPLICABLE") == (
        "NOT_APPLICABLE", None, "NOT_APPLICABLE", "NOT_APPLICABLE"
    )
    assert _normalize_assessment_verdict("UNRESOLVED") == (
        "UNRESOLVED", "UNRESOLVED", "UNRESOLVED", "UNRESOLVED"
    )
    assert _normalize_assessment_verdict("UNEXPECTED_VERDICT") == (
        "UNEXPECTED_VERDICT", "UNEXPECTED_VERDICT", "UNEXPECTED_VERDICT", "UNEXPECTED_VERDICT"
    )

    _, p14_binding = _actual_output_review()
    p14_prediction = {
        **p14_binding,
        "normalizationSource": "P14_SAVED_ARTIFACTS",
        "dimensionPredictions": {
            "applicability": "UNRESOLVED",
            "compliance": "UNRESOLVED",
        },
        "evaluationLabelPredictions": {
            "applicability": "UNRESOLVED",
            "compliance": "UNRESOLVED",
        },
    }
    assert (
        _prediction_label(
            "APPLICABILITY", p14_prediction, rubric["dimensions"]["APPLICABILITY"]
        )
        == "UNRESOLVED"
    )
    assert (
        _prediction_label(
            "COMPLIANCE", p14_prediction, rubric["dimensions"]["COMPLIANCE"]
        )
        == "UNRESOLVED"
    )


def test_macro_f1_uses_rubric_classes_and_keeps_sentinels_as_errors():
    labels = ["SUPPORTED_COMPLIANCE", "SUPPORTED_NON_COMPLIANCE"]
    records = [
        {
            "caseId": f"case-{index}",
                "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
            "expected": {"compliance": {"label": label}},
        }
        for index, label in enumerate(
            ["SUPPORTED_COMPLIANCE", "SUPPORTED_COMPLIANCE", "SUPPORTED_NON_COMPLIANCE", "SUPPORTED_NON_COMPLIANCE"]
        )
    ]
    predictions = {
        "case-0": {"dimensionPredictions": {"applicability": "APPLICABLE", "compliance": "COMPLIANT"}},
        "case-1": {"dimensionPredictions": {"applicability": "APPLICABLE"}},
        "case-2": {"dimensionPredictions": {"applicability": "APPLICABLE", "compliance": "COMPLIANT"}},
        "case-3": {"dimensionPredictions": {"applicability": "APPLICABLE", "compliance": "BAD"}},
    }
    spec = {"labels": labels}

    result = _calculate_metric("COMPLIANCE", records, records, predictions, spec)

    assert result["macroF1"] == 0.25
    assert result["labels"] == [*labels, MISSING, UNKNOWN]
    assert result["perClass"].keys() == set(labels)
    assert result["missingPredictionCount"] == 1
    assert result["unknownPredictionCount"] == 1
    assert result["falsePositives"] == 1
    assert result["falseNegatives"] == 3
    assert result["confusionMatrix"]["cells"]["SUPPORTED_COMPLIANCE"][MISSING] == 1
    assert result["confusionMatrix"]["cells"]["SUPPORTED_NON_COMPLIANCE"][UNKNOWN] == 1
