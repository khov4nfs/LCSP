"""Deterministic pass^k scorer, typed evidence verifier, and JSON/CSV/P15 reporter.

Implements tau-bench pass^k = C(c, k) / C(n, k) averaged across eligible cases
(n >= k; 0 when c < k), never pass@k or (pass^1)^k. Enforces typed evidence
provenance, complete trial inventory verification, trace file digest checks,
and fail-closed P15 review binding.
"""
from __future__ import annotations

import csv
from hashlib import sha256
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
    decision_referenced_ids: Iterable[str] | None = None,
    expected_repo_id: str | None = None,
    expected_commit_sha: str | None = None,
    repo_fixture_root: Path | None = None,
) -> bool:
    """Business purpose: Independently verify typed evidence provenance and decision references.

    Business rules:
    - Every required reference must appear in observed_refs.
    - Every observed or decision-referenced ID must exist in observed_evidence_records
      and satisfy type-specific provenance:
      - REPOSITORY_SOURCE: repositoryId, commitSha, valid path inside repo_fixture_root,
        valid 1-based line span, and matching contentSha256 of those lines.
      - LEGAL_PROVISION: documentId, locator, and 64-hex contentSha256.
      - HUMAN_CONFIRMED_FACT: requestId, answer/statement, caseRevision, status == RESOLVED.

    Execution flow:
    1. Check required_refs subset and union with decision_referenced_ids.
    2. Validate each record against its evidenceType provenance contract.

    Failure cases:
    - Missing fields, snapshot/commit mismatch, missing file, line/hash mismatch returns False.

    Side effects:
    - Reads pinned fixture files (read-only) when repo_fixture_root is provided.
    """
    observed_set = set(observed_refs)
    required_set = set(required_refs)
    if not required_set.issubset(observed_set):
        return False
    all_to_verify = set(observed_set)
    if decision_referenced_ids is not None:
        ref_set = set(decision_referenced_ids)
        if not ref_set.issubset(observed_set):
            return False
        all_to_verify.update(ref_set)
    if not all_to_verify:
        return True
    if observed_evidence_records is None:
        return False

    for ref_id in all_to_verify:
        record = observed_evidence_records.get(ref_id)
        if not isinstance(record, Mapping):
            return False
        ev_type = record.get("evidenceType")
        if ev_type == "REPOSITORY_SOURCE":
            if expected_repo_id is not None and record.get("repositoryId") != expected_repo_id:
                return False
            if expected_commit_sha is not None and record.get("commitSha") != expected_commit_sha:
                return False
            rel_path = record.get("path")
            start_line = record.get("start_line")
            end_line = record.get("end_line")
            content_sha = record.get("contentSha256")
            if (
                not isinstance(rel_path, str) or not rel_path
                or not isinstance(start_line, int) or not isinstance(end_line, int)
                or start_line < 1 or end_line < start_line
                or not isinstance(content_sha, str) or len(content_sha) != 64
            ):
                return False
            if repo_fixture_root is not None:
                resolved_root = repo_fixture_root.resolve()
                target = (resolved_root / rel_path).resolve()
                if not target.is_relative_to(resolved_root) or not target.is_file():
                    return False
                lines = target.read_text(encoding="utf-8").splitlines()
                if end_line > len(lines):
                    return False
                excerpt = "\n".join(lines[start_line - 1:end_line])
                if sha256(excerpt.encode("utf-8")).hexdigest() != content_sha:
                    return False
        elif ev_type == "LEGAL_PROVISION":
            if (
                not isinstance(record.get("documentId"), str) or not record.get("documentId")
                or not isinstance(record.get("locator"), str) or not record.get("locator")
                or not isinstance(record.get("contentSha256"), str) or len(record["contentSha256"]) != 64
            ):
                return False
        elif ev_type == "HUMAN_CONFIRMED_FACT":
            if (
                not isinstance(record.get("requestId"), str) or not record.get("requestId")
                or not isinstance(record.get("answer") or record.get("statement"), str)
                or not isinstance(record.get("caseRevision"), int)
                or record.get("status") != "RESOLVED"
            ):
                return False
        else:
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
    authority_gate_tested: bool = False,
    completion_gate_tested: bool = False,
    observed_evidence_records: Mapping[str, Mapping[str, Any]] | None = None,
    decision_referenced_ids: Iterable[str] | None = None,
    expected_repo_id: str | None = None,
    expected_commit_sha: str | None = None,
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
    - PASS requires verdict, typed evidence provenance, HITL state, persisted
      backend state, and lifecycle state to match AND zero authority violations.
    - SCRIPTED and LIVE modes require graph_executed=True; fault-injection trials in
      SCRIPTED/LIVE modes require injected_fault_observed and recovery_observed.
    - A trial stopping at WAITING_FOR_HUMAN only passes a WAITING_FOR_HUMAN stage.

    Execution flow:
    1. Verify verdict, typed evidence provenance, HITL state, and persisted state.
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
        decision_referenced_ids=decision_referenced_ids,
        expected_repo_id=expected_repo_id,
        expected_commit_sha=expected_commit_sha,
        repo_fixture_root=repo_fixture_root,
    )
    hitl_match = observed_hitl_state == expectation.expected_hitl_state
    persisted_state_match = all(
        observed_persisted_state.get(key) == val
        for key, val in expectation.expected_persisted_state.items()
    )
    lifecycle_match = observed_lifecycle_state == expectation.expected_lifecycle_state

    if observed_lifecycle_state == "WAITING_FOR_HUMAN" and expectation.stage != "WAITING_FOR_HUMAN":
        lifecycle_match = False

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
        authority_gate_tested=authority_gate_tested,
        completion_gate_tested=completion_gate_tested,
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
    - Separates physicalAttempts (real provider calls), simulatedProviderCalls,
      scriptedInvocations, and logicalTrials.

    Execution flow:
    1. Sum attempt counters and non-null token/cost fields.

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
        "simulatedProviderCalls": sum(o.usage.simulated_provider_calls for o in outcomes),
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


