"""Deterministic pass^k scorer, independent evidence verifier, and JSON/CSV/P15 reporter.

Implements tau-bench pass^k = C(c, k) / C(n, k) averaged across eligible cases
(n >= k; 0 when c < k), never pass@k or (pass^1)^k. Independently verifies
evidence against runtime-recorded artifacts and repository fixture files, and
validates run integrity before re-scoring.
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from evals.benchmark_schema import (
    ManualReviewRecord,
    StageExpectation,
    TrialOutcome,
    TrialUsage,
)
from evals.run_manifest import stable_hash


def compute_case_pass_pow_k(n: int, c: int, k: int) -> float | None:
    """Business purpose: Compute tau-bench pass^k reliability for a single case.

    Business rules:
    - Uses exact combinatorics C(c, k) / C(n, k) rather than pass@k or (pass^1)^k.
    - Returns None when n < k so callers exclude ineligible cases from the denominator.
    - Returns 0.0 when n >= k and c < k.

    Execution flow:
    1. Validate non-negative counts and positive k.
    2. Return None if n < k, 0.0 if c < k, else math.comb(c, k) / math.comb(n, k).

    Failure cases:
    - Raises ValueError on negative counts, c > n, or k < 1.

    Side effects:
    - Pure mathematical computation.
    """
    if k < 1 or n < 0 or c < 0 or c > n:
        raise ValueError(f"INVALID_PASS_POW_K_INPUTS: n={n}, c={c}, k={k}")
    if n < k:
        return None
    if c < k:
        return 0.0
    return math.comb(c, k) / math.comb(n, k)


def compute_pass_pow_k_summary(
    outcomes: Sequence[TrialOutcome],
    k_values: Sequence[int] = (1, 3, 5),
) -> dict[str, dict[str, Any]]:
    """Business purpose: Aggregate per-case pass^k across a cohort of trials.

    Business rules:
    - Groups trials by (case_id, stage) so WAITING_FOR_HUMAN and RESUME_FINAL
      stages are never conflated into a single pass count (AC2).
    - Excludes cases with fewer than k trials from that k's denominator and
      records the exact denominator alongside the score.

    Execution flow:
    1. Group TrialOutcome items by (case_id, stage).
    2. For each k in k_values, compute per-case pass^k for eligible units (n >= k).
    3. Return mean pass^k and exact eligible denominator per k.

    Failure cases:
    - Invalid k_values propagate ValueError from compute_case_pass_pow_k.

    Side effects:
    - Pure aggregation; no I/O.
    """
    grouped: dict[tuple[str, str], list[TrialOutcome]] = {}
    for outcome in outcomes:
        grouped.setdefault((outcome.case_id, outcome.stage), []).append(outcome)

    summary: dict[str, dict[str, Any]] = {}
    for k in sorted(set(k_values)):
        scores: list[float] = []
        for unit_outcomes in grouped.values():
            n = len(unit_outcomes)
            c = sum(1 for item in unit_outcomes if item.passed)
            score = compute_case_pass_pow_k(n, c, k)
            if score is not None:
                scores.append(score)
        key = f"pass^{k}"
        summary[key] = {
            "k": k,
            "score": round(sum(scores) / len(scores), 6) if scores else None,
            "eligibleUnits": len(scores),
            "totalUnits": len(grouped),
        }
    return summary


def verify_evidence_integrity(
    *,
    required_refs: Iterable[str],
    observed_refs: Iterable[str],
    observed_evidence_records: Mapping[str, Mapping[str, Any]] | None,
    expected_repo_id: str | None = None,
    repo_fixture_root: Path | None = None,
) -> bool:
    """Business purpose: Independently verify cited evidence existence, snapshot binding, and source spans.

    Business rules:
    - Every required reference must appear in observed_refs.
    - Every observed reference must exist in independent runtime-recorded evidence
      records (never trusting a self-reported boolean flag).
    - If repositoryId or source path/span is present, it must match the pinned
      repository snapshot and valid line bounds inside repo_fixture_root.

    Execution flow:
    1. Verify required_refs is a subset of observed_refs.
    2. Verify observed_evidence_records is provided and contains every observed_ref.
    3. Validate repositoryId match and source file line span bounds when applicable.

    Failure cases:
    - Missing record, snapshot mismatch, missing file, or out-of-range span returns False.

    Side effects:
    - Reads pinned fixture files (read-only) when repo_fixture_root is provided.
    """
    observed_set = set(observed_refs)
    required_set = set(required_refs)
    if not required_set.issubset(observed_set):
        return False
    if not observed_set:
        return True
    if observed_evidence_records is None:
        return False

    for ref_id in observed_set:
        record = observed_evidence_records.get(ref_id)
        if not isinstance(record, Mapping):
            return False
        if expected_repo_id is not None and record.get("repositoryId") != expected_repo_id:
            return False
        rel_path = record.get("path")
        if rel_path is not None and repo_fixture_root is not None:
            if not isinstance(rel_path, str) or not rel_path:
                return False
            resolved_root = repo_fixture_root.resolve()
            target = (resolved_root / rel_path).resolve()
            if not target.is_relative_to(resolved_root) or not target.is_file():
                return False
            start_line = record.get("start_line")
            end_line = record.get("end_line")
            if start_line is not None or end_line is not None:
                if (
                    not isinstance(start_line, int)
                    or not isinstance(end_line, int)
                    or start_line < 1
                    or end_line < start_line
                ):
                    return False
                line_count = len(target.read_text(encoding="utf-8").splitlines())
                if end_line > line_count:
                    return False
    return True


def grade_trial(
    *,
    run_id: str,
    case_id: str,
    trial_index: int,
    thread_id: str,
    mode: str,
    split: str,
    expectation: StageExpectation,
    is_negative_control: bool,
    is_fault_injection: bool,
    observed_lifecycle_state: str,
    observed_verdict: str,
    observed_evidence_refs: Iterable[str],
    observed_hitl_state: str,
    observed_persisted_state: dict[str, Any],
    authority_violation: bool,
    observed_evidence_records: Mapping[str, Mapping[str, Any]] | None = None,
    expected_repo_id: str | None = None,
    repo_fixture_root: Path | None = None,
    graph_executed: bool = False,
    checkpoint_id: str | None = None,
    injected_fault_observed: bool = False,
    recovery_observed: bool = False,
    error_code: str | None = None,
    error_message: str | None = None,
    latency_ms: float = 0.0,
    usage: TrialUsage | None = None,
    trace_path: str | None = None,
    trace_sha256: str | None = None,
) -> TrialOutcome:
    """Business purpose: Grade one independent trial against stage-level gold criteria (AC2).

    Business rules:
    - PASS requires verdict, independent evidence integrity, HITL state, persisted
      backend state, and lifecycle state to match AND zero authority violations.
    - SCRIPTED and LIVE modes require graph_executed=True; fault-injection trials in
      SCRIPTED/LIVE modes require injected_fault_observed and recovery_observed.
    - A trial stopping at WAITING_FOR_HUMAN only passes a WAITING_FOR_HUMAN stage.

    Execution flow:
    1. Verify verdict, independent evidence integrity, HITL state, and persisted state.
    2. Enforce lifecycle alignment, graph execution, and fault-recovery requirements.
    3. Require zero authority violations and no unhandled error_code for PASS.

    Failure cases:
    - Any mismatch, unverified evidence, missing graph execution, or authority violation yields passed=False.

    Side effects:
    - Pure grading (reads pinned fixture files only if repo_fixture_root is passed).
    """
    verdict_match = observed_verdict == expectation.expected_verdict
    evidence_match = verify_evidence_integrity(
        required_refs=expectation.required_evidence_refs,
        observed_refs=observed_evidence_refs,
        observed_evidence_records=observed_evidence_records,
        expected_repo_id=expected_repo_id,
        repo_fixture_root=repo_fixture_root,
    )
    hitl_match = observed_hitl_state == expectation.expected_hitl_state
    persisted_state_match = all(
        observed_persisted_state.get(key) == val
        for key, val in expectation.expected_persisted_state.items()
    )
    lifecycle_match = observed_lifecycle_state == expectation.expected_lifecycle_state

    # Explicit AC2 guard: WAITING_FOR_HUMAN only passes the WAITING_FOR_HUMAN stage.
    if observed_lifecycle_state == "WAITING_FOR_HUMAN" and expectation.stage != "WAITING_FOR_HUMAN":
        lifecycle_match = False

    # In SCRIPTED/LIVE modes, graph execution is mandatory; fault-injection requires real fault + recovery.
    execution_ok = True
    if mode in {"SCRIPTED", "LIVE"}:
        if not graph_executed:
            execution_ok = False
        if is_fault_injection and not (injected_fault_observed and recovery_observed):
            execution_ok = False

    passed = (
        verdict_match
        and evidence_match
        and hitl_match
        and persisted_state_match
        and lifecycle_match
        and execution_ok
        and not authority_violation
        and error_code is None
    )

    return TrialOutcome(
        run_id=run_id,
        case_id=case_id,
        trial_index=trial_index,
        thread_id=thread_id,
        mode=mode,  # type: ignore[arg-type]
        split=split,  # type: ignore[arg-type]
        stage=expectation.stage,
        is_negative_control=is_negative_control,
        is_fault_injection=is_fault_injection,
        passed=passed,
        verdict_match=verdict_match,
        evidence_match=evidence_match,
        hitl_match=hitl_match,
        persisted_state_match=persisted_state_match,
        authority_violation=authority_violation,
        graph_executed=graph_executed,
        checkpoint_id=checkpoint_id,
        injected_fault_observed=injected_fault_observed,
        recovery_observed=recovery_observed,
        lifecycle_state=observed_lifecycle_state,
        actual_verdict=observed_verdict,
        error_code=error_code,
        error_message=error_message,
        latency_ms=latency_ms,
        usage=usage or TrialUsage(),
        trace_path=trace_path,
        trace_sha256=trace_sha256,
        persisted_state_snapshot=dict(observed_persisted_state),
    )


def _latency_stats(latencies: Sequence[float]) -> dict[str, float | None]:
    """Business purpose: Compute bounded latency summary statistics for a trial cohort.

    Business rules:
    - Empty cohorts return explicit None values rather than fabricating zero latency.

    Execution flow:
    1. Sort observed latencies and extract min, mean, p50, p95, and max.

    Failure cases:
    - None; empty input yields null fields.

    Side effects:
    - Pure computation; no I/O.
    """
    if not latencies:
        return {"minMs": None, "meanMs": None, "p50Ms": None, "p95Ms": None, "maxMs": None}
    ordered = sorted(latencies)
    n = len(ordered)
    p50_idx = min(n - 1, int(0.50 * (n - 1)))
    p95_idx = min(n - 1, int(0.95 * (n - 1)))
    return {
        "minMs": round(ordered[0], 3),
        "meanMs": round(sum(ordered) / n, 3),
        "p50Ms": round(ordered[p50_idx], 3),
        "p95Ms": round(ordered[p95_idx], 3),
        "maxMs": round(ordered[-1], 3),
    }


def _usage_totals(outcomes: Sequence[TrialOutcome]) -> dict[str, Any]:
    """Business purpose: Aggregate token, cost, and attempt usage without fabricating unbilled cost.

    Business rules:
    - Missing token counts or providerCost remain None rather than defaulting to zero.
    - Separates physicalAttempts (provider calls) from scriptedInvocations and logicalTrials.

    Execution flow:
    1. Sum physicalAttempts, failedAttempts, scriptedInvocations, and non-null token/cost fields.

    Failure cases:
    - None; empty input yields zero attempts and null token/cost fields.

    Side effects:
    - Pure computation; no I/O.
    """
    input_tokens = [o.usage.input_tokens for o in outcomes if o.usage.input_tokens is not None]
    cached_tokens = [o.usage.cached_input_tokens for o in outcomes if o.usage.cached_input_tokens is not None]
    output_tokens = [o.usage.output_tokens for o in outcomes if o.usage.output_tokens is not None]
    costs = [o.usage.provider_cost for o in outcomes if o.usage.provider_cost is not None]
    currencies = sorted({o.usage.cost_currency for o in outcomes if o.usage.cost_currency})
    return {
        "logicalTrials": len(outcomes),
        "scriptedInvocations": sum(o.usage.scripted_invocations for o in outcomes),
        "physicalAttempts": sum(o.usage.physical_attempts for o in outcomes),
        "failedAttempts": sum(o.usage.failed_attempts for o in outcomes),
        "inputTokens": sum(input_tokens) if input_tokens else None,
        "cachedInputTokens": sum(cached_tokens) if cached_tokens else None,
        "outputTokens": sum(output_tokens) if output_tokens else None,
        "providerCost": round(sum(costs), 6) if costs else None,
        "costCurrencies": currencies,
    }


def _cohort_metrics(outcomes: Sequence[TrialOutcome], k_values: Sequence[int]) -> dict[str, Any]:
    """Business purpose: Compute pass^k, failure breakdown, latency, and usage for one cohort.

    Business rules:
    - Separates authority violations from rubric mismatches in failure counts.

    Execution flow:
    1. Tally failures by error code or authority violation.
    2. Compute pass^k, latency stats, and usage totals.

    Failure cases:
    - Invalid k_values propagate ValueError.

    Side effects:
    - Pure computation; no I/O.
    """
    failures_by_code: dict[str, int] = {}
    for item in outcomes:
        if not item.passed:
            code = item.error_code or ("AUTHORITY_VIOLATION" if item.authority_violation else "RUBRIC_MISMATCH")
            failures_by_code[code] = failures_by_code.get(code, 0) + 1
    return {
        "totalTrials": len(outcomes),
        "passedTrials": sum(1 for item in outcomes if item.passed),
        "failedTrials": sum(1 for item in outcomes if not item.passed),
        "authorityViolations": sum(1 for item in outcomes if item.authority_violation),
        "passPowK": compute_pass_pow_k_summary(outcomes, k_values),
        "failuresByCode": dict(sorted(failures_by_code.items())),
        "latency": _latency_stats([item.latency_ms for item in outcomes]),
        "usage": _usage_totals(outcomes),
    }


def score_manual_reviews(
    reviews: Sequence[ManualReviewRecord],
    *,
    expected_run_id: str | None = None,
    trace_hashes_by_trial: Mapping[tuple[str, int], str] | None = None,
) -> dict[str, Any]:
    """Business purpose: Compute deterministic P15 manual semantic review metrics bound to a specific run.

    Business rules:
    - Rejects cross-run reviews when expected_run_id is provided.
    - Rejects reviews whose trace_sha256 does not match the recorded trial trace.
    - Separates EXPERT_VERIFIED counts from SEEDED_UNVERIFIED counts.

    Execution flow:
    1. Validate run_id and trace_sha256 bindings for each review.
    2. Compute exact agreement, evidence acceptability, authority respect, and pass rate.

    Failure cases:
    - Raises ValueError on run_id or trace_sha256 mismatch.

    Side effects:
    - Pure computation.
    """
    total = len(reviews)
    if total == 0:
        return {
            "totalReviewed": 0,
            "expertVerifiedCount": 0,
            "seededUnverifiedCount": 0,
            "verdictAgreementRate": None,
            "evidenceAcceptableRate": None,
            "authorityRespectedRate": None,
            "overallSemanticPassRate": None,
        }
    for review in reviews:
        if expected_run_id is not None and review.run_id != expected_run_id:
            raise ValueError(f"MANUAL_REVIEW_RUN_MISMATCH:{review.case_id}:{review.run_id}!={expected_run_id}")
        if trace_hashes_by_trial is not None:
            recorded = trace_hashes_by_trial.get((review.case_id, review.trial_index))
            if recorded is not None and review.trace_sha256 != recorded:
                raise ValueError(f"MANUAL_REVIEW_TRACE_MISMATCH:{review.case_id}:{review.trial_index}")

    verdict_ok = sum(1 for r in reviews if r.human_verdict == r.agent_verdict)
    evidence_ok = sum(1 for r in reviews if r.evidence_acceptable)
    authority_ok = sum(1 for r in reviews if r.authority_respected)
    overall_ok = sum(
        1 for r in reviews
        if r.human_verdict == r.agent_verdict and r.evidence_acceptable and r.authority_respected
    )
    return {
        "totalReviewed": total,
        "expertVerifiedCount": sum(1 for r in reviews if r.review_status == "EXPERT_VERIFIED"),
        "seededUnverifiedCount": sum(1 for r in reviews if r.review_status == "SEEDED_UNVERIFIED"),
        "verdictAgreementRate": round(verdict_ok / total, 6),
        "evidenceAcceptableRate": round(evidence_ok / total, 6),
        "authorityRespectedRate": round(authority_ok / total, 6),
        "overallSemanticPassRate": round(overall_ok / total, 6),
    }


def validate_run_artifacts_for_scoring(
    manifest: Mapping[str, Any],
    outcomes: Sequence[TrialOutcome],
) -> None:
    """Business purpose: Verify manifest integrity and trial identity before re-scoring (P1).

    Business rules:
    - Manifest SHA-256 must match its payload.
    - Every trial outcome must belong to manifest['runId'], share one mode, and
      have a unique (case_id, trial_index, stage) key.

    Execution flow:
    1. Recompute manifestSha256 and compare with stored digest.
    2. Check run_id, mode consistency, and duplicate trial identities.

    Failure cases:
    - Raises ValueError on tampering, cross-run mixing, mixed modes, or duplicates.

    Side effects:
    - Pure validation; no I/O.
    """
    expected = manifest.get("manifestSha256")
    payload = {k: v for k, v in manifest.items() if k != "manifestSha256"}
    if not isinstance(expected, str) or expected != stable_hash(payload):
        raise ValueError("SCORING_MANIFEST_INTEGRITY_FAILED")
    run_id = manifest.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise ValueError("SCORING_MANIFEST_RUN_ID_MISSING")

    seen: set[tuple[str, int, str]] = set()
    modes: set[str] = set()
    for item in outcomes:
        if item.run_id != run_id:
            raise ValueError(f"SCORING_CROSS_RUN_TRIAL_REJECTED:{item.run_id}!={run_id}")
        modes.add(item.mode)
        key = (item.case_id, item.trial_index, item.stage)
        if key in seen:
            raise ValueError(f"SCORING_DUPLICATE_TRIAL_REJECTED:{key}")
        seen.add(key)
    if len(modes) > 1:
        raise ValueError(f"SCORING_MIXED_MODES_REJECTED:{sorted(modes)}")


def build_benchmark_report(
    *,
    run_id: str,
    manifest_sha256: str,
    mode: str,
    outcomes: Sequence[TrialOutcome],
    k_values: Sequence[int] = (1, 3, 5),
    manual_reviews: Sequence[ManualReviewRecord] = (),
) -> dict[str, Any]:
    """Business purpose: Build the complete AC3 benchmark report separating semantic vs fault metrics.

    Business rules:
    - Semantic reliability excludes fault-injection/recovery trials.
    - Fault-injection/recovery trials are reported in a dedicated section.
    - DEV, HOLDOUT, and negative controls are broken out explicitly.

    Execution flow:
    1. Partition outcomes into semantic vs fault-injection cohorts.
    2. Compute pass^k, denominators, failure counts, latency, and usage per cohort.
    3. Attach P15 manual semantic review metrics bound to run_id and trace hashes.

    Failure cases:
    - Invalid k_values or mismatched manual reviews propagate ValueError.

    Side effects:
    - Pure report assembly.
    """
    semantic = [o for o in outcomes if not o.is_fault_injection]
    fault_injection = [o for o in outcomes if o.is_fault_injection]
    dev_semantic = [o for o in semantic if o.split == "DEV"]
    holdout_semantic = [o for o in semantic if o.split == "HOLDOUT"]
    negative_controls = [o for o in semantic if o.is_negative_control]
    trace_hashes = {
        (o.case_id, o.trial_index): o.trace_sha256
        for o in outcomes
        if o.trace_sha256 is not None
    }

    return {
        "schemaVersion": "LCSP_BENCHMARK_REPORT_V1",
        "runId": run_id,
        "manifestSha256": manifest_sha256,
        "mode": mode,
        "semanticReliability": {
            "overall": _cohort_metrics(semantic, k_values),
            "dev": _cohort_metrics(dev_semantic, k_values),
            "holdout": _cohort_metrics(holdout_semantic, k_values),
            "negativeControls": _cohort_metrics(negative_controls, k_values),
        },
        "faultInjectionRecovery": _cohort_metrics(fault_injection, k_values),
        "manualSemanticReviewP15": score_manual_reviews(
            manual_reviews,
            expected_run_id=run_id,
            trace_hashes_by_trial=trace_hashes if trace_hashes else None,
        ),
    }


def export_report_json(path: Path, report: dict[str, Any]) -> None:
    """Business purpose: Persist benchmark report as deterministic UTF-8 JSON.

    Business rules:
    - Creates parent directories and formats with sorted keys.

    Execution flow:
    1. Ensure parent directory exists and write JSON.

    Failure cases:
    - Filesystem write errors propagate.

    Side effects:
    - Writes one JSON report file to disk.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def export_report_csv(path: Path, outcomes: Sequence[TrialOutcome], k_values: Sequence[int] = (1, 3, 5)) -> None:
    """Business purpose: Export per-(case_id, stage) pass^k, latency, and cost summary as CSV (AC3).

    Business rules:
    - Preserves cohort separation (is_fault_injection, split, is_negative_control) per row.
    - Reports exact n, c, denominators, and pass^k columns.

    Execution flow:
    1. Group outcomes by (case_id, stage).
    2. Compute n, c, pass^k, mean latency, and cost per unit.
    3. Write header and sorted rows to CSV.

    Failure cases:
    - Filesystem write errors propagate.

    Side effects:
    - Writes one CSV file to disk.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    grouped: dict[tuple[str, str], list[TrialOutcome]] = {}
    for outcome in outcomes:
        grouped.setdefault((outcome.case_id, outcome.stage), []).append(outcome)

    k_list = sorted(set(k_values))
    fieldnames = [
        "case_id", "stage", "split", "is_negative_control", "is_fault_injection",
        "trials_n", "passed_c",
        *[f"pass_pow_{k}" for k in k_list],
        "authority_violations", "physical_attempts", "scripted_invocations",
        "mean_latency_ms", "input_tokens", "output_tokens", "provider_cost",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for (case_id, stage), unit in sorted(grouped.items()):
            first = unit[0]
            n = len(unit)
            c = sum(1 for item in unit if item.passed)
            in_tok = [item.usage.input_tokens for item in unit if item.usage.input_tokens is not None]
            out_tok = [item.usage.output_tokens for item in unit if item.usage.output_tokens is not None]
            costs = [item.usage.provider_cost for item in unit if item.usage.provider_cost is not None]
            row: dict[str, Any] = {
                "case_id": case_id,
                "stage": stage,
                "split": first.split,
                "is_negative_control": first.is_negative_control,
                "is_fault_injection": first.is_fault_injection,
                "trials_n": n,
                "passed_c": c,
                "authority_violations": sum(1 for item in unit if item.authority_violation),
                "physical_attempts": sum(item.usage.physical_attempts for item in unit),
                "scripted_invocations": sum(item.usage.scripted_invocations for item in unit),
                "mean_latency_ms": round(sum(item.latency_ms for item in unit) / n, 3),
                "input_tokens": sum(in_tok) if in_tok else "",
                "output_tokens": sum(out_tok) if out_tok else "",
                "provider_cost": round(sum(costs), 6) if costs else "",
            }
            for k in k_list:
                val = compute_case_pass_pow_k(n, c, k)
                row[f"pass_pow_{k}"] = f"{val:.6f}" if val is not None else ""
            writer.writerow(row)
