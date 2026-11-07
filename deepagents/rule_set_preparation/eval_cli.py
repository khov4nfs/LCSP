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

from rule_set_preparation.eval_semantics import evaluate_preparation_semantics
from rule_set_preparation.reviewed_eval_gate import reviewed_eval_preflight


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
    parser.add_argument("--gold", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--approved-gold-sha256", help="Expected gold digest from independently controlled review")
    parser.add_argument("--run-manifest", type=Path, help="Frozen model-facing run manifest bound to candidate")
    args = parser.parse_args(argv)
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
    gate_requested = args.approved_gold_sha256 is not None or args.run_manifest is not None
    gate_errors: list[str] = []
    if gate_requested:
        if not args.approved_gold_sha256 or args.run_manifest is None:
            gate_errors.append("REVIEWED_EVAL_APPROVAL_INPUTS_INCOMPLETE")
        else:
            manifest = json.loads(args.run_manifest.read_text(encoding="utf-8"))
            gate_errors = reviewed_eval_preflight(
                gold, gold_bytes, candidate, manifest, args.approved_gold_sha256
            )
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