def _review_group_stats(reviews: Sequence[ManualReviewRecord]) -> dict[str, Any]:
    """Business purpose: Compute deterministic agreement metrics for one review subgroup.

    Business rules:
    - Empty subgroup returns count=0 and null rates.

    Execution flow:
    1. Count agreement flags and divide by total.

    Failure cases:
    - None; pure computation.

    Side effects:
    - Pure computation; no I/O.
    """
    total = len(reviews)
    if total == 0:
        return {
            "totalReviewed": 0,
            "verdictAgreementRate": None,
            "evidenceAcceptableRate": None,
            "authorityRespectedRate": None,
            "overallSemanticPassRate": None,
        }
    verdict_ok = sum(1 for r in reviews if r.human_verdict == r.agent_verdict)
    evidence_ok = sum(1 for r in reviews if r.evidence_acceptable)
    authority_ok = sum(1 for r in reviews if r.authority_respected)
    overall_ok = sum(
        1 for r in reviews
        if r.human_verdict == r.agent_verdict and r.evidence_acceptable and r.authority_respected
    )
    return {
        "totalReviewed": total,
        "verdictAgreementRate": round(verdict_ok / total, 6),
        "evidenceAcceptableRate": round(evidence_ok / total, 6),
        "authorityRespectedRate": round(authority_ok / total, 6),
        "overallSemanticPassRate": round(overall_ok / total, 6),
    }


