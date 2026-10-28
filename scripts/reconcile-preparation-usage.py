#!/usr/bin/env python3
"""Read-only reconciliation of Preparation usage receipts and resume requests.

Run with deepagents/.venv/bin/python. DATABASE_URL identifies the source database.
This command neither dispatches models nor settles or repairs historical records.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from uuid import UUID


TOKEN_FIELDS = (
    "inputTokens", "cachedInputTokens", "inputTokensIncludingCache", "outputTokens",
    "reasoningTokens", "visibleOutputTokens", "totalTokens", "cacheWriteTokens",
    "cacheWrite5mTokens", "cacheWrite1hTokens",
)


def summarize(records: list[dict], requests: list[dict], historical_input_limit: int | None) -> dict:
    """Business purpose:
    Reconcile retained Preparation usage without presenting missing attempts or charges as verified accounting.

    Business rules:
    - Sum every known reported bucket, including failed-attempt usage; absent usage remains unknown.
    - Reasoning is within output, request windows are temporal associations, and receipt settlement is not financial proof.

    Execution flow:
    1. Count retained invocation/response identities, outcomes and available token buckets.
    2. Associate receipts with ordered enqueue windows without inventing execution identities.
    3. Return qualified historical-limit comparisons and unresolved financial evidence.

    Failure cases:
    - Malformed required receipt fields propagate; missing optional usage cannot become a measured zero.

    Side effects:
    - Pure accounting projection; no database, admission, settlement or provider action.
    """
    completed = [row for row in records if row["status"] == "SETTLED" and row["attemptStatus"] == "COMPLETED"]
    invocations = Counter(row["invocationId"] for row in records)
    responses = Counter(row["providerResponseId"] for row in records if row.get("providerResponseId"))
    tokens = {
        field: {
            "knownSum": sum(row[field] for row in records if row.get(field) is not None),
            "knownReceipts": sum(row.get(field) is not None for row in records),
            "unknownReceipts": sum(row.get(field) is None for row in records),
        }
        for field in TOKEN_FIELDS
    }
    groups = Counter((row["provider"], row["model"], row["status"], row["attemptStatus"]) for row in records)
    windows = []
    for index, request in enumerate(requests):
        next_start = requests[index + 1]["createdAt"] if index + 1 < len(requests) else None
        bucket = [row for row in records if row["occurredAt"] >= request["createdAt"] and (next_start is None or row["occurredAt"] < next_start)]
        windows.append({
            **request, "nextRequestAt": next_start, "observedReceipts": len(bucket),
            "completedReceipts": sum(row["attemptStatus"] == "COMPLETED" for row in bucket),
            "failedReceipts": sum(row["attemptStatus"] == "FAILED" for row in bucket),
            "unknownOutcomes": sum(row["attemptStatus"] == "OUTCOME_UNKNOWN" for row in bucket),
            "association": "ENQUEUE_TIME_WINDOW_ONLY_NOT_EXECUTION_ID",
        })
    known_input = tokens["inputTokensIncludingCache"]["knownSum"]
    return {
        "observedInvocationReceipts": len(records), "completedInvocationReceipts": len(completed),
        "failedAttemptReceipts": sum(row["attemptStatus"] == "FAILED" for row in records),
        "unknownOutcomeReceipts": sum(row["attemptStatus"] == "OUTCOME_UNKNOWN" for row in records),
        "duplicateInvocationIds": sum(count - 1 for count in invocations.values()),
        "duplicateProviderResponseIds": sum(count - 1 for count in responses.values()),
        "uniqueProviderResponseIds": len(responses), "tokenTotals": tokens,
        "providerGroups": [dict(zip(("provider", "model", "receiptStatus", "attemptStatus"), group), count=count) for group, count in sorted(groups.items())],
        "failureClasses": dict(Counter(row.get("failureClass") or "UNSPECIFIED" for row in records if row["attemptStatus"] != "COMPLETED")),
        "resumeRequests": windows,
        "historicalInputLimitComparison": {
            "reviewerReportedLimit": historical_input_limit,
            "knownInputIncludingCache": known_input,
            "knownExcess": max(0, known_input - historical_input_limit) if historical_input_limit is not None else None,
            "approvedEnvelope": "NOT_PROVEN",
        },
        "financialEvidence": {
            "reservationReceipts": sum(row.get("reservationId") is not None for row in records),
            "pricingReceipts": sum(row.get("pricingSnapshotId") is not None for row in records),
            "providerCostReceipts": sum(row.get("providerCostCredits") is not None for row in records),
            "chargedReceipts": sum(row.get("chargedCredits") is not None for row in records),
            "status": "NOT_PROVEN",
        },
        "qualifications": [
            "Completed invocation receipts are not a proven count of logical model calls or all physical network attempts.",
            "Unique provider response IDs detect retained duplicate receipts; they do not establish retry completeness.",
            "Reasoning tokens are an output breakdown, not additional tokens to add to output or total.",
            "Missing failure usage is unknown exposure, not a measured zero charge.",
            "Resume request IDs and correlations are durable; timestamp windows cannot reconstruct missing execution IDs or late-response attribution.",
            "SETTLED identifies a durable usage receipt; without pricing/reservation evidence it does not prove financial settlement.",
            "A reviewer-reported historical ceiling is compared retrospectively; this command creates no new execution limit or approval.",
        ],
    }


def inspect_journal(path: Path, run_id: str) -> dict:
    """Business purpose:
    Locate retained usage or envelope evidence for one Preparation run without repairing historical state.

    Business rules:
    - Open existing SQLite files read-only and match explicit run identities only.
    - A missing journal or no matching row is limited search evidence, not proof that no provider attempt occurred.

    Execution flow:
    1. Discover available journal tables through a read-only connection.
    2. Count matching recovery records and any supported envelope fingerprints.
    3. Return the searched path, table scope and observed matches.

    Failure cases:
    - Missing files return exists:false; corrupt journal schemas or payloads fail explicitly rather than report a clean audit.

    Side effects:
    - Read-only filesystem and SQLite access; no usage delivery or settlement mutation.
    """
    result = {"path": str(path), "exists": path.is_file(), "matchingRunRows": 0, "tables": []}
    if not path.is_file():
        return result
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.execute("BEGIN")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        result["tables"] = sorted(tables)
        if "usage_recovery" in tables:
            groups = Counter()
            for kind, state, payload in db.execute("SELECT kind,state,payload FROM usage_recovery"):
                value = json.loads(payload)
                if run_id in (value.get("runId"), value.get("preparationRunId")):
                    groups[(kind, state)] += 1
            result["matchingRunRows"] = sum(groups.values())
            result["groups"] = [{"kind": kind, "state": state, "count": count} for (kind, state), count in sorted(groups.items())]
        if "inference_budgets" in tables:
            columns = {row[1] for row in db.execute("PRAGMA table_info(inference_budgets)")}
            if {"run_id", "fingerprint"} <= columns:
                result["envelopeFingerprints"] = [row[0] for row in db.execute("SELECT fingerprint FROM inference_budgets WHERE run_id=?", (run_id,))]
    return result


def json_default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value).__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", type=UUID)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--journal", action="append", type=Path, default=[])
    parser.add_argument("--historical-input-limit", type=int)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        rows = [
            {"invocationId": "a", "providerResponseId": "r-a", "provider": "p", "model": "m", "status": "SETTLED", "attemptStatus": "COMPLETED", "inputTokens": 20, "cachedInputTokens": 80, "inputTokensIncludingCache": 100, "outputTokens": 10, "reasoningTokens": 8, "totalTokens": 110, "occurredAt": "2026-01-01T01:00:00"},
            {"invocationId": "b", "providerResponseId": "r-b", "provider": "p2", "model": "m2", "status": "SETTLED", "attemptStatus": "COMPLETED", "inputTokens": 30, "cachedInputTokens": 10, "inputTokensIncludingCache": 40, "outputTokens": 10, "reasoningTokens": 2, "totalTokens": 50, "occurredAt": "2026-01-01T02:00:00"},
            {"invocationId": "c", "providerResponseId": None, "provider": "p", "model": "m", "status": "UNAVAILABLE", "attemptStatus": "OUTCOME_UNKNOWN", "occurredAt": "2026-01-01T02:01:00"},
        ]
        report = summarize(rows, [], 100)
        assert report["tokenTotals"]["totalTokens"]["knownSum"] == 160
        assert report["tokenTotals"]["outputTokens"]["knownSum"] == 20
        assert report["tokenTotals"]["reasoningTokens"]["knownSum"] == 10
        assert report["tokenTotals"]["inputTokensIncludingCache"]["unknownReceipts"] == 1
        assert report["historicalInputLimitComparison"]["knownExcess"] == 40
        assert report["financialEvidence"]["status"] == "NOT_PROVEN"
        assert summarize([*rows, rows[0]], [], None)["duplicateInvocationIds"] == 1
        assert summarize([*rows, rows[0]], [], None)["duplicateProviderResponseIds"] == 1
        failed_with_usage = {**rows[0], "invocationId": "partial", "providerResponseId": "partial-response", "status": "UNAVAILABLE", "attemptStatus": "FAILED"}
        assert summarize([failed_with_usage], [], None)["tokenTotals"]["inputTokensIncludingCache"]["knownSum"] == 100
        print("PASS: usage reconciliation preserves unknown exposure, duplicate detection and token breakdowns; no database or model calls")
        return
    if not args.run_id or args.output_dir is None:
        parser.error("--run-id and --output-dir are required")
    import psycopg
    from psycopg.rows import dict_row

    run_id = str(args.run_id)
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as connection:
        with connection.transaction():
            connection.execute("SET TRANSACTION READ ONLY")
            fields = ["id", "provider", "model", "invocationId", "providerResponseId", *TOKEN_FIELDS, "runId", "agentRole", "status", "attemptStatus", "failureClass", "availabilityReason", "reservationId", "pricingSnapshotId", "runtimePolicySnapshotId", "chargedCredits", "providerCostCredits", "customerChargeVnd", "occurredAt"]
            query = 'SELECT ' + ','.join('"' + field + '"' for field in fields) + ' FROM "LlmUsageEvent" WHERE "runId"=%s ORDER BY "occurredAt",id'
            records = connection.execute(query, (run_id,)).fetchall()
            requests = connection.execute('SELECT id,"createdAt",payload::jsonb->>\'correlationId\' AS "correlationId" FROM "OutboxMessage" WHERE "eventType"=\'command.compliance-rule-set.preparation.requested.v1\' AND payload::jsonb->>\'preparationRunId\'=%s ORDER BY "createdAt",id', (run_id,)).fetchall()
            zone = connection.execute("SHOW TIME ZONE").fetchone()
    # Normalize database timestamps once, identically for both observed receipts and request windows.
    raw = json.dumps({"records": records, "requests": requests}, default=json_default, sort_keys=True, indent=2) + "\n"
    normalized = json.loads(raw)
    report = {"preparationRunId": run_id, "databaseTimeZone": next(iter(zone.values())), "sourceReceiptSha256": hashlib.sha256(raw.encode()).hexdigest(), **summarize(normalized["records"], normalized["requests"], args.historical_input_limit)}
    report["journalEvidence"] = [inspect_journal(path, run_id) for path in args.journal]
    report["gates"] = {"retainedReceiptIntegrity": "PASS" if not report["duplicateInvocationIds"] and not report["duplicateProviderResponseIds"] else "FAIL", "physicalAttemptCompleteness": "NOT_PROVEN", "approvedAdmissionEnvelope": "NOT_PROVEN", "providerChargeReconciliation": "NOT_PROVEN", "financialGate": "BLOCKED"}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    private = args.output_dir / "usage-source.private.json"
    descriptor = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(raw)
    (args.output_dir / "reconciliation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"runId": run_id, "observedInvocations": len(records), "resumeRequests": len(requests), "gates": report["gates"], "report": str(args.output_dir / "reconciliation.json")}))


if __name__ == "__main__":
    main()
