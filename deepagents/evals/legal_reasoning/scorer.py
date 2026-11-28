"""Deterministic, provider-free scorer for reviewed LCSP-400 annotations."""

from __future__ import annotations

import argparse
import json
import re
from hashlib import sha256
from pathlib import Path
from typing import Any

from evals.legal_reasoning.validation import (
    PACKAGE_ROOT,
    _valid_p14_binding,
    _valid_review_identity,
    _valid_utc_timestamp,
    validate_dataset,
)

MISSING = "__MISSING__"
UNKNOWN = "__UNKNOWN__"
STAGES = ("RULE_SET_PREPARATION", "ASSESSMENT_ROOT")
DIMENSIONS = (
    "APPLICABILITY",
    "COMPLIANCE",
    "ACTOR",
    "CONDITIONS",
    "EXCEPTIONS",
    "EVIDENCE_SUFFICIENCY",
    "UNSUPPORTED_CONCLUSION",
)
SEMANTIC_DIMENSIONS = (
    "APPLICABILITY",
    "COMPLIANCE",
    "ACTOR",
    "CONDITIONS",
    "EXCEPTIONS",
    "UNSUPPORTED_CONCLUSION",
)
EVIDENCE_DIMENSIONS = ("EVIDENCE_SUFFICIENCY",)
PREPARATION_BINDING_FIELDS = {
    "bindingKind",
    "candidateCaseId",
    "runId",
    "manifestSha256",
    "sourceId",
    "sourceVersion",
    "provisionRefs",
    "claimId",
    "claimSha256",
    "outputSha256",
    "instructionBundleDigest",
    "skillVersionDigest",
}
FIXED_CLAIM_BINDING_FIELDS = {
    "bindingKind",
    "candidateCaseId",
    "candidateDatasetSha256",
    "claimSha256",
    "rubricVersion",
    "sourcePinsSha256",
}


