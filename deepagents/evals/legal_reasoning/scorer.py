"""Deterministic, provider-free scorer for reviewed LCSP-400 annotations."""

from __future__ import annotations

import argparse
import json
from hashlib import sha256
from pathlib import Path
from typing import Any

from evals.legal_reasoning.validation import PACKAGE_ROOT, validate_dataset

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


def score_dataset(
    records: list[dict[str, Any]],
    predictions: dict[str, Any],
    rubric: dict[str, Any],
    source_pins: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose: Compare observed categorical outputs with genuinely reviewed legal labels.

    Business rules:
    - Only REVIEWED or ADJUDICATED annotations with human evidence metadata enter quality metrics.
    - Explicit Assessment Root domain values are normalized only through documented contract maps;
      semantic judgments of free text must arrive as separately reviewed human judgments.
    - Missing and unknown predictions remain in the denominator and confusion matrix; no result is
      reported as an accuracy score when the eligible denominator is zero.

    Execution flow:
    1. Validate dataset provenance, labels, and review states, then validate unique prediction IDs.
    2. Resolve one prediction per expected dimension, using an explicit field or a reviewed judgment.
    3. Build stage/dimension confusion matrices and per-class precision, recall, F1, and coverage.
    4. Return separately grouped semantic and evidence reports with deterministic ordering.

    Failure cases:
    - Invalid gold, duplicate identifiers, malformed outputs, or unsupported domain mappings raise
      ValueError; unknown output labels are counted as UNKNOWN instead of silently discarded.

    Side effects:
    - None: computes from supplied data only; no model, network, persistence, or production writes.
    """
    if not isinstance(predictions, dict):
        raise TypeError("PREDICTIONS_OBJECT_REQUIRED")
    validate_dataset(records, rubric, source_pins)
    if predictions.get("predictionVersion") != "LCSP-400-NORMALIZED-PREDICTIONS-V1":
        raise ValueError("PREDICTIONS_VERSION_INVALID")
    prediction_rows = predictions.get("casePredictions")
    if not isinstance(prediction_rows, list):
        raise TypeError("PREDICTIONS_CASES_REQUIRED")
    prediction_by_id: dict[str, dict[str, Any]] = {}
    record_by_id = {record["caseId"]: record for record in records}
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
        prediction_by_id[case_id] = row

    all_counts = _review_counts(records)
    per_dimension: dict[str, Any] = {}
    for dimension in DIMENSIONS:
        per_dimension[dimension] = _score_dimension(
            dimension, records, prediction_by_id, rubric, all_counts
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

    return {
        "reportVersion": "LCSP-400-SCORER-REPORT-V1",
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
                for record in records
                if _eligible(record) and record["caseId"] not in prediction_by_id
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
        if row["expected"].get(_field_name(dimension)) is not None
    ]
    eligible = [row for row in applicable if _eligible(row)]
    by_stage: dict[str, Any] = {}
    for stage in STAGES:
        stage_applicable = [row for row in applicable if row["stage"] == stage]
        stage_eligible = [row for row in eligible if row["stage"] == stage]
        if stage_applicable:
            stage_metric = _calculate_metric(
                dimension, stage_applicable, stage_eligible, predictions, spec
            )
            stage_metric["applicableCaseCount"] = len(stage_applicable)
            stage_metric["eligibleReviewedGoldCount"] = len(stage_eligible)
            by_stage[stage] = stage_metric
    metric = _calculate_metric(dimension, applicable, eligible, predictions, spec)
    total_reviewable = sum(1 for row in applicable if row["reviewStatus"] != "EXCLUDED")
    metric.update(
        {
            "applicableCaseCount": len(applicable),
            "eligibleReviewedGoldCount": len(eligible),
            "reviewCoverage": _ratio(len(eligible), total_reviewable),
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
) -> dict[str, Any]:
    """Business purpose: Calculate a dimension's confusion matrix and class metrics.

    Business rules:
    - Confusion rows are gold labels and columns are normalized predictions.
    - Macro-F1 includes labels with gold or predicted support; absent classes are omitted.
    - A zero denominator returns null, while missing and unknown predictions are explicit classes.

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
        predicted = _prediction_label(dimension, prediction, spec)
        gold = record["expected"][_field_name(dimension)]["label"]
        if predicted is None:
            predicted = MISSING
            missing += 1
        elif predicted == UNKNOWN:
            unknown += 1
        pairs.append((gold, predicted))
    label_order = list(spec["labels"])
    observed_labels = {label for pair in pairs for label in pair}
    labels = [label for label in label_order if label in observed_labels]
    labels.extend(label for label in (MISSING, UNKNOWN) if label in observed_labels)
    matrix = {gold: {predicted: 0 for predicted in labels} for gold in labels}
    for gold, predicted in pairs:
        matrix[gold][predicted] += 1
    per_class = {}
    f1_values = []
    for label in labels:
        tp = matrix[label][label]
        gold_support = sum(matrix[label].values())
        predicted_support = sum(matrix[actual][label] for actual in labels)
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
        "labels": labels,
        "confusionMatrix": {
            "rows": "GOLD",
            "columns": "PREDICTION",
            "labels": labels,
            "cells": matrix,
        },
        "perClass": per_class,
        "classInclusionRule": "Union of labels with gold or prediction support; absent labels are omitted.",
        "denominatorRule": "Every eligible reviewed gold case for this dimension, including missing and unknown predictions.",
        "reviewedCaseIds": sorted(eligible_ids),
    }


