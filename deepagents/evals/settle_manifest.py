"""Settle immutable LCSP model-facing eval receipt with an externally reconciled journal.

Usage is NEVER inferred from token prices or prompt length. Only the approved
API/usage journal collector can provide its reconciled numeric report.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from evals.run_manifest import save_runtime_manifest, settle_runtime_manifest

_USAGES = ("physicalAttempts", "failedAttempts", "inputTokens",
           "cachedInputTokens", "outputTokens", "providerCost", "costCurrency")


def reconcile_usage(manifest: dict[str, Any], journal: dict[str, Any]) -> dict[str, Any]:
    """Business purpose:
    Reconcile model call accounting against the immutable run receipt.

    Business rules:
    - Only complete, source-pinned journal evidence can authorize numeric billing.

    Execution flow:
    1. Check identity, source, content hash and numeric fields before settling.

    Failure cases:
    - Stale, negative, partial or unbilled cost values reject settlement.

    Side effects:
    - Pure transformation; never invokes providers or guesses prices."""
    if journal.get("runId") != manifest.get("runId"):
        raise ValueError("USAGE_RECEIPT_RUN_MISMATCH")
    if journal.get("accountingSource") not in {"API_USAGE_JOURNAL", "SERVER_BILLING_LEDGER"}:
        raise ValueError("USAGE_RECEIPT_UNTRUSTED_SOURCE")
    if journal.get("accountingState") != "COMPLETE":
        raise ValueError("USAGE_RECEIPT_NOT_RECONCILED")
    if not isinstance(journal.get("recordsSha256"), str) or len(journal["recordsSha256"]) != 64 or any(
        char not in "0123456789abcdef" for char in journal["recordsSha256"]
    ):
        raise ValueError("USAGE_RECEIPT_JOURNAL_HASH_MISSING")
    observed = {key: journal.get(key) for key in _USAGES}
    for key in _USAGES[:5]:
        if observed[key] is not None and (not isinstance(observed[key], int) or
                                          isinstance(observed[key], bool) or observed[key] < 0):
            raise ValueError("USAGE_RECEIPT_INVALID_COUNT:" + key)
    if observed["providerCost"] is not None:
        if not isinstance(observed["providerCost"], (int, float)) or observed["providerCost"] < 0:
            raise ValueError("USAGE_RECEIPT_COST_INVALID")
        if journal["accountingSource"] != "SERVER_BILLING_LEDGER" or not observed["costCurrency"]:
            raise ValueError("USAGE_RECEIPT_COST_NOT_BILLED")
    # Missing fields remain null. A provider not reporting cache tokens or
    # cost cannot magically become a zero-valued usage line item.
    return settle_runtime_manifest(
        manifest, selected_skill_hashes=manifest.get("selectedSkillsSha256") or {},
        usage=observed,
    )


def main() -> None:
    """Business purpose:
    Provide CLI for a reconciled evaluation accounting receipt.

    Business rules:
    - Require existing manifest, journal and separate output target.

    Execution flow:
    1. Parse arguments, load JSON, reconcile and write immutable output.

    Failure cases:
    - File access, validation or replay conflicts stop the command.

    Side effects:
    - Reads two inputs and writes one receipt."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--usage-journal", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    journal = json.loads(args.usage_journal.read_text(encoding="utf-8"))
    save_runtime_manifest(args.output, reconcile_usage(manifest, journal))
    print(json.dumps({"output": str(args.output), "accountingState": "COMPLETE"}))


if __name__ == "__main__":
    main()
