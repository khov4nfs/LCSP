"""Offline LCSP Jev decision evaluation over frozen response fixtures."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

from .contracts import DecisionRequest, DecisionResult
from .policy import DEFAULT_DECISION_POLICIES
from .typesafe_client import TypeSafeJevError, _map_response


DEFAULT_DATASET = Path(__file__).with_name("eval_fixtures") / "lcsp_decision_eval_v1.json"
DEFAULT_THRESHOLDS = (0.5, 0.7, 0.8, 0.85, 0.9)


@dataclass(frozen=True)
class EvalRecord:
    record_id: str
    decision_class: str
    risk_tier: str
    expected_decision: Any
    expected_questions: dict[str, Any]
    expected_ranking: tuple[str, ...]
    label_source: str
    request: DecisionRequest
    response: dict[str, Any] | None
    fixture_status: str
    latency_ms: int
    baseline_latency_ms: int | None
    removed_generative_calls: int
    baseline_input_tokens: int | None
    baseline_output_tokens: int | None
    artifact_metadata: dict[str, Any]


@dataclass(frozen=True)
class QuestionEvaluation:
    question_id: str
    question_type: str
    predicted: Any
    expected: Any
    correct: bool
    confidence: float
    probability: float | None
    safety_relevant: bool
    actual_positive: bool
    predicted_positive: bool


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate LCSP Jev decision fixtures without live credentials."
    )
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET))
    parser.add_argument("--output", default=None)
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--require-policy-pass", action="store_true")
    args = parser.parse_args(argv)

    report = evaluate_dataset(Path(args.dataset))
    encoded = json.dumps(report, indent=2 if args.pretty else None, sort_keys=True)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)
    return 1 if args.require_policy_pass and not report["policy"]["passed"] else 0


def evaluate_dataset(path: Path = DEFAULT_DATASET) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    records = [_record(item) for item in raw["records"]]
    dataset_hash = "sha256:" + sha256(
        json.dumps(raw, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    per_version: dict[str, list[tuple[EvalRecord, DecisionResult | None, str | None]]] = defaultdict(list)
    for record in records:
        result: DecisionResult | None = None
        failure: str | None = None
        if record.response is None or record.fixture_status != "OK":
            failure = record.fixture_status
        else:
            try:
                result = _map_response(
                    request=record.request,
                    response=record.response,
                    policy_version=record.request.policy_version or "LCSP_JEV_EVAL_POLICY_V1",
                    latency_ms=record.latency_ms,
                )
            except TypeSafeJevError as exc:
                failure = exc.reason_code
        model_version = result.model_version if result else "NO_PROVIDER_RESULT"
        per_version[model_version].append((record, result, failure))

    version_reports = {
        model_version: _metrics_for_group(model_version, items)
        for model_version, items in sorted(per_version.items())
    }
    all_items = [item for items in per_version.values() for item in items]
    decision_reports = _per_decision_metrics(
        all_items,
        dataset_version=raw["dataset_version"],
        dataset_hash=dataset_hash,
    )
    policy = _activation_policy(decision_reports, version_reports)
    return {
        "schemaVersion": "LCSP_JEV_DECISION_EVAL_REPORT_V1",
        "dataset": {
            "id": raw["dataset_id"],
            "version": raw["dataset_version"],
            "hash": dataset_hash,
            "recordCount": len(records),
        },
        "models": version_reports,
        "perDecision": decision_reports,
        "policy": policy,
    }


def _metrics_for_group(
    model_version: str,
    items: list[tuple[EvalRecord, DecisionResult | None, str | None]],
) -> dict[str, Any]:
    records = [record for record, _, _ in items]
    successes = [(record, result) for record, result, failure in items if result and not failure]
    failures = [failure for _, _, failure in items if failure]
    question_evaluations = _question_evaluations(successes)
    agreements = [item.correct for item in question_evaluations]
    confidences = [result.confidence for _, result in successes]
    latencies = [record.latency_ms for record in records]
    usage = [_usage(result) for _, result in successes]
    safety_questions = [item for item in question_evaluations if item.safety_relevant]
    ranking_metrics = _ranking_metrics(successes)
    return {
        "modelVersion": model_version,
        "recordCount": len(records),
        "agreementAccuracy": _ratio(sum(agreements), len(agreements)),
        "brierScore": _brier(successes),
        "expectedCalibrationError": _ece(successes),
        "questionMetrics": _question_metrics(question_evaluations),
        "rankingMetrics": ranking_metrics,
        "confidenceDistribution": _confidence_distribution(confidences),
        "coverageByThreshold": _coverage(confidences),
        "highRiskFalseNegativeRate": _false_negative_rate(safety_questions),
        "safetyQuestionCount": len({item.question_id for item in safety_questions}),
        "providerSchemaFailureRate": _failure_rate(failures, "PROVIDER_SCHEMA_INVALID", len(records)),
        "timeoutRate": _failure_rate(failures, "PROVIDER_TIMEOUT", len(records)),
        "fallbackRate": _ratio(len(failures), len(records)),
        "driftDetected": _drift_detected(model_version),
        "performance": {
            "p50LatencyMs": _percentile(latencies, 0.50),
            "p95LatencyMs": _percentile(latencies, 0.95),
            "jevProviderCost": round(sum(item["cost"] for item in usage), 6),
            "removedGenerativeCalls": sum(record.removed_generative_calls for record in records),
            "reasoningInputTokenReduction": _token_reduction(records, "input"),
            "reasoningOutputTokenReduction": _token_reduction(records, "output"),
            "stageLatencyChangeMs": _stage_latency_change(records),
        },
    }


def _per_decision_metrics(
    items: list[tuple[EvalRecord, DecisionResult | None, str | None]],
    *,
    dataset_version: str,
    dataset_hash: str,
) -> dict[str, Any]:
    grouped: dict[str, list[tuple[EvalRecord, DecisionResult | None, str | None]]] = defaultdict(list)
    for item in items:
        grouped[item[0].decision_class].append(item)
    return {
        decision_type: _decision_policy_state(
            decision_type,
            decision_items,
            dataset_version=dataset_version,
            dataset_hash=dataset_hash,
        )
        for decision_type, decision_items in sorted(grouped.items())
    }


def _decision_policy_state(
    decision_type: str,
    items: list[tuple[EvalRecord, DecisionResult | None, str | None]],
    *,
    dataset_version: str,
    dataset_hash: str,
) -> dict[str, Any]:
    policy = DEFAULT_DECISION_POLICIES.get(decision_type)
    records = [record for record, _, _ in items]
    sample_size = len(records)
    by_model: dict[str, list[tuple[EvalRecord, DecisionResult | None, str | None]]] = defaultdict(list)
    for item in items:
        model_version = item[1].model_version if item[1] else "NO_PROVIDER_RESULT"
        by_model[model_version].append(item)
    model_reports = {
        model_version: _decision_model_policy_state(
            decision_type,
            model_version,
            model_items,
            dataset_version=dataset_version,
            dataset_hash=dataset_hash,
        )
        for model_version, model_items in sorted(by_model.items())
    }
    return {
        "sampleSize": sample_size,
        "riskTierCounts": _counts(record.risk_tier for record in records),
        "labelSources": _counts(record.label_source for record in records),
        "activationMode": "SHADOW",
        "activationRecommendation": "REMAIN_SHADOW",
        "models": model_reports,
        "requirements": _aggregate_requirements(model_reports, policy is not None),
    }


def _decision_model_policy_state(
    decision_type: str,
    model_version: str,
    items: list[tuple[EvalRecord, DecisionResult | None, str | None]],
    *,
    dataset_version: str,
    dataset_hash: str,
) -> dict[str, Any]:
    policy = DEFAULT_DECISION_POLICIES.get(decision_type)
    metrics = _metrics_for_group(model_version, items)
    sample_size = metrics["recordCount"]
    quality_score = metrics["agreementAccuracy"]
    false_negative_rate = metrics["highRiskFalseNegativeRate"]
    expected_calibration_error = metrics["expectedCalibrationError"]
    safety_question_count = metrics["safetyQuestionCount"]
    safety_metrics_covered = bool(
        policy and safety_question_count >= len(policy.safety_question_ids)
    )
    bounded_false_negative_rate_passed = bool(
        policy
        and (
            not (policy.safety_critical or policy.safety_question_ids)
            or (
                safety_metrics_covered
                and false_negative_rate is not None
                and false_negative_rate <= policy.max_false_negative_rate
            )
        )
    )
    requirements = {
        "sufficientEvalSampleSize": bool(
            policy and sample_size >= policy.min_eval_sample_size
        ),
        "decisionClassQualityPassed": bool(
            policy and quality_score is not None and quality_score >= policy.min_quality_score
        ),
        "boundedFalseNegativeRatePassed": bounded_false_negative_rate_passed,
        "safetyQuestionMetricsCovered": safety_metrics_covered,
        "acceptableCalibrationPassed": bool(
            policy
            and expected_calibration_error is not None
            and expected_calibration_error <= policy.max_expected_calibration_error
        ),
        "privacyFindingClear": bool(policy and policy.privacy_review_clear),
        "fallbackPathTested": bool(policy and policy.fallback_path_tested),
        "exactModelVersionCaptured": model_version != "NO_PROVIDER_RESULT",
        "rollbackSwitchAvailable": bool(policy and policy.rollback_switch_available),
    }
    return {
        **metrics,
        "datasetVersion": dataset_version,
        "datasetHash": dataset_hash,
        "activationMode": "SHADOW",
        "activationRecommendation": (
            "PROMOTION_ELIGIBLE_BY_ALLOWLIST"
            if all(requirements.values()) and bool(policy and policy.active_allowed)
            else "REMAIN_SHADOW"
        ),
        "requirements": requirements,
        "activationEvidence": {
            "decisionType": decision_type,
            "modelVersion": model_version,
            "datasetVersion": dataset_version,
            "datasetHash": dataset_hash,
            "policyVersion": _policy_version(items),
            "sampleSize": sample_size,
            "qualityScore": quality_score,
            "falseNegativeRate": false_negative_rate,
            "safetyQuestionCount": safety_question_count,
            "safetyQuestionMetrics": {
                question_id: metrics["questionMetrics"][question_id]
                for question_id in policy.safety_question_ids
                if question_id in metrics["questionMetrics"]
            }
            if policy
            else {},
            "expectedCalibrationError": expected_calibration_error,
            "fallbackPathTested": bool(policy and policy.fallback_path_tested),
            "privacyReviewClear": bool(policy and policy.privacy_review_clear),
            "rollbackSwitchAvailable": bool(policy and policy.rollback_switch_available),
        },
    }


def _aggregate_requirements(
    model_reports: dict[str, Any],
    has_policy: bool,
) -> dict[str, bool]:
    if not has_policy or not model_reports:
        return {
            "sufficientEvalSampleSize": False,
            "decisionClassQualityPassed": False,
            "boundedFalseNegativeRatePassed": False,
            "safetyQuestionMetricsCovered": False,
            "acceptableCalibrationPassed": False,
            "privacyFindingClear": False,
            "fallbackPathTested": False,
            "exactModelVersionCaptured": False,
            "rollbackSwitchAvailable": False,
        }
    keys = next(iter(model_reports.values()))["requirements"].keys()
    return {
        key: any(report["requirements"].get(key) is True for report in model_reports.values())
        for key in keys
    }


def _activation_policy(
    decision_reports: dict[str, Any],
    version_reports: dict[str, Any],
) -> dict[str, Any]:
    blocked = []
    for decision_type, report in decision_reports.items():
        for model_version, model_report in report["models"].items():
            missing = [
                key
                for key, value in model_report["requirements"].items()
                if value is not True
            ]
            if missing:
                blocked.append(
                    {
                        "decisionType": decision_type,
                        "modelVersion": model_version,
                        "missing": missing,
                    }
                )
    drifted = [
        version
        for version, report in version_reports.items()
        if report.get("driftDetected") is True
    ]
    return {
        "passed": len(blocked) == 0 and len(drifted) == 0,
        "defaultMode": "SHADOW",
        "recommendation": "DO_NOT_PROMOTE" if blocked or drifted else "PROMOTION_ELIGIBLE_BY_ALLOWLIST",
        "blockedDecisionTypes": blocked,
        "driftedModelVersions": drifted,
        "permanentExclusions": [
            "LEGAL",
            "COMPLIANCE",
            "FINAL_RISK",
            "FINAL_READINESS",
            "FINAL_ASSESSMENT",
        ],
    }


def _record(value: dict[str, Any]) -> EvalRecord:
    return EvalRecord(
        record_id=value["record_id"],
        decision_class=value["decision_class"],
        risk_tier=value["risk_tier"],
        expected_decision=value["expected_decision"],
        expected_questions=_expected_questions(value),
        expected_ranking=tuple(value.get("expected_ranking") or ()),
        label_source=value["label_source"],
        request=DecisionRequest(**value["request"]),
        response=value.get("captured_response"),
        fixture_status=value.get("fixture_status", "OK"),
        latency_ms=int(value.get("latency_ms", 0)),
        baseline_latency_ms=value.get("baseline_latency_ms"),
        removed_generative_calls=int(value.get("removed_generative_calls", 0)),
        baseline_input_tokens=value.get("baseline_input_tokens"),
        baseline_output_tokens=value.get("baseline_output_tokens"),
        artifact_metadata=dict(value.get("artifact_metadata") or {}),
    )


def _policy_version(
    items: list[tuple[EvalRecord, DecisionResult | None, str | None]],
) -> str | None:
    versions = {
        result.policy_version
        for _, result, failure in items
        if result is not None and failure is None
    }
    if len(versions) == 1:
        return next(iter(versions))
    request_versions = {
        record.request.policy_version
        for record, _, _ in items
        if record.request.policy_version
    }
    return next(iter(request_versions)) if len(request_versions) == 1 else None


def _expected_questions(value: dict[str, Any]) -> dict[str, Any]:
    explicit = value.get("expected_questions")
    if isinstance(explicit, dict) and explicit:
        return dict(explicit)
    questions = value.get("request", {}).get("questions") or []
    primary = (
        questions[0].get("question_id")
        if questions and isinstance(questions[0], dict)
        else None
    )
    return {str(primary): value["expected_decision"]} if primary else {}


def _question_evaluations(
    items: list[tuple[EvalRecord, DecisionResult]],
) -> list[QuestionEvaluation]:
    evaluations: list[QuestionEvaluation] = []
    for record, result in items:
        expected_by_question = record.expected_questions
        for question in result.question_results:
            if question.question_id not in expected_by_question:
                continue
            predicted = _question_prediction(question)
            expected = expected_by_question[question.question_id]
            if not _single_label(predicted) and not isinstance(predicted, dict):
                continue
            actual_positive = _actual_positive(question.question_id, expected)
            predicted_positive = _predicted_positive(question.question_id, predicted)
            evaluations.append(
                QuestionEvaluation(
                    question_id=question.question_id,
                    question_type=question.question_type,
                    predicted=predicted,
                    expected=expected,
                    correct=_labels_equal(predicted, expected),
                    confidence=question.confidence,
                    probability=question.probability,
                    safety_relevant=_is_safety_question(question.question_id, record),
                    actual_positive=actual_positive,
                    predicted_positive=predicted_positive,
                )
            )
    return evaluations


def _question_prediction(question: Any) -> Any:
    if question.selected_choice is not None:
        return question.selected_choice
    if question.score is not None:
        return question.score
    return question.noul


def _labels_equal(predicted: Any, expected: Any) -> bool:
    if isinstance(expected, dict):
        return isinstance(predicted, dict) and all(
            predicted.get(key) == value for key, value in expected.items()
        )
    return predicted == expected


def _is_safety_question(question_id: str, record: EvalRecord) -> bool:
    policy = DEFAULT_DECISION_POLICIES.get(record.decision_class)
    if policy and question_id in policy.safety_question_ids:
        return True
    return question_id in {
        "needs_deep_review",
        "needs_reasoning_escalation",
        "material_customer_fact_unresolved",
        "current_context_sufficient",
    }


def _actual_positive(question_id: str, expected: Any) -> bool:
    if isinstance(expected, dict) and isinstance(expected.get("value"), bool):
        return _positive_boolean(question_id, expected["value"])
    if isinstance(expected, bool):
        return _positive_boolean(question_id, expected)
    return expected in {"ESCALATE", "DEEP_REVIEW", "NEEDS_INPUT", "TRACE_STATIC_FLOW"}


def _predicted_positive(question_id: str, predicted: Any) -> bool:
    if isinstance(predicted, dict) and isinstance(predicted.get("value"), bool):
        return _positive_boolean(question_id, predicted["value"])
    if isinstance(predicted, bool):
        return _positive_boolean(question_id, predicted)
    return predicted in {"ESCALATE", "DEEP_REVIEW", "NEEDS_INPUT", "TRACE_STATIC_FLOW"}


def _positive_boolean(question_id: str, value: bool) -> bool:
    if question_id == "current_context_sufficient":
        return value is False
    return value is True


def _single_label(value: Any) -> bool:
    return isinstance(value, str | bool | int | float)


def _usage(result: DecisionResult) -> dict[str, float]:
    usage = result.usage
    return {
        "cost": float(usage.get("costUsd") or usage.get("cost_usd") or 0.0),
        "input": float(usage.get("inputTokens") or usage.get("input_tokens") or 0.0),
        "output": float(usage.get("outputTokens") or usage.get("output_tokens") or 0.0),
    }


def _brier(items: list[tuple[EvalRecord, DecisionResult]]) -> float | None:
    values = []
    for evaluation in _question_evaluations(items):
        probability = evaluation.probability
        if probability is None:
            continue
        actual = 1.0 if evaluation.correct else 0.0
        values.append((probability - actual) ** 2)
    return round(sum(values) / len(values), 6) if values else None


def _ece(items: list[tuple[EvalRecord, DecisionResult]], buckets: int = 10) -> float | None:
    bucket_values: list[list[tuple[float, bool]]] = [[] for _ in range(buckets)]
    for evaluation in _question_evaluations(items):
        confidence = evaluation.confidence
        index = min(buckets - 1, int(confidence * buckets))
        bucket_values[index].append((confidence, evaluation.correct))
    total = sum(len(bucket) for bucket in bucket_values)
    if total == 0:
        return None
    ece = 0.0
    for bucket in bucket_values:
        if not bucket:
            continue
        avg_confidence = sum(item[0] for item in bucket) / len(bucket)
        accuracy = sum(1 for _, correct in bucket if correct) / len(bucket)
        ece += (len(bucket) / total) * abs(avg_confidence - accuracy)
    return round(ece, 6)


def _confidence_distribution(values: list[float]) -> dict[str, int]:
    return {
        "0.00-0.50": sum(1 for value in values if value < 0.5),
        "0.50-0.70": sum(1 for value in values if 0.5 <= value < 0.7),
        "0.70-0.85": sum(1 for value in values if 0.7 <= value < 0.85),
        "0.85-1.00": sum(1 for value in values if value >= 0.85),
    }


def _coverage(values: list[float]) -> dict[str, float]:
    return {str(threshold): _ratio(sum(1 for value in values if value >= threshold), len(values)) for threshold in DEFAULT_THRESHOLDS}


def _question_metrics(evaluations: list[QuestionEvaluation]) -> dict[str, Any]:
    grouped: dict[str, list[QuestionEvaluation]] = defaultdict(list)
    for item in evaluations:
        grouped[item.question_id].append(item)
    return {
        question_id: {
            "sampleSize": len(items),
            "questionType": items[0].question_type,
            "accuracy": _ratio(sum(item.correct for item in items), len(items)),
            "brierScore": _question_brier(items),
            "expectedCalibrationError": _question_ece(items),
            "precision": _precision(items),
            "recall": _recall(items),
            "falseNegativeRate": _false_negative_rate(items),
            "safetyRelevant": any(item.safety_relevant for item in items),
        }
        for question_id, items in sorted(grouped.items())
    }


def _question_brier(items: list[QuestionEvaluation]) -> float | None:
    values = [
        (item.probability - (1.0 if item.correct else 0.0)) ** 2
        for item in items
        if item.probability is not None
    ]
    return round(sum(values) / len(values), 6) if values else None


def _question_ece(items: list[QuestionEvaluation], buckets: int = 10) -> float | None:
    bucket_values: list[list[tuple[float, bool]]] = [[] for _ in range(buckets)]
    for item in items:
        index = min(buckets - 1, int(item.confidence * buckets))
        bucket_values[index].append((item.confidence, item.correct))
    total = sum(len(bucket) for bucket in bucket_values)
    if total == 0:
        return None
    ece = 0.0
    for bucket in bucket_values:
        if not bucket:
            continue
        avg_confidence = sum(item[0] for item in bucket) / len(bucket)
        accuracy = sum(1 for _, correct in bucket if correct) / len(bucket)
        ece += (len(bucket) / total) * abs(avg_confidence - accuracy)
    return round(ece, 6)


def _precision(items: list[QuestionEvaluation]) -> float | None:
    predicted_positives = [item for item in items if item.predicted_positive]
    if not predicted_positives:
        return None
    true_positives = sum(1 for item in predicted_positives if item.actual_positive)
    return _ratio(true_positives, len(predicted_positives))


def _recall(items: list[QuestionEvaluation]) -> float | None:
    actual_positives = [item for item in items if item.actual_positive]
    if not actual_positives:
        return None
    true_positives = sum(1 for item in actual_positives if item.predicted_positive)
    return _ratio(true_positives, len(actual_positives))


def _false_negative_rate(items: list[QuestionEvaluation]) -> float | None:
    positives = [item for item in items if item.actual_positive]
    if not positives:
        return None
    misses = sum(1 for item in positives if not item.predicted_positive)
    return _ratio(misses, len(positives))


def _ranking_metrics(items: list[tuple[EvalRecord, DecisionResult]]) -> dict[str, Any]:
    reciprocal_ranks: list[float] = []
    ndcgs: list[float] = []
    for record, result in items:
        if not record.expected_ranking:
            continue
        ranked_prediction = _ranked_prediction(result)
        if not ranked_prediction:
            continue
        reciprocal_ranks.append(
            _reciprocal_rank(ranked_prediction, record.expected_ranking)
        )
        ndcgs.append(_ndcg_at_k(ranked_prediction, record.expected_ranking))
    return {
        "sampleSize": len(reciprocal_ranks),
        "meanReciprocalRank": round(sum(reciprocal_ranks) / len(reciprocal_ranks), 6)
        if reciprocal_ranks
        else None,
        "ndcg": round(sum(ndcgs) / len(ndcgs), 6) if ndcgs else None,
    }


def _ranked_prediction(result: DecisionResult) -> tuple[str, ...]:
    for question in result.question_results:
        if question.probabilities:
            return tuple(
                key
                for key, _ in sorted(
                    question.probabilities.items(),
                    key=lambda item: item[1],
                    reverse=True,
                )
            )
    return ()


def _reciprocal_rank(predicted: tuple[str, ...], expected: tuple[str, ...]) -> float:
    expected_first = expected[0]
    try:
        return 1.0 / (predicted.index(expected_first) + 1)
    except ValueError:
        return 0.0


def _ndcg_at_k(predicted: tuple[str, ...], expected: tuple[str, ...]) -> float:
    relevance = {item: len(expected) - index for index, item in enumerate(expected)}
    dcg = 0.0
    for index, item in enumerate(predicted[: len(expected)]):
        dcg += relevance.get(item, 0) / _log2(index + 2)
    ideal = sum(
        (len(expected) - index) / _log2(index + 2)
        for index in range(len(expected))
    )
    return dcg / ideal if ideal else 0.0


def _log2(value: int) -> float:
    return (
        value.bit_length() - 1
        if value > 0 and value & (value - 1) == 0
        else math.log2(value)
    )


def _failure_rate(failures: list[str | None], reason: str, total: int) -> float:
    return _ratio(sum(1 for failure in failures if failure == reason), total)


def _drift_detected(model_version: str) -> bool:
    approved = {
        model
        for policy in DEFAULT_DECISION_POLICIES.values()
        for model in policy.approved_model_versions
    }
    return bool(approved and model_version not in approved and model_version != "NO_PROVIDER_RESULT")


def _token_reduction(records: list[EvalRecord], kind: str) -> int:
    field = "baseline_input_tokens" if kind == "input" else "baseline_output_tokens"
    return sum(int(getattr(record, field) or 0) for record in records)


def _stage_latency_change(records: list[EvalRecord]) -> int | None:
    values = [
        record.latency_ms - record.baseline_latency_ms
        for record in records
        if record.baseline_latency_ms is not None
    ]
    return int(sum(values)) if values else None


def _percentile(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, round((len(ordered) - 1) * percentile))
    return int(ordered[index])


def _ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 6) if denominator else None


def _counts(values: Any) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values:
        result[str(value)] = result.get(str(value), 0) + 1
    return result


if __name__ == "__main__":
    raise SystemExit(main())