def _prediction_label(
    dimension: str, prediction: dict[str, Any] | None, spec: dict[str, Any]
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
    raw = raw_dimensions.get(_field_name(dimension))
    if (
        dimension == "APPLICABILITY"
        and isinstance(raw, str)
        and raw in {"APPLICABLE", "NOT_APPLICABLE"}
    ):
        value = raw
    elif (
        dimension == "COMPLIANCE"
        and isinstance(raw, str)
        and raw in {"COMPLIANT", "NON_COMPLIANT"}
    ):
        value = {
            "COMPLIANT": "SUPPORTED_COMPLIANCE",
            "NON_COMPLIANT": "SUPPORTED_NON_COMPLIANCE",
        }[raw]
    elif (
        dimension == "COMPLIANCE"
        and raw is None
        and raw_dimensions.get("applicability") == "NOT_APPLICABLE"
    ):
        value = "NOT_APPLICABLE"
    else:
        human_judgments = prediction.get("humanJudgments", {})
        if not isinstance(human_judgments, dict):
            return UNKNOWN
        judgment = human_judgments.get(_field_name(dimension))
        if not _valid_human_judgment(judgment):
            return None if raw is None else UNKNOWN
        value = judgment["label"]
    return value if isinstance(value, str) and value in set(spec["labels"]) else UNKNOWN


def _valid_human_judgment(judgment: Any) -> bool:
    """Business purpose: Gate free-text semantic scores on recorded human review provenance.

    Business rules:
    - A judgment is usable only with REVIEWED/ADJUDICATED state and at least one identified human.
    - Each reviewer must include an identity-verification reference and timestamp.
    - An unresolved disagreement makes the observed judgment ineligible.

    Execution flow:
    1. Check review status and disagreement/adjudication consistency.
    2. Require one or more complete human reviewer records.
    3. Return whether the label has an admissible human review record.

    Failure cases:
    - Missing, synthetic-only-free-form, or conflicting metadata returns false.

    Side effects:
    - None: performs read-only metadata validation.
    """
    if not isinstance(judgment, dict) or judgment.get("reviewStatus") not in {
        "REVIEWED",
        "ADJUDICATED",
    }:
        return False
    if (
        judgment.get("reviewerDisagreements")
        and judgment.get("reviewStatus") != "ADJUDICATED"
    ):
        return False
    reviewers = judgment.get("reviewers")
    reviewers_valid = bool(reviewers) and all(
        isinstance(reviewer, dict)
        and reviewer.get("reviewerType") == "HUMAN"
        and reviewer.get("reviewerId")
        and reviewer.get("identityVerificationRef")
        and reviewer.get("reviewedAt")
        for reviewer in reviewers
    )
    if not reviewers_valid:
        return False
    if judgment.get("reviewStatus") == "ADJUDICATED":
        adjudication = judgment.get("adjudication")
        return bool(
            isinstance(adjudication, dict)
            and adjudication.get("reviewerType") == "HUMAN"
            and adjudication.get("reviewerId")
            and adjudication.get("identityVerificationRef")
            and adjudication.get("reviewEvidenceRef")
            and adjudication.get("outcome") in {"CONFIRM", "REVISE"}
        )
    return all(reviewer.get("decision") != "UNSURE" for reviewer in reviewers)


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


def _review_counts(records: list[dict[str, Any]]) -> dict[str, int]:
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
        "humanReviewedAnnotationCount": sum(
            1 for record in records if _eligible(record)
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
    parser.add_argument("--rubric", type=Path, default=PACKAGE_ROOT / "rubric.v1.json")
    parser.add_argument(
        "--source-pins", type=Path, default=PACKAGE_ROOT / "source-pins.v1.json"
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
