"""Read-only independent reconciliation of this one real run; never calls a model."""
import hashlib
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path
import sqlite3

out = Path(__file__).resolve().parent
rows = json.loads((out / "persisted-usage-after-recovery.json").read_text())["rows"]
journal = next((out / "live-run").glob("*.usage-*/usage.json.sqlite3"))
with sqlite3.connect(f"file:{journal}?mode=ro", uri=True) as db:
    attempts = {r[0]: r[1:] for r in db.execute("SELECT attempt_id,state,input_exposure,output_exposure FROM inference_attempts")}
    events = [json.loads(r[0]) for r in db.execute("SELECT payload FROM usage_recovery WHERE kind='EVIDENCE'")]
responses = {r["invocationId"]: r for r in events if r.get("event") == "MODEL_RESPONSE"}
assert len(rows) == len(attempts) == 24 and len(responses) == 23
assert {r["invocationId"] for r in rows} == set(attempts)
terms = []
for row in rows:
    invocation = row["invocationId"]
    assert (row["attemptStatus"] == "COMPLETED") == (invocation in responses)
    if invocation in responses:
        usage = responses[invocation]["usage"] or {}
        for key, value in usage.items():
            if key in row and value is not None:
                assert str(row[key]) == str(value), (invocation, key)
        assert row["availabilityReason"] is None
    else:
        assert row["attemptStatus"] == "OUTCOME_UNKNOWN"
        assert attempts[invocation] == ("IN_FLIGHT", 1048576, 128000)
        assert row["inputTokensIncludingCache"] is row["outputTokens"] is None
    snapshot = row["referenceCostSnapshot"]
    rates = snapshot["ratesPerMillion"]
    # These are the frozen official-reference rates, never gateway invoice rates.
    assert rates["input"] == "2" and rates["cached"] == "0.20" and rates["output"] == "10"
    known = Decimal(0)
    for field, rate in [("inputTokens", "input"), ("cachedInputTokens", "cached"), ("cacheWrite5mTokens", "cacheWrite5m"), ("cacheWrite1hTokens", "cacheWrite1h"), ("outputTokens", "output")]:
        if row[field] is not None:
            known += Decimal(row[field]) * Decimal(rates[rate]) / Decimal(1000000)
    assert known == Decimal(snapshot["knownCostUsd"])
    assert int(known * Decimal(10**18)) == int(snapshot["knownCostAttodollars"])
    if row["inputTokens"] is not None:
        assert row["inputTokensIncludingCache"] == row["inputTokens"] + row["cachedInputTokens"] + row["cacheWriteTokens"]
    if snapshot["status"] == "COMPLETE":
        assert snapshot["estimatedCostUsd"] == snapshot["knownCostUsd"]
    else:
        assert snapshot["estimatedCostUsd"] is None
    terms.append(known)
known_subtotal = sum(terms, Decimal(0))
assert known_subtotal == Decimal("0.6481276")
assert sum(v[1] for v in attempts.values()) == 1439799 <= 4000000
assert sum(v[2] for v in attempts.values()) == 131272 <= 256000
proof = {
    "status": "PASS_RECONCILED_KNOWN_USAGE_TOTAL_INCOMPLETE",
    "runId": "4ae336f3-35b4-4393-ba42-cb4eeb4d500f",
    "physicalAttempts": len(attempts), "responses": len(responses),
    "statuses": dict(Counter(r["attemptStatus"] for r in rows)),
    "roles": dict(Counter(r["agentRole"] for r in rows)),
    "knownInputCacheTokens": sum(r["inputTokensIncludingCache"] for r in rows if r["inputTokensIncludingCache"] is not None),
    "knownUncachedInputTokens": sum(r["inputTokens"] for r in rows if r["inputTokens"] is not None),
    "knownCachedReadTokens": sum(r["cachedInputTokens"] for r in rows if r["cachedInputTokens"] is not None),
    "knownOutputTokens": sum(r["outputTokens"] for r in rows if r["outputTokens"] is not None),
    "referenceKnownSubtotalUsd": str(known_subtotal),
    "referenceTotalUsd": None, "actualGatewayCostUsd": "UNAVAILABLE",
    "incompleteCostInvocations": sum(r["referenceCostSnapshot"]["status"] != "COMPLETE" for r in rows),
    "outstandingInputExposure": 1048576, "outstandingOutputExposure": 128000,
    "totalInputExposure": sum(v[1] for v in attempts.values()),
    "totalOutputExposure": sum(v[2] for v in attempts.values()),
    "noDoubleCounting": True, "reasoningSeparate": "UNAVAILABLE; output already includes any reasoning, no second charge",
    "priceVersions": sorted({r["referenceCostSnapshot"]["priceVersionId"] for r in rows}),
    "originalJournalSha256": hashlib.sha256(journal.read_bytes()).hexdigest(),
    "originalJournalUnchanged": hashlib.sha256(journal.read_bytes()).hexdigest() == json.loads((out / "callback-recovery-receipt.json").read_text())["originalJournalSha256"],
    "providerCallsDuringRecovery": 0,
}
assert proof["originalJournalUnchanged"]
(out / "independent-usage-reconciliation.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps(proof))