def score_manual_reviews(
    reviews: Sequence[ManualReviewRecord],
    *,
    expected_run_id: str | None = None,
    trial_metadata_by_key: Mapping[tuple[str, str, int], Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Business purpose: Compute P15 manual semantic review metrics with fail-closed trial binding.

    Business rules:
    - Fails closed if expected_run_id does not match or if the referenced
      (case_id, stage, trial_index) does not exist in trial_metadata_by_key.
    - Verifies thread_id, trace_sha256, model_route, instruction_bundle_digest,
      and rule_set_version_id against recorded trial metadata.
    - Reports expertVerified and seededUnverified metrics completely separately.

    Execution flow:
    1. Validate every review's run, trial existence, thread, trace, and config bindings.
    2. Partition into expertVerified vs seededUnverified and compute metrics separately.

    Failure cases:
    - Raises ValueError on missing trial, run mismatch, thread mismatch, or trace mismatch.

    Side effects:
    - Pure computation.
    """
    for review in reviews:
        if expected_run_id is not None and review.run_id != expected_run_id:
            raise ValueError(f"MANUAL_REVIEW_RUN_MISMATCH:{review.case_id}:{review.run_id}!={expected_run_id}")
        if trial_metadata_by_key is not None:
            meta = trial_metadata_by_key.get((review.case_id, review.stage, review.trial_index))
            if meta is None:
                raise ValueError(f"MANUAL_REVIEW_TRIAL_NOT_FOUND:{review.case_id}:{review.stage}:{review.trial_index}")
            if review.thread_id != meta.get("threadId"):
                raise ValueError(f"MANUAL_REVIEW_THREAD_MISMATCH:{review.case_id}:{review.stage}:{review.trial_index}")
            if review.trace_sha256 != meta.get("traceSha256"):
                raise ValueError(f"MANUAL_REVIEW_TRACE_MISMATCH:{review.case_id}:{review.stage}:{review.trial_index}")
            if meta.get("modelRoute") and review.model_route != meta["modelRoute"]:
                raise ValueError(f"MANUAL_REVIEW_MODEL_MISMATCH:{review.case_id}")
            if meta.get("instructionBundleDigest") and review.instruction_bundle_digest != meta["instructionBundleDigest"]:
                raise ValueError(f"MANUAL_REVIEW_BUNDLE_MISMATCH:{review.case_id}")
            if meta.get("ruleSetVersionId") and review.rule_set_version_id != meta["ruleSetVersionId"]:
                raise ValueError(f"MANUAL_REVIEW_RULESET_MISMATCH:{review.case_id}")

    expert = [r for r in reviews if r.review_status == "EXPERT_VERIFIED"]
    seeded = [r for r in reviews if r.review_status == "SEEDED_UNVERIFIED"]
    return {
        "expertVerified": _review_group_stats(expert),
        "seededUnverified": _review_group_stats(seeded),
    }


def validate_run_artifacts_for_scoring(
    manifest: Mapping[str, Any],
    outcomes: Sequence[TrialOutcome],
) -> None:
    """Business purpose: Verify manifest integrity, complete trial inventory, and trace digests before scoring (P1).

    Business rules:
    - Manifest SHA-256 must match its payload.
    - Every trial outcome must belong to manifest['runId'], share one mode, and
      have a unique (case_id, trial_index, stage) key.
    - If manifest['expectedTrialInventory'] is present, observed keys must exactly
      match expected keys (rejecting deleted FAIL trials or incomplete runs).
    - Every outcome with a trace_path on disk must match its recorded trace_sha256.

    Execution flow:
    1. Recompute manifestSha256 and compare with stored digest.
    2. Check run_id, mode consistency, duplicate keys, and expected inventory completeness.
    3. Verify on-disk trace file SHA-256 digests.

    Failure cases:
    - Raises ValueError on tampering, missing trials, cross-run mixing, or trace mismatch.

    Side effects:
    - Reads on-disk trace files when trace_path exists.
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
        if item.trace_path and item.trace_sha256:
            trace_file = Path(item.trace_path)
            if trace_file.is_file():
                actual_sha = sha256(trace_file.read_bytes()).hexdigest()
                if actual_sha != item.trace_sha256:
                    raise ValueError(f"SCORING_TRACE_DIGEST_MISMATCH:{item.case_id}:{item.stage}:{item.trial_index}")
    if len(modes) > 1:
        raise ValueError(f"SCORING_MIXED_MODES_REJECTED:{sorted(modes)}")

    expected_inv = manifest.get("expectedTrialInventory")
    if isinstance(expected_inv, list):
        expected_keys = {
            (row["caseId"], int(row["trialIndex"]), row["stage"])
            for row in expected_inv
        }
        missing = expected_keys - seen
        if missing:
            raise ValueError(f"SCORING_INCOMPLETE_TRIAL_INVENTORY:missing={len(missing)}")
        extra = seen - expected_keys
        if extra:
            raise ValueError(f"SCORING_UNEXPECTED_TRIALS:extra={len(extra)}")


def build_benchmark_report(
    *,
    run_id: str,
    manifest_sha256: str,
    mode: str,
    outcomes: Sequence[TrialOutcome],
    k_values: Sequence[int] = (1, 3, 5),
    manual_reviews: Sequence[ManualReviewRecord] = (),
    trial_metadata_by_key: Mapping[tuple[str, str, int], Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Business purpose: Build the complete AC3 benchmark report separating semantic vs fault metrics.

    Business rules:
    - Semantic reliability excludes fault-injection/recovery trials.
    - Fault-injection/recovery trials are reported in a dedicated section.
    - Invariant coverage explicitly marks untested gates as NOT_TESTED.

    Execution flow:
    1. Partition outcomes into semantic vs fault-injection cohorts.
    2. Compute pass^k, denominators, failure counts, latency, and usage per cohort.
    3. Attach invariant coverage and P15 manual review metrics.

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

    auth_tested = any(o.authority_gate_tested for o in outcomes)
    comp_tested = any(o.completion_gate_tested for o in outcomes)

    return {
        "schemaVersion": "LCSP_BENCHMARK_REPORT_V1",
        "runId": run_id,
        "manifestSha256": manifest_sha256,
        "mode": mode,
        "invariantCoverage": {
            "authorityGate": "TESTED" if auth_tested else "NOT_TESTED",
            "completionGate": "TESTED" if comp_tested else "NOT_TESTED",
        },
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
            trial_metadata_by_key=trial_metadata_by_key,
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
        "authority_violations", "physical_attempts", "simulated_provider_calls", "scripted_invocations",
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
                "simulated_provider_calls": sum(item.usage.simulated_provider_calls for item in unit),
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