def score_dataset(
    records: list[dict[str, Any]],
    predictions: dict[str, Any],
    rubric: dict[str, Any],
    source_pins: dict[str, Any],
    *,
    scoring_case_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Business purpose: Compare observed categorical outputs with genuinely reviewed legal labels.

    Business rules:
    - Only REVIEWED or ADJUDICATED annotations with human evidence metadata enter quality metrics.
    - Explicit Assessment Root domain values are normalized only through documented contract maps;
      semantic judgments of free text must arrive as separately reviewed human judgments.
    - Missing and unknown predictions remain in the denominator and confusion matrix; no result is
      reported as an accuracy score when the eligible denominator is zero.
    - When supplied, scoring_case_ids bounds the denominator to actual expected executions; unrelated
      and not-executed candidates remain coverage inventory only.

    Execution flow:
    1. Validate dataset provenance, labels, and review states, then validate unique prediction IDs.
    2. Resolve one prediction per expected dimension, using an explicit field or a reviewed judgment.
    3. Build stage/dimension confusion matrices and per-class precision, recall, F1, and coverage.
    4. Return separately grouped semantic and evidence reports with deterministic ordering.
       An optional execution cohort restricts case-level scoring without changing annotation validation.

    Failure cases:
    - Invalid gold, duplicate identifiers, malformed outputs, or unsupported domain mappings raise
      ValueError; unknown output labels are counted as UNKNOWN instead of silently discarded.

    Side effects:
    - None: computes from supplied data only; no model, network, persistence, or production writes.
    """
    if not isinstance(predictions, dict):
        raise TypeError("PREDICTIONS_OBJECT_REQUIRED")
    synthetic_test_mode = _is_synthetic_test_execution(records, predictions)
    validate_dataset(
        records,
        rubric,
        source_pins,
        allow_synthetic_reviews=synthetic_test_mode,
    )
    if predictions.get("predictionVersion") != "LCSP-400-NORMALIZED-PREDICTIONS-V1":
        raise ValueError("PREDICTIONS_VERSION_INVALID")
    evaluation_target = predictions.get("evaluationTarget")
    allowed_targets = {
        "ACTUAL_ASSESSMENT_OUTPUT",
        "RULE_SET_PREPARATION_OUTPUT",
        "FIXED_CLAIM_DIAGNOSTIC",
        "SYNTHETIC_SCORER_VERIFICATION",
    }
    if evaluation_target not in allowed_targets:
        raise ValueError("PREDICTIONS_EVALUATION_TARGET_INVALID")
    if (evaluation_target == "SYNTHETIC_SCORER_VERIFICATION") != synthetic_test_mode:
        raise ValueError("SYNTHETIC_SCORER_ISOLATION_REQUIRED")
    target_records = [
        row for row in records if row["evaluationTarget"] == evaluation_target
    ]
    if scoring_case_ids is not None:
        if any(not isinstance(case_id, str) for case_id in scoring_case_ids):
            raise TypeError("SCORING_CASE_ID_INVALID")
        target_ids = {row["caseId"] for row in target_records}
        if not scoring_case_ids <= target_ids:
            raise ValueError("SCORING_CASE_ID_OUTSIDE_TARGET")
        target_records = [
            row for row in target_records if row["caseId"] in scoring_case_ids
        ]
    prediction_rows = predictions.get("casePredictions")
    if not isinstance(prediction_rows, list):
        raise TypeError("PREDICTIONS_CASES_REQUIRED")
    prediction_by_id: dict[str, dict[str, Any]] = {}
    record_by_id = {record["caseId"]: record for record in target_records}
    for row in prediction_rows:
        if not isinstance(row, dict) or not isinstance(row.get("caseId"), str):
            raise TypeError("PREDICTION_CASE_ID_REQUIRED")
        case_id = row["caseId"]
        if case_id in prediction_by_id:
            raise ValueError(f"PREDICTION_DUPLICATE_CASE_ID:{case_id}")
        if (
            case_id in record_by_id
            and row.get("stage") != record_by_id[case_id]["stage"]
        ):
            raise ValueError(f"PREDICTION_STAGE_MISMATCH:{case_id}")
        if case_id in record_by_id and row.get("evaluationTarget") != evaluation_target:
            raise ValueError(f"PREDICTION_TARGET_MISMATCH:{case_id}")
        if case_id in record_by_id:
            expected_observation = (
                "SYNTHETIC_FIXTURE_CONTROL"
                if synthetic_test_mode
                else "PREDEFINED_CLAIM"
                if evaluation_target == "FIXED_CLAIM_DIAGNOSTIC"
                else "GENERATED_LCSP_OUTPUT"
            )
            if row.get("observationKind") != expected_observation:
                raise ValueError(f"PREDICTION_OBSERVATION_KIND_MISMATCH:{case_id}")
            if evaluation_target == "FIXED_CLAIM_DIAGNOSTIC" and row.get(
                "observedClaim"
            ) != record_by_id[case_id].get("claimUnderReview"):
                raise ValueError(f"PREDICTION_FIXED_CLAIM_BINDING_MISMATCH:{case_id}")
        normalized_row = dict(row)
        if evaluation_target == "FIXED_CLAIM_DIAGNOSTIC" and case_id in record_by_id:
            normalized_row["_expectedTargetBinding"] = _fixed_claim_binding(
                record_by_id[case_id], records, rubric, source_pins
            )
        prediction_by_id[case_id] = normalized_row

    all_counts = _review_counts(records, allow_synthetic=not synthetic_test_mode)
    per_dimension: dict[str, Any] = {}
    for dimension in DIMENSIONS:
        per_dimension[dimension] = _score_dimension(
            dimension,
            target_records,
            prediction_by_id,
            rubric,
            all_counts,
            evaluation_target,
            synthetic_test_mode=synthetic_test_mode,
        )
    per_stage: dict[str, Any] = {}
    for stage in STAGES:
        per_stage[stage] = {
            dimension: per_dimension[dimension]["byStage"].get(stage, _empty_metric())
            for dimension in DIMENSIONS
            if per_dimension[dimension]["byStage"]
            .get(stage, {})
            .get("applicableCaseCount", 0)
            > 0
        }
    for dimension, result in per_dimension.items():
        del result["byStage"]

    if synthetic_test_mode:
        all_counts["syntheticFixtureAnnotationCount"] = sum(
            1 for record in target_records if _eligible(record)
        )
    return {
        "reportVersion": "LCSP-400-SCORER-REPORT-V1",
        "reportClassification": "STANDALONE_DIAGNOSTIC_UNVERIFIED",
        "executionProvenanceStatus": "UNVERIFIED",
        "verifiedExecutionMetrics": False,
        "evaluationTarget": evaluation_target,
        "datasetVersion": rubric["datasetVersion"],
        "rubricVersion": rubric["rubricVersion"],
        "scoringStatus": "SCORED"
        if any(report["denominator"] > 0 for report in per_dimension.values())
        else "NOT_SCORED",
        "provenance": {
            "predictionSource": predictions.get("sourceKind", "UNSPECIFIED"),
            "fixtureOnly": predictions.get("syntheticOnly", False),
            "productionAcceptance": "NOT_PROVEN",
            "deepAgentAccuracyClaim": "NOT_MADE",
            "runMetadata": predictions.get("runMetadata", {}),
            "inputDigests": {
                "annotationsCanonicalSha256": _canonical_sha256(records),
                "predictionsCanonicalSha256": _canonical_sha256(predictions),
                "rubricCanonicalSha256": _canonical_sha256(rubric),
                "sourcePinsCanonicalSha256": _canonical_sha256(source_pins),
            },
        },
        "coverage": {
            **all_counts,
            "extraPredictionCaseCount": len(
                set(prediction_by_id) - {row["caseId"] for row in records}
            ),
            "missingPredictionCaseCount": sum(
                1
                for record in target_records
                if _eligible(record) and record["caseId"] not in prediction_by_id
            ),
            "targetCaseCount": len(target_records),
            "outOfTargetCaseCount": len(records) - len(target_records),
            "outOfTargetPredictionCaseCount": len(
                (set(prediction_by_id) & {row["caseId"] for row in records})
                - {row["caseId"] for row in target_records}
            ),
        },
        "perStage": per_stage,
        "perDimension": per_dimension,
        "semanticQuality": {
            "dimensionIds": list(SEMANTIC_DIMENSIONS),
            "note": "Read each dimension separately; no cross-dimension accuracy is computed.",
            "byDimension": {key: per_dimension[key] for key in SEMANTIC_DIMENSIONS},
        },
        "evidenceQuality": {
            "dimensionIds": list(EVIDENCE_DIMENSIONS),
            "note": "Evidence sufficiency is scored separately from semantic conclusions.",
            "byDimension": {key: per_dimension[key] for key in EVIDENCE_DIMENSIONS},
        },
    }


def _score_dimension(
    dimension: str,
    records: list[dict[str, Any]],
    predictions: dict[str, dict[str, Any]],
    rubric: dict[str, Any],
    review_counts: dict[str, int],
    evaluation_target: str,
    *,
    synthetic_test_mode: bool,
) -> dict[str, Any]:
    """Business purpose: Score one rubric dimension while preserving its own label universe.

    Business rules:
    - Cases without an expected value for a dimension are inapplicable, not incorrect.
    - Non-reviewed expected values contribute to review coverage but not semantic metrics.
    - Missing and invalid labels receive explicit sentinel classes and remain denominator cases.

    Execution flow:
    1. Select cases where this rubric dimension applies.
    2. Count review-eligible gold and resolve each corresponding observed label.
    3. Compute metrics independently for each stage and across the dimension.

    Failure cases:
    - Invalid gold labels fail dataset validation; malformed human judgments are missing or unknown.

    Side effects:
    - None: returns deterministic in-memory metrics.
    """
    spec = rubric["dimensions"][dimension]
    applicable = [
        row
        for row in records
        if _expected_for_target(row, evaluation_target).get(_field_name(dimension))
        is not None
    ]
    eligible = [row for row in applicable if _eligible(row)]
    by_stage: dict[str, Any] = {}
    for stage in STAGES:
        stage_applicable = [row for row in applicable if row["stage"] == stage]
        stage_eligible = [row for row in eligible if row["stage"] == stage]
        if stage_applicable:
            stage_metric = _calculate_metric(
                dimension,
                stage_applicable,
                stage_eligible,
                predictions,
                spec,
                evaluation_target=evaluation_target,
                synthetic_test_mode=synthetic_test_mode,
            )
            stage_metric["applicableCaseCount"] = len(stage_applicable)
            stage_metric["eligibleReviewedGoldCount"] = (
                0 if synthetic_test_mode else len(stage_eligible)
            )
            stage_metric["eligibleScoredAnnotationCount"] = len(stage_eligible)
            by_stage[stage] = stage_metric
    metric = _calculate_metric(
        dimension,
        applicable,
        eligible,
        predictions,
        spec,
        evaluation_target=evaluation_target,
        synthetic_test_mode=synthetic_test_mode,
    )
    total_reviewable = sum(1 for row in applicable if row["reviewStatus"] != "EXCLUDED")
    metric.update(
        {
            "applicableCaseCount": len(applicable),
            "eligibleReviewedGoldCount": 0 if synthetic_test_mode else len(eligible),
            "eligibleScoredAnnotationCount": len(eligible),
            "syntheticFixtureScoredCaseCount": len(eligible)
            if synthetic_test_mode
            else 0,
            "reviewCoverage": None
            if synthetic_test_mode
            else _ratio(len(eligible), total_reviewable),
            "excludedCaseCount": sum(
                1 for row in applicable if row["reviewStatus"] == "EXCLUDED"
            ),
            "candidateCaseCount": sum(
                1 for row in applicable if row["reviewStatus"] == "CANDIDATE"
            ),
            "uncertainOrProvisionalCaseCount": sum(
                1
                for row in applicable
                if row["reviewStatus"]
                in {"INDEPENDENT_REVIEW", "PROVISIONAL", "UNCERTAIN"}
                or (
                    row.get("reviewerDisagreements")
                    and row["reviewStatus"] != "ADJUDICATED"
                )
            ),
            "byStage": by_stage,
        }
    )
    if not applicable:
        metric["reviewCoverage"] = None
    return metric


def _calculate_metric(
    dimension: str,
    applicable: list[dict[str, Any]],
    eligible: list[dict[str, Any]],
    predictions: dict[str, dict[str, Any]],
    spec: dict[str, Any],
    *,
    evaluation_target: str = "ACTUAL_ASSESSMENT_OUTPUT",
    synthetic_test_mode: bool = False,
) -> dict[str, Any]:
    """Business purpose: Calculate a dimension's confusion matrix and class metrics.

    Business rules:
    - Confusion rows are gold labels and columns are normalized predictions.
    - Primary macro-F1 averages observed rubric labels only; missing and unknown remain error columns.
    - Missing or unknown outputs reduce true-class recall/F1 and remain in the full denominator.
    - Zero-support labels are omitted unless they have legitimate predicted support, which scores F1 zero.

    Execution flow:
    1. Resolve one normalized prediction for each eligible gold case.
    2. Count confusion cells and per-class true/false positives, false negatives, and support.
    3. Compute precision, recall, F1, macro-F1, and prediction coverage.

    Failure cases:
    - Dataset and prediction identity errors are rejected by the public scorer before calculation.

    Side effects:
    - None: pure arithmetic over immutable input values.
    """
    eligible_ids = {row["caseId"] for row in eligible}
    pairs: list[tuple[str, str]] = []
    missing = 0
    unknown = 0
    for record in eligible:
        prediction = predictions.get(record["caseId"])
        predicted = _prediction_label(
            dimension,
            prediction,
            spec,
            synthetic_test_mode=synthetic_test_mode,
        )
        gold = _expected_for_target(record, evaluation_target)[_field_name(dimension)][
            "label"
        ]
        if predicted is None:
            predicted = MISSING
            missing += 1
        elif predicted == UNKNOWN:
            unknown += 1
        pairs.append((gold, predicted))
    label_order = list(spec["labels"])
    gold_labels = sorted({gold for gold, _ in pairs}, key=label_order.index)
    predicted_rubric_labels = {
        predicted for _, predicted in pairs if predicted in label_order
    }
    metric_labels = [
        label
        for label in label_order
        if label in set(gold_labels) | predicted_rubric_labels
    ]
    prediction_labels = list(metric_labels)
    prediction_labels.extend(
        sentinel
        for sentinel in (MISSING, UNKNOWN)
        if any(predicted == sentinel for _, predicted in pairs)
    )
    matrix = {
        gold: {predicted: 0 for predicted in prediction_labels} for gold in gold_labels
    }
    for gold, predicted in pairs:
        matrix[gold][predicted] += 1
    per_class = {}
    f1_values = []
    for label in metric_labels:
        tp = matrix.get(label, {}).get(label, 0)
        gold_support = sum(matrix.get(label, {}).values())
        predicted_support = sum(matrix[actual].get(label, 0) for actual in gold_labels)
        fp = predicted_support - tp
        fn = gold_support - tp
        precision = _ratio(tp, predicted_support)
        recall = _ratio(tp, gold_support)
        f1 = _ratio(2 * tp, 2 * tp + fp + fn)
        per_class[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": gold_support,
            "predictedSupport": predicted_support,
            "falsePositives": fp,
            "falseNegatives": fn,
        }
        if f1 is not None:
            f1_values.append(f1)
    denominator = len(pairs)
    return {
        "status": "SCORED" if denominator else "NOT_SCORED",
        "dimension": dimension,
        "denominator": denominator,
        "scoringCoverage": _ratio(denominator - missing - unknown, denominator),
        "predictionCoverage": _ratio(denominator - missing, denominator),
        "missingPredictionCount": missing,
        "invalidPredictionCount": unknown,
        "unknownPredictionCount": unknown,
        "falsePositives": sum(item["falsePositives"] for item in per_class.values()),
        "falseNegatives": sum(item["falseNegatives"] for item in per_class.values()),
        "macroF1": _round(sum(f1_values) / len(f1_values)) if f1_values else None,
        "labels": prediction_labels,
        "macroF1Labels": metric_labels,
        "confusionMatrix": {
            "rows": "OBSERVED_GOLD_RUBRIC_LABELS",
            "columns": "RUBRIC_LABELS_AND_MISSING_UNKNOWN_ERRORS",
            "rowLabels": gold_labels,
            "columnLabels": prediction_labels,
            "cells": matrix,
        },
        "perClass": per_class,
        "classInclusionRule": "Macro-F1 uses legitimate rubric labels with gold or legitimate prediction support; error sentinels never become classes.",
        "denominatorRule": "Every eligible reviewed gold case for this dimension, including missing and unknown predictions.",
        "falsePositiveFalseNegativePolicy": "Aggregate multiclass rubric-label FP/FN totals; missing and unknown predictions add FN to their gold class and remain visible in error columns.",
        "reviewedCaseIds": sorted(eligible_ids),
    }


def _prediction_label(
    dimension: str,
    prediction: dict[str, Any] | None,
    spec: dict[str, Any],
    *,
    synthetic_test_mode: bool = False,
) -> str | None:
    """Business purpose: Accept only an explicit domain field or a separately reviewed judgment.

    Business rules:
    - No free-text matching or keyword heuristics may assign semantic correctness.
    - Applicability and compliance use only documented production-domain mappings.
    - All other dimensions, plus evaluation-only unresolved labels, require a reviewed human judgment.

    Execution flow:
    1. Read the normalized dimension value from the case output.
    2. Map supported production categorical values where the contract defines them.
    3. Otherwise require a human judgment with reviewer identity and verification evidence.

    Failure cases:
    - Missing fields return no prediction; unknown values return the UNKNOWN sentinel.
    - Invalid or unresolved human-review metadata is treated as a missing prediction.

    Side effects:
    - None: reads predictions and does not infer meaning from text.
    """
    if prediction is None:
        return None
    raw_dimensions = prediction.get("dimensionPredictions", {})
    if not isinstance(raw_dimensions, dict):
        return UNKNOWN
    if dimension in {"APPLICABILITY", "COMPLIANCE"}:
        if prediction.get("normalizationSource") == "P14_SAVED_ARTIFACTS":
            normalized_labels = prediction.get("evaluationLabelPredictions")
            if not _valid_p14_binding(prediction.get("p14Binding")) or not isinstance(
                normalized_labels, dict
            ):
                return UNKNOWN
            value = normalized_labels.get(_field_name(dimension))
            if value in {None, "UNRESOLVED"}:
                human_judgments = prediction.get("humanJudgments", {})
                judgment = (
                    human_judgments.get(_field_name(dimension))
                    if isinstance(human_judgments, dict)
                    else None
                )
                if _valid_human_judgment(
                    judgment,
                    dimension=dimension,
                    spec=spec,
                    prediction=prediction,
                    synthetic_test_mode=synthetic_test_mode,
                ):
                    value = judgment["label"]
        else:
            applicability, compliance = _assessment_domain_labels(raw_dimensions)
            value = applicability if dimension == "APPLICABILITY" else compliance
        if value is None and synthetic_test_mode:
            human_judgments = prediction.get("humanJudgments", {})
            judgment = (
                human_judgments.get(_field_name(dimension))
                if isinstance(human_judgments, dict)
                else None
            )
            if _valid_human_judgment(
                judgment,
                dimension=dimension,
                spec=spec,
                prediction=prediction,
                synthetic_test_mode=True,
            ):
                value = judgment["label"]
    else:
        raw = raw_dimensions.get(_field_name(dimension))
        human_judgments = prediction.get("humanJudgments", {})
        if not isinstance(human_judgments, dict):
            return UNKNOWN
        judgment = human_judgments.get(_field_name(dimension))
        if not _valid_human_judgment(
            judgment,
            dimension=dimension,
            spec=spec,
            prediction=prediction,
            synthetic_test_mode=synthetic_test_mode,
        ):
            return UNKNOWN if judgment is not None or raw is not None else None
        value = judgment["label"]
    if value is None:
        return None
    return value if isinstance(value, str) and value in set(spec["labels"]) else UNKNOWN


def _fixed_claim_binding(
    record: dict[str, Any],
    records: list[dict[str, Any]],
    rubric: dict[str, Any],
    source_pins: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose: Bind a fixed-claim judgment to one exact candidate, claim, source pin, and rubric.

    Business rules:
    - Fixed-claim diagnostics have no P14 execution and must not borrow a P14 review binding.
    - Candidate records, claim text, rubric version, and legal source pins define the review target.

    Execution flow:
    1. Read the exact predefined claim and candidate case identity.
    2. Compute dataset, claim, and source-pin digests.
    3. Return the required FIXED_CLAIM_DIAGNOSTIC binding.

    Failure cases:
    - Missing claim text raises ValueError before a review can be treated as bound.

    Side effects:
    - None: hashes supplied evaluation metadata only.
    """
    claim = record.get("claimUnderReview")
    if not isinstance(claim, str) or not claim:
        raise ValueError(f"FIXED_CLAIM_TEXT_MISSING:{record.get('caseId')}")
    return {
        "bindingKind": "FIXED_CLAIM_DIAGNOSTIC",
        "candidateCaseId": record["caseId"],
        "candidateDatasetSha256": _canonical_sha256(records),
        "claimSha256": sha256(claim.encode("utf-8")).hexdigest(),
        "rubricVersion": rubric["rubricVersion"],
        "sourcePinsSha256": _canonical_sha256(source_pins),
    }


def _valid_review_target_binding(binding: Any, prediction: dict[str, Any]) -> bool:
    """Business purpose: Validate review provenance according to the declared evaluation target.

    Business rules:
    - Assessment Root requires a complete P14 binding to one run, trial, trace, and observed output.
    - Preparation requires a distinct frozen-output/manifest/source/claim binding.
    - Fixed-claim diagnostics require the scorer-computed exact candidate and claim binding.
    - Structural validity is not reviewer authentication or artifact-byte verification.

    Execution flow:
    1. Read the explicit prediction target and target-specific binding.
    2. Validate the exact field set, case ID, SHA-256 values, and fixed-claim binding where available.
    3. Return False for cross-target, stale, incomplete, or malformed records.

    Failure cases:
    - Returns False for unknown targets, wrong binding types, malformed hashes, stale output fields, or target mismatch.

    Side effects:
    - None: checks local review metadata only.
    """
    target = prediction.get("evaluationTarget")
    if target is None and isinstance(prediction.get("p14Binding"), dict):
        target = "ACTUAL_ASSESSMENT_OUTPUT"
    if target == "ACTUAL_ASSESSMENT_OUTPUT":
        observed_binding = prediction.get("p14Binding")
        if not _valid_p14_binding(binding) or binding != observed_binding:
            return False
        return all(
            binding.get(binding_field) == prediction.get(prediction_field)
            for binding_field, prediction_field in (
                ("candidateCaseId", "caseId"),
                ("p14CaseId", "p14CaseId"),
                ("evaluationStage", "stage"),
                ("lifecycleStage", "lifecycleStage"),
                ("trialIndex", "trialIndex"),
                ("traceSha256", "traceSha256"),
                ("observedOutputSha256", "observedOutputSha256"),
            )
            if prediction_field in prediction
        )
    if not isinstance(binding, dict):
        return False
    if target == "RULE_SET_PREPARATION_OUTPUT":
        if (
            set(binding) != PREPARATION_BINDING_FIELDS
            or binding.get("bindingKind") != target
        ):
            return False
        if binding.get("candidateCaseId") != prediction.get("caseId"):
            return False
        for field in (
            "manifestSha256",
            "claimSha256",
            "outputSha256",
            "skillVersionDigest",
        ):
            if not isinstance(binding.get(field), str) or not re.fullmatch(
                r"[a-f0-9]{64}", binding[field]
            ):
                return False
        if (
            not isinstance(binding.get("instructionBundleDigest"), str)
            or not binding["instructionBundleDigest"].strip()
        ):
            return False
        if not all(
            isinstance(binding.get(field), str) and binding[field].strip()
            for field in ("runId", "sourceId", "sourceVersion", "claimId")
        ):
            return False
        if (
            not isinstance(binding.get("provisionRefs"), list)
            or not binding["provisionRefs"]
            or any(
                not isinstance(row, str) or not row for row in binding["provisionRefs"]
            )
        ):
            return False
        prediction_fields = {
            "runId": "runId",
            "manifestSha256": "manifestSha256",
            "sourceId": "sourceId",
            "sourceVersion": "sourceVersion",
            "provisionRefs": "provisionRefs",
            "claimId": "claimId",
            "claimSha256": "claimSha256",
            "outputSha256": "outputSha256",
            "instructionBundleDigest": "instructionBundleDigest",
            "skillVersionDigest": "skillVersionDigest",
        }
        return all(
            prediction.get(prediction_field) == binding[binding_field]
            for binding_field, prediction_field in prediction_fields.items()
        )
    if target == "FIXED_CLAIM_DIAGNOSTIC":
        expected = prediction.get("_expectedTargetBinding")
        return (
            set(binding) == FIXED_CLAIM_BINDING_FIELDS
            and binding.get("bindingKind") == target
            and binding.get("candidateCaseId") == prediction.get("caseId")
            and isinstance(expected, dict)
            and binding == expected
        )
    return False


def _is_synthetic_test_execution(
    records: list[dict[str, Any]], predictions: dict[str, Any]
) -> bool:
    """Business purpose: Isolate synthetic reviewer fixtures from actual quality evaluation.

    Business rules:
    - Synthetic references are accepted only when both annotation and prediction artifacts identify
      the exact synthetic-verification purpose and every case ID is namespaced as synthetic.
    - This switch never authenticates a reviewer and cannot be asserted by an ordinary P14 run.

    Execution flow:
    1. Check the explicit source classification and fixture-only marker.
    2. Require nonempty, fully synthetic case identity sets on both inputs.
    3. Return false for all mixed, missing, or actual-run inputs.

    Failure cases:
    - Any absent marker or non-synthetic identifier disables synthetic review allowance.

    Side effects:
    - None: checks local input metadata only.
    """
    record_ids = [row.get("caseId") for row in records if isinstance(row, dict)]
    prediction_rows = predictions.get("casePredictions")
    prediction_ids = (
        [row.get("caseId") for row in prediction_rows if isinstance(row, dict)]
        if isinstance(prediction_rows, list)
        else []
    )
    all_ids = record_ids + prediction_ids
    return (
        predictions.get("syntheticOnly") is True
        and predictions.get("sourceKind") == "SYNTHETIC_TEST_FIXTURE"
        and bool(all_ids)
        and all(
            isinstance(case_id, str) and case_id.startswith("synthetic-")
            for case_id in all_ids
        )
    )


def _assessment_domain_labels(
    raw_dimensions: dict[str, Any],
) -> tuple[str | None, str | None]:
    """Business purpose: Normalize Assessment Root applicability and compliance as one contract pair.

    Business rules:
    - RuleDecision requires an explicit applicability value and an explicit compliance key.
    - NOT_APPLICABLE pairs only with explicit null compliance; APPLICABLE pairs only with a compliance enum.
    - Missing, invalid, and unresolved fields remain distinct and are never silently converted to NOT_APPLICABLE.

    Execution flow:
    1. Check field presence and normalize the explicit applicability value.
    2. Validate compliance against the selected applicability branch.
    3. Return separate missing, invalid, and valid normalized values.

    Failure cases:
    - Invalid applicability/compliance combinations return UNKNOWN for both dimensions.
    - Absent fields return None for the absent dimension; absent applicability makes supplied compliance UNKNOWN.

    Side effects:
    - None: normalizes a contract value pair without interpreting legal facts.
    """
    applicability_present = "applicability" in raw_dimensions
    compliance_present = "compliance" in raw_dimensions
    if not applicability_present:
        return None, UNKNOWN if compliance_present else None
    applicability = raw_dimensions["applicability"]
    if applicability not in {"APPLICABLE", "NOT_APPLICABLE"}:
        return UNKNOWN, UNKNOWN if compliance_present else None
    if not compliance_present:
        return applicability, None
    compliance = raw_dimensions["compliance"]
    if applicability == "NOT_APPLICABLE":
        if compliance is None:
            return "NOT_APPLICABLE", "NOT_APPLICABLE"
        return UNKNOWN, UNKNOWN
    if compliance == "COMPLIANT":
        return "APPLICABLE", "SUPPORTED_COMPLIANCE"
    if compliance == "NON_COMPLIANT":
        return "APPLICABLE", "SUPPORTED_NON_COMPLIANCE"
    return "APPLICABLE", UNKNOWN


def _valid_human_judgment(
    judgment: Any,
    *,
    dimension: str,
    spec: dict[str, Any],
    prediction: dict[str, Any],
    synthetic_test_mode: bool = False,
) -> bool:
    """Business purpose: Gate free-text semantic scores on recorded human review provenance.

    Business rules:
    - A judgment label must belong to the rubric dimension and be backed by complete dimension-level human records.
    - Actual reviews require structural identity references, UTC times, independent adjudication, and an exact P14 output binding.
    - Structural references do not authenticate a reviewer; known synthetic records qualify only in isolated fixture mode.

    Execution flow:
    1. Validate the final label, reviewer identities, decision values, UTC times, and per-dimension labels.
    2. Reconcile reviewer disagreements and adjudication resolutions with the final dimension label.
    3. Bind the judgment to the exact P14 trial, trace, output digest, source, rule, and model configuration.
    4. Return False for malformed metadata instead of allowing an exception to interrupt scoring.

    Failure cases:
    - Missing fields, unknown labels, synthetic actual-mode references, stale bindings, or unresolved conflicts return false.

    Side effects:
    - None: performs read-only metadata validation.
    """
    try:
        if not isinstance(judgment, dict):
            return False
        if judgment.get("label") not in set(spec["labels"]):
            return False
        if judgment.get("reviewStatus") not in {"REVIEWED", "ADJUDICATED"}:
            return False
        reviewers = judgment.get("reviewers")
        if not isinstance(reviewers, list) or not reviewers:
            return False
        reviewer_ids: list[str] = []
        dimension_labels: dict[str, dict[str, str]] = {}
        for reviewer in reviewers:
            if (
                not isinstance(reviewer, dict)
                or reviewer.get("reviewerType") != "HUMAN"
            ):
                return False
            reviewer_id = reviewer.get("reviewerId")
            if not _valid_review_identity(
                reviewer_id,
                reviewer.get("identityVerificationRef"),
                allow_synthetic=synthetic_test_mode,
            ):
                return False
            reviewer_ids.append(reviewer_id)
            if not _valid_utc_timestamp(reviewer.get("reviewedAt")):
                return False
            if reviewer.get("decision") not in {"CONFIRM", "REVISE"}:
                return False
            judgments = reviewer.get("dimensionJudgments")
            dimensions = reviewer.get("dimensionsReviewed")
            if not isinstance(judgments, list) or not isinstance(dimensions, list):
                return False
            names = [
                item.get("dimension") for item in judgments if isinstance(item, dict)
            ]
            if (
                len(names) != len(judgments)
                or len(names) != len(set(names))
                or set(names) != set(dimensions)
            ):
                return False
            if set(dimensions) != {dimension}:
                return False
            for item in judgments:
                if (
                    item.get("dimension") not in DIMENSIONS
                    or not isinstance(item.get("label"), str)
                    or not item.get("rationale")
                ):
                    return False
                dimension_labels.setdefault(item["dimension"], {})[reviewer_id] = item[
                    "label"
                ]
            target = next(item for item in judgments if item["dimension"] == dimension)
            if target["label"] not in set(spec["labels"]):
                return False
            if (
                reviewer["decision"] == "CONFIRM"
                and target["label"] != judgment["label"]
            ):
                return False
            if reviewer["decision"] == "REVISE" and (
                judgment["reviewStatus"] != "ADJUDICATED"
                or target.get("priorLabel") is None
                or target["priorLabel"] == target["label"]
            ):
                return False
        if len(set(reviewer_ids)) != len(reviewer_ids):
            return False
        disagreement_rows = judgment.get("reviewerDisagreements")
        if not isinstance(disagreement_rows, list):
            return False
        disagreements = {
            row.get("dimension"): row
            for row in disagreement_rows
            if isinstance(row, dict)
        }
        if len(disagreements) != len(disagreement_rows):
            return False
        conflicting_dimensions = {
            name
            for name, values in dimension_labels.items()
            if len(set(values.values())) > 1
        }
        if set(disagreements) != conflicting_dimensions:
            return False
        for name, disagreement in disagreements.items():
            actual_labels = dimension_labels[name]
            proposed_rows = disagreement.get("proposedLabels")
            if not isinstance(proposed_rows, list):
                return False
            proposed = {
                row.get("reviewerId"): row.get("label")
                for row in proposed_rows
                if isinstance(row, dict)
            }
            if (
                len(proposed) != len(proposed_rows)
                or proposed != actual_labels
                or set(disagreement.get("reviewerIds", [])) != set(actual_labels)
            ):
                return False
        actual = dimension_labels.get(dimension, {})
        conflicting = dimension in conflicting_dimensions
        if judgment["reviewStatus"] == "REVIEWED":
            if disagreement_rows or any(
                label != judgment["label"] for label in actual.values()
            ):
                return False
            if any(row.get("decision") != "CONFIRM" for row in reviewers):
                return False
        else:
            adjudication = judgment.get("adjudication")
            if not isinstance(adjudication, dict):
                return False
            if (
                adjudication.get("reviewerType") != "HUMAN"
                or not _valid_review_identity(
                    adjudication.get("reviewerId"),
                    adjudication.get("identityVerificationRef"),
                    allow_synthetic=synthetic_test_mode,
                )
                or adjudication.get("reviewerId") in reviewer_ids
                or not _valid_review_identity(
                    adjudication.get("reviewerId"),
                    adjudication.get("reviewEvidenceRef"),
                    allow_synthetic=synthetic_test_mode,
                )
                or not _valid_utc_timestamp(adjudication.get("adjudicatedAt"))
                or adjudication.get("outcome") not in {"CONFIRM", "REVISE"}
            ):
                return False
            resolutions = adjudication.get("resolvedLabels")
            if not isinstance(resolutions, list):
                return False
            resolved = {
                row.get("dimension"): row
                for row in resolutions
                if isinstance(row, dict)
            }
            if len(resolved) != len(resolutions) or set(resolved) != {dimension}:
                return False
            if resolved[dimension].get("label") != judgment["label"]:
                return False
            if any(
                row.get("dimension") not in DIMENSIONS
                or not row.get("rationale")
                or (
                    row.get("dimension") == dimension
                    and row.get("label") not in set(spec["labels"])
                )
                for row in resolutions
            ):
                return False
            if adjudication["outcome"] == "REVISE" and not any(
                row.get("dimension") == dimension
                and row.get("priorLabel") is not None
                and row["priorLabel"] != row.get("label")
                for row in resolutions
            ):
                return False
        if conflicting:
            disagreement = disagreements.get(dimension)
            if not isinstance(disagreement, dict):
                return False
            proposed = {
                row.get("reviewerId"): row.get("label")
                for row in disagreement.get("proposedLabels", [])
                if isinstance(row, dict)
            }
            if (
                len(proposed) != len(disagreement.get("proposedLabels", []))
                or proposed != actual
                or set(disagreement.get("reviewerIds", [])) != set(actual)
                or judgment["reviewStatus"] != "ADJUDICATED"
            ):
                return False
        elif any(label != judgment["label"] for label in actual.values()):
            if judgment["reviewStatus"] != "ADJUDICATED":
                return False
            resolution = judgment["adjudication"]["resolvedLabels"]
            resolved = {row.get("dimension"): row for row in resolution}
            if (
                dimension not in resolved
                or resolved[dimension].get("label") != judgment["label"]
            ):
                return False
        if not synthetic_test_mode:
            binding = prediction.get("targetBinding", prediction.get("p14Binding"))
            if (
                not _valid_review_target_binding(binding, prediction)
                or judgment.get("targetBinding") != binding
            ):
                return False
        return True
    except (AttributeError, KeyError, TypeError, ValueError):
        return False


def _expected_for_target(
    record: dict[str, Any], evaluation_target: str
) -> dict[str, Any]:
    """Business purpose: Keep legal-outcome gold separate from fixed-claim diagnostic gold.

    Business rules:
    - Fixed-claim diagnostics use only the expected judgment of the supplied negative-control claim.
    - Generated Rule Set Preparation and Assessment Root outputs use scenario-level legal outcomes.
    - A target mismatch never falls back to another gold representation.

    Execution flow:
    1. Select the fixed diagnostic judgment block for its declared target.
    2. Otherwise select scenario expectations only when the record target exactly matches.
    3. Return an empty expectation mapping for an inapplicable record.

    Failure cases:
    - Missing or mismatched target metadata produces no dimensions and therefore no metric contribution.

    Side effects:
    - None: returns the chosen in-memory expectation mapping.
    """
    if record.get("evaluationTarget") != evaluation_target:
        return {}
    if evaluation_target == "FIXED_CLAIM_DIAGNOSTIC":
        fixed = record.get("fixedOutputDiagnostic")
        if isinstance(fixed, dict) and isinstance(fixed.get("expectedJudgments"), dict):
            return fixed["expectedJudgments"]
        return {}
    expected = record.get("expected")
    return expected if isinstance(expected, dict) else {}


def _eligible(record: dict[str, Any]) -> bool:
    """Business purpose: Keep provisional labels out of reviewed-gold metric denominators.

    Business rules:
    - Only review states REVIEWED and ADJUDICATED can qualify.
    - A REVIEWED record with any unresolved disagreement is not eligible.

    Execution flow:
    1. Check the review status.
    2. Check whether disagreement is resolved by recorded adjudication.
    3. Return the eligibility decision without changing the annotation.

    Failure cases:
    - Missing or invalid review metadata is ineligible and counted in review coverage.

    Side effects:
    - None: pure review-state predicate.
    """
    status = record.get("reviewStatus")
    return (
        status == "ADJUDICATED"
        and record.get("adjudication", {}).get("outcome") in {"CONFIRM", "REVISE"}
        or (status == "REVIEWED" and not record.get("reviewerDisagreements"))
    )


def _review_counts(
    records: list[dict[str, Any]], *, allow_synthetic: bool = False
) -> dict[str, int]:
    """Business purpose: Summarize dataset review coverage without promoting candidate annotations.

    Business rules:
    - Excluded, uncertain, and provisional rows are counted distinctly from reviewed gold.
    - This inventory never describes fixture-only review metadata as real reviewer activity.

    Execution flow:
    1. Count review statuses and identify unresolved disagreement records.
    2. Return reviewed, excluded, uncertain, and candidate totals.

    Failure cases:
    - A row with a status outside the seven review states is rejected during annotation schema validation before these counts are built.

    Side effects:
    - None: pure aggregate of the supplied dataset.
    """
    status_counts: dict[str, int] = {}
    unresolved = 0
    for record in records:
        status = record["reviewStatus"]
        status_counts[status] = status_counts.get(status, 0) + 1
        if record.get("reviewerDisagreements") and status != "ADJUDICATED":
            unresolved += 1
    return {
        "candidateAnnotationCount": status_counts.get("CANDIDATE", 0),
        "humanReviewedAnnotationCount": (
            0
            if not allow_synthetic
            else sum(1 for record in records if _eligible(record))
        ),
        "provisionalOrUncertainAnnotationCount": sum(
            1
            for record in records
            if record["reviewStatus"]
            in {"INDEPENDENT_REVIEW", "PROVISIONAL", "UNCERTAIN"}
            or (
                record.get("reviewerDisagreements")
                and record["reviewStatus"] != "ADJUDICATED"
            )
        ),
        "excludedAnnotationCount": status_counts.get("EXCLUDED", 0),
        "unresolvedDisagreementCount": unresolved,
        "reviewStatusCounts": dict(sorted(status_counts.items())),
    }


def _field_name(dimension: str) -> str:
    """Business purpose: Resolve stable report dimensions to normalized case property keys.

    Business rules:
    - Every supported evaluation dimension has one canonical camel-case input key.
    - Unknown dimensions fail rather than being silently routed to a different rubric field.

    Execution flow:
    1. Validate membership in the scorer's dimension registry.
    2. Return the documented property name.

    Failure cases:
    - An unregistered dimension raises ValueError.

    Side effects:
    - None: pure name mapping.
    """
    if dimension not in DIMENSIONS:
        raise ValueError(f"SCORER_DIMENSION_UNKNOWN:{dimension}")
    return {
        "APPLICABILITY": "applicability",
        "COMPLIANCE": "compliance",
        "ACTOR": "actor",
        "CONDITIONS": "conditions",
        "EXCEPTIONS": "exceptions",
        "EVIDENCE_SUFFICIENCY": "evidenceSufficiency",
        "UNSUPPORTED_CONCLUSION": "unsupportedConclusion",
    }[dimension]


def _ratio(numerator: int, denominator: int) -> float | None:
    """Business purpose: Keep undefined class metrics explicit when their denominator is zero.

    Business rules:
    - A zero denominator is undefined and is reported as null, never as 0% or 100%.
    - Defined ratios are rounded consistently to six decimal places.

    Execution flow:
    1. Return no value for a zero denominator.
    2. Otherwise calculate and round the ratio.

    Failure cases:
    - None; callers supply integer count metrics.

    Side effects:
    - None: pure arithmetic.
    """
    return _round(numerator / denominator) if denominator else None


def _round(value: float) -> float:
    """Business purpose: Provide a stable precision for reportable metric ratios.

    Business rules:
    - Scorer outputs use six fractional digits for deterministic report comparison.

    Execution flow:
    1. Round the value to the reporting precision.

    Failure cases:
    - None; callers supply finite calculated ratios.

    Side effects:
    - None: pure arithmetic.
    """
    return round(value, 6)


def _canonical_sha256(value: Any) -> str:
    """Business purpose: Fingerprint exact normalized scorer inputs for later reproduction.

    Business rules:
    - Digests cover canonical UTF-8 JSON content and never imply legal approval or model accuracy.
    - Key ordering and whitespace are normalized; case ordering remains part of dataset identity.

    Execution flow:
    1. Serialize one supplied input with stable keys and separators.
    2. Hash the resulting UTF-8 bytes with SHA-256.

    Failure cases:
    - Values that are not JSON serializable fail rather than receive an unstable digest.

    Side effects:
    - None: computes a digest without writing the input.
    """
    canonical = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return sha256(canonical.encode("utf-8")).hexdigest()


def _empty_metric() -> dict[str, Any]:
    """Business purpose: Return an explicit not-scored report for an inapplicable stage.

    Business rules:
    - No denominator means no quality score; metric fields remain null.

    Execution flow:
    1. Return a stable object with zero denominator and null metrics.

    Failure cases:
    - This formatter is called only after the scorer has validated the rubric and stage; malformed rubric input is rejected by the public scoring function before this report shape is produced.

    Side effects:
    - None: returns a fresh in-memory value.
    """
    return {
        "status": "NOT_SCORED",
        "denominator": 0,
        "macroF1": None,
        "confusionMatrix": None,
        "perClass": {},
        "missingPredictionCount": 0,
        "invalidPredictionCount": 0,
        "falsePositives": 0,
        "falseNegatives": 0,
    }


def _read_json(path: Path) -> Any:
    """Business purpose: Load one local JSON input for the offline scorer command.

    Business rules:
    - CLI inputs are read as UTF-8 JSON and are never sourced from a provider or network.

    Execution flow:
    1. Read the local file.
    2. Parse it as JSON and return the value.

    Failure cases:
    - I/O and JSON parse errors are surfaced to the caller.

    Side effects:
    - None beyond read-only access to an explicitly supplied local file.
    """
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    """Business purpose: Run the deterministic scorer on explicit local annotation inputs.

    Business rules:
    - The scorer performs no model call and writes only the caller-requested report file.
    - Candidate-only datasets produce NOT_SCORED instead of a misleading quality percentage.

    Execution flow:
    1. Parse dataset, predictions, rubric, source pin, and output paths.
    2. Load and score the supplied files.
    3. Write stable sorted JSON and return success.

    Failure cases:
    - Invalid files or annotations produce a non-zero process error.

    Side effects:
    - Reads the supplied local files and writes one report to the explicit output path.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--rubric", type=Path, default=PACKAGE_ROOT / "rubric.vn-ai.v1.json"
    )
    parser.add_argument(
        "--source-pins", type=Path, default=PACKAGE_ROOT / "source-pins.vn-ai.v1.json"
    )
    args = parser.parse_args()
    from evals.legal_reasoning.validation import load_dataset

    result = score_dataset(
        load_dataset(args.dataset),
        _read_json(args.predictions),
        _read_json(args.rubric),
        _read_json(args.source_pins),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"{result['scoringStatus']}: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
