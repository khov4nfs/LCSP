"""Evaluate frozen Preparation model output without invoking an LLM or API.

Usage (from deepagents/):
python -m rule_set_preparation.eval_cli --gold GOLD.json --candidate OUTPUT.json
OUTPUT.json must contain "semanticGraph" and "scopeDecisions". Gold labels
must be independently reviewed before a report can support acceptance.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
from math import isfinite

from rule_set_preparation.eval_semantics import evaluate_preparation_semantics
from rule_set_preparation.reviewed_eval_gate import reviewed_eval_preflight, reviewed_case_package_preflight, paired_eval_preflight, reviewed_cases_in_aggregate_gold


def main(argv: list[str] | None = None) -> int:
    """Business purpose: Score reproducible frozen Preparation outputs against gold.

    Business rules:
    - Only caller-supplied immutable JSON inputs; no LLM calls or APIs.
    - Diagnostic matches never constitute production acceptance.
    - Reviewed-input mode requires an out-of-band approved gold hash and a bound run manifest.

    Execution flow:
    1. Load and hash pinned gold and candidate JSON files.
    2. Evaluate claims, actor-stage choices and material context.
    3. Optionally verify a separately pinned approval digest and runtime receipt.
    4. Emit explicit blocking reasons and exit nonzero on any failed semantic or review gate.

    Failure cases:
    - Missing/corrupt input, mismatched claims or missing reviewed evidence returns nonzero.

    Side effects:
    - Prints a bounded JSON report to stdout; writes no project state.
    """
    parser = argparse.ArgumentParser(description="Offline LCSP Preparation semantic scorer")
    parser.add_argument("--gold", type=Path)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--approved-gold-sha256", help="Expected gold digest from independently controlled review")
    parser.add_argument("--run-manifest", type=Path, help="Frozen model-facing run manifest bound to candidate")
    parser.add_argument("--review-package", type=Path, help="Seven source-pinned PM cases and reviewed positive/mixed/HITL controls")
    parser.add_argument("--approved-review-package-sha256", help="Package digest pinned by independent release/review authority")
    parser.add_argument("--preflight-only", action="store_true", help="Report missing review inputs without a model invocation")
    parser.add_argument("--baseline", type=Path, help="Frozen baseline output scored with the same gold and holdout")
    parser.add_argument("--baseline-run-manifest", type=Path)
    parser.add_argument("--billing-evidence-dir", type=Path, help="Immutable provider usage/billing JSON receipts named by their actual SHA-256")
    args = parser.parse_args(argv)
    review_package = None
    package_errors = []
    if args.review_package is not None:
        raw_package = args.review_package.read_bytes()
        review_package = json.loads(raw_package)
        package_errors = reviewed_case_package_preflight(review_package, raw_package, args.approved_review_package_sha256)
    elif args.approved_review_package_sha256 is not None:
        package_errors.append("PM_REVIEW_PACKAGE_REQUIRED")
    if args.preflight_only:
        if review_package is None:
            parser.error("--preflight-only requires --review-package")
        print(json.dumps({"status": "BLOCKED_EXTERNAL_REVIEW_INPUT" if package_errors else "INPUT_CONTRACT_PASSED_NOT_LEGAL_APPROVAL", "blockingReasons": package_errors, "paidModelCalls": 0, "modelEvaluation": "NOT_RUN"}, ensure_ascii=False, indent=2))
        return 4 if package_errors else 0
    if args.gold is None or args.candidate is None:
        parser.error("--gold and --candidate are required for frozen-output scoring")
    gold_bytes = args.gold.read_bytes()
    candidate_bytes = args.candidate.read_bytes()
    gold = json.loads(gold_bytes)
    candidate = json.loads(candidate_bytes)
    report = evaluate_preparation_semantics(
        gold, candidate["semanticGraph"], candidate["scopeDecisions"]
    )
    report["inputProvenance"] = {
        "goldSha256": sha256(gold_bytes).hexdigest(),
        "candidateSha256": sha256(candidate_bytes).hexdigest(),
    }
    gate_requested = args.approved_gold_sha256 is not None or args.run_manifest is not None or review_package is not None or args.baseline is not None or args.approved_review_package_sha256 is not None or args.baseline_run_manifest is not None
    gate_errors: list[str] = list(package_errors)
    if review_package is not None:
        gate_errors.extend(reviewed_cases_in_aggregate_gold(review_package, gold))
    if args.baseline_run_manifest is not None and args.baseline is None:
        gate_errors.append("PAIRED_EVAL_BASELINE_OUTPUT_REQUIRED")
    if gate_requested:
        if not args.approved_gold_sha256 or args.run_manifest is None:
            gate_errors.append("REVIEWED_EVAL_APPROVAL_INPUTS_INCOMPLETE")
        else:
            manifest = json.loads(args.run_manifest.read_text(encoding="utf-8"))
            gate_errors.extend(reviewed_eval_preflight(
                gold, gold_bytes, candidate, manifest, args.approved_gold_sha256
            ))
    if args.baseline is not None:
        if review_package is None or not args.approved_review_package_sha256:
            gate_errors.append("PAIRED_EVAL_APPROVED_SEVEN_CASE_PACKAGE_REQUIRED")
        if args.baseline_run_manifest is None or args.run_manifest is None or not args.approved_gold_sha256:
            gate_errors.append("PAIRED_EVAL_BASELINE_AND_CANDIDATE_RECEIPTS_REQUIRED")
        else:
            baseline_bytes = args.baseline.read_bytes()
            baseline = json.loads(baseline_bytes)
            baseline_manifest = json.loads(args.baseline_run_manifest.read_bytes())
            candidate_manifest = json.loads(args.run_manifest.read_bytes())
            gate_errors.extend(reviewed_eval_preflight(gold, gold_bytes, baseline, baseline_manifest, args.approved_gold_sha256))
            gate_errors.extend(paired_eval_preflight(baseline_manifest, candidate_manifest, review_package))
            if args.billing_evidence_dir is None:
                gate_errors.append("PAIRED_EVAL_PROVIDER_RECEIPT_ARCHIVE_REQUIRED")
            else:
                archive = args.billing_evidence_dir.resolve()
                for run in (baseline_manifest, candidate_manifest):
                    billing = run.get("billingReconciliation") or {}
                    for key in ("providerUsageReceiptSha256", "billingReceiptSha256"):
                        value = billing.get(key)
                        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
                            gate_errors.append("PAIRED_EVAL_PROVIDER_RECEIPT_MISSING:" + key)
                            continue
                        path = (archive / (value + ".json")).resolve()
                        if not path.is_relative_to(archive) or not path.is_file() or sha256(path.read_bytes()).hexdigest() != value:
                            gate_errors.append("PAIRED_EVAL_PROVIDER_RECEIPT_INTEGRITY_FAILED:" + key)
            baseline_score = evaluate_preparation_semantics(gold, baseline["semanticGraph"], baseline["scopeDecisions"])
            report["baselineComparison"] = {
                "baselineOutputSha256": sha256(baseline_bytes).hexdigest(),
                "candidateOutputSha256": sha256(candidate_bytes).hexdigest(),
                "baselineCriticalErrorCounts": baseline_score["criticalErrorCounts"],
                "candidateCriticalErrorCounts": report["criticalErrorCounts"],
                "baselineClaimMetrics": baseline_score["claimMetrics"], "candidateClaimMetrics": report["claimMetrics"],
                "baselineUsage": baseline_manifest.get("usage"), "candidateUsage": candidate_manifest.get("usage"),
                "legalAcceptance": "NOT_PROVEN_BY_SCORING_OR_RECEIPTS",
            }
            baseline_usage, candidate_usage = baseline_manifest.get("usage") or {}, candidate_manifest.get("usage") or {}
            report["baselineComparison"]["usageDelta"] = {
                key: candidate_usage[key] - baseline_usage[key]
                if all(isinstance(usage.get(key), (int, float)) and not isinstance(usage[key], bool) and isfinite(usage[key]) for usage in (baseline_usage, candidate_usage))
                else None for key in ("physicalAttempts", "failedAttempts", "inputTokens", "cachedInputTokens", "outputTokens", "providerCost")
            }
    if review_package is not None:
        case_outcomes = []
        for case in review_package.get("cases", []):
            case_gold = case.get("gold")
            if not isinstance(case_gold, dict) or not case_gold.get("normativeClaims"):
                case_outcomes.append({"caseId": case["caseId"], "status": "BLOCKED_EXTERNAL_REVIEW_INPUT"})
                continue
            try:
                expected_ids = {row["claimId"] for row in [*case_gold.get("normativeClaims", []), *case_gold.get("contextClaims", [])]}
                source_nodes = set(case.get("sourceNodeIds", []))
                claims = [claim for claim in candidate["semanticGraph"].get("claims", []) if claim.get("claimId") in expected_ids or source_nodes.intersection(claim.get("sourceNodeIds", []))]
                ids = {claim["claimId"] for claim in claims}
                graph = {**candidate["semanticGraph"], "claims": claims, "relations": [edge for edge in candidate["semanticGraph"].get("relations", []) if edge["fromClaimId"] in ids and edge["toClaimId"] in ids]}
                decisions = [decision for decision in candidate["scopeDecisions"] if decision["claimId"] in ids]
                score = evaluate_preparation_semantics(case_gold, graph, decisions)
                case_outcomes.append({"caseId": case["caseId"], "status": "FROZEN_OUTPUT_SCORED_NOT_LEGAL_ACCEPTANCE", "criticalErrorCounts": score["criticalErrorCounts"], "claimMetrics": score["claimMetrics"]})
            except (ValueError, KeyError, TypeError) as error:
                gate_errors.append("PM_REVIEW_CASE_SCORING_INVALID:" + case["caseId"])
                case_outcomes.append({"caseId": case["caseId"], "status": "BLOCKED_INVALID_FROZEN_INPUT", "errorType": type(error).__name__})
        report["sevenCaseOutcomes"] = case_outcomes
    report["reviewedEvidenceGate"] = {
        "status": (
            "NOT_REQUESTED" if not gate_requested else
            "BLOCKED" if gate_errors else "INPUT_CONTRACT_PASSED_NOT_LEGAL_APPROVAL"
        ),
        "blockingReasons": gate_errors,
        "legalMeaningVerified": False,
        "liveModelReliabilityProven": False,
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if gate_errors:
        return 4
    return 0 if report["fixtureMatched"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
