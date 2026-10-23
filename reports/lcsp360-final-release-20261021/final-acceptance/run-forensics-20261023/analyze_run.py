"""Read genuine retained evidence; invoke only pinned-source retrieval, never a model."""
from collections import Counter
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile

from rule_set_preparation.legal_source_files import materialize_legal_source
from rule_set_preparation.source_graph import PinnedSourceGraph, build_source_graph_tools

HERE = Path(__file__).resolve().parent
ORIGINAL = HERE.parent / "authorized-real-model-20261023"
snapshot = json.loads((HERE / "postgres-read-only-snapshot.json").read_text())
bundle = snapshot["bundle"]
source = PinnedSourceGraph(bundle["documentGraph"], [
    {**chunk, "chunkId": chunk["id"], "documentId": document["documentId"],
     "legalSourceVersionId": bundle["legalSourceVersionId"]}
    for document in bundle["documents"] for chunk in document["chunks"]
])
tools = {tool.name: tool for tool in build_source_graph_tools(source)}
access = []
with tempfile.TemporaryDirectory(prefix="lcsp360-read-only-corpus-") as directory:
    root = Path(directory)
    materialize_legal_source(bundle, root)
    for review in snapshot["reviews"]:
        node_id = review["sourceNodeId"]
        result = json.loads(tools["get_legal_node"].invoke({"node_id": node_id}))
        assert result["node"]["content"] == source.nodes[node_id]["content"]
        assert result["legalSourceVersionId"] == bundle["legalSourceVersionId"]
        assert not result["hasMore"] and result["node"]["content"].strip()
        file_text = (root / "legal-source" / "nodes" / f"{node_id}.md").read_text()
        assert file_text.split("\n---\n", 1)[1] == result["node"]["content"]
        reference_targets = []
        for reference_id in review["referenceIds"]:
            followed = json.loads(tools["follow_legal_reference"].invoke({"reference_id": reference_id}))
            if followed["reference"]["resolutionState"] == "RESOLVED":
                assert followed["nodes"]
            else:
                assert followed["reference"]["toNodeId"] is None
            reference_targets.append({"state": followed["reference"]["resolutionState"],
                                      "target": followed["reference"]["toNodeId"]})
        access.append({"sourceNodeId": node_id, "state": review["state"],
                       "characters": len(result["node"]["content"]), "graphToolReadable": True,
                       "materializedFileReadable": True, "referenceTargets": reference_targets})
chunks = [chunk for document in bundle["documents"] for chunk in document["chunks"]]
for chunk in chunks:
    assert hashlib.sha256(chunk["content"].encode()).hexdigest() == chunk["contentSha256"].removeprefix("sha256:")

journal = ORIGINAL / "original-journal-snapshot.sqlite3"
with sqlite3.connect(f"file:{journal}?mode=ro&immutable=1", uri=True) as db:
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    attempts = list(db.execute("SELECT attempt_id,state,input_exposure,output_exposure FROM inference_attempts"))
    events = [json.loads(row[0]) for row in db.execute("SELECT payload FROM usage_recovery WHERE kind='EVIDENCE' ORDER BY id")]
    poisoned = list(db.execute("SELECT dead_lettered_at,dead_letter_reason FROM usage_recovery WHERE state='POISON' ORDER BY id"))
    histories = [json.loads(row[0]) for row in db.execute("SELECT history FROM inference_attempts")]
responses = {r["invocationId"]: r for r in events if r.get("event") == "MODEL_RESPONSE"}
persisted = json.loads((ORIGINAL / "persisted-usage-after-recovery.json").read_text())["rows"]
assert len(attempts) == len(persisted) == 24 and len(responses) == 23
assert {r[0] for r in attempts} == {r["invocationId"] for r in persisted}
subtotal = Decimal(0)
for row in persisted:
    invocation = row["invocationId"]
    if invocation in responses:
        for key, value in (responses[invocation]["usage"] or {}).items():
            if key in row and value is not None:
                assert str(value) == str(row[key]), (invocation, key)
    else:
        assert row["attemptStatus"] == "OUTCOME_UNKNOWN"
        assert row["inputTokensIncludingCache"] is row["outputTokens"] is None
    price = row["referenceCostSnapshot"]
    known = sum((Decimal(row[field]) * Decimal(price["ratesPerMillion"][bucket]) / Decimal(1000000)
                 for field, bucket in [("inputTokens", "input"), ("cachedInputTokens", "cached"),
                     ("cacheWrite5mTokens", "cacheWrite5m"), ("cacheWrite1hTokens", "cacheWrite1h"), ("outputTokens", "output")]
                 if row[field] is not None), Decimal(0))
    assert known == Decimal(price["knownCostUsd"])
    subtotal += known
for audit in snapshot["audits"]:
    receipt = audit["receipt"]
    invocation = responses[receipt["verifierOperationId"]]
    assert invocation["agentRole"] == "legal-semantic-auditor"
    review = next(r for r in snapshot["reviews"] if r["sourceNodeId"] == receipt["sourceNodeId"])
    assert review["payload"]["semanticAudit"] == receipt
    for claim in review["payload"]["claims"]:
        for support in claim["sourceSupport"]:
            text = source.nodes[support["nodeId"]]["content"].encode("utf-16-le")
            selected = text[support["startOffset"] * 2:support["endOffset"] * 2].decode("utf-16-le")
            assert hashlib.sha256(selected.encode()).hexdigest() == support["contentSha256"]

trace = [json.loads(line) for line in (ORIGINAL / "live-run/live-eval-synthetic.trace.jsonl").read_text().splitlines()]
progress = [json.loads(line) for line in (ORIGINAL / "live-run/live-eval-synthetic.progress.jsonl").read_text().splitlines()]
stop = json.loads((ORIGINAL / "runtime-gate-stop.json").read_text())
started = json.loads((ORIGINAL / "one-evaluation-started.json").read_text())["startedAtEpoch"]
first_poison = datetime.fromisoformat(poisoned[0][0].replace("Z", "+00:00")).timestamp()
pending = None
latencies = []
for event in trace:
    if event["event"] == "model_start":
        assert pending is None  # The retained trace has no overlapping model callbacks.
        pending = event["at"]
    elif event["event"] == "model_end":
        assert pending is not None
        latencies.append(round(event["at"] - pending, 1))
        pending = None
assert pending is not None and stop["stoppedAtEpoch"] > pending
last_advance = max(r["t"] for r, prior in zip(progress[1:], progress) if r["withClaims"] != prior["withClaims"])
proof = {
    "status": "ENGINEERING_FORENSICS_PASS_SEMANTIC_COMPLETENESS_UNPROVEN",
    "runId": snapshot["run"]["id"], "sourceCandidate": "bc990176cbb046ea95e12a94fc29e81bc8869653",
    "termination": {"mechanism": stop["signal"], "reason": stop["reason"],
        "firstPoisonSecondsFromLaunch": round(first_poison - started, 3),
        "completedResponsesAfterFirstPoison": sum(r["occurredAt"] > first_poison for r in responses.values()),
        "responseCountTimestampMeaning": "MODEL_RESPONSE evidence commit, not provider arrival; first callback can quarantine before this commit",
        "attemptSettlementsAfterFirstPoison": sum(any(h["state"] == "SETTLED" and h["at"] > first_poison for h in history) for history in histories),
        "completedAttemptsDispatchedAfterFirstPoison": sum(any(h["state"] == "IN_FLIGHT" and h["at"] > first_poison for h in history) and any(h["state"] == "SETTLED" for h in history) for history in histories),
        "lastDurableUnitCompletedSecondsFromLaunch": round(max(datetime.fromisoformat(r["completedAt"].replace("Z", "+00:00")).timestamp() for r in snapshot["reviews"] if r["completedAt"]) - started, 3),
        "lastFrontierCompletionProgressSecond": last_advance,
        "lastTraceModelStartSecondsFromLaunch": round(pending - started, 3),
        "unansweredRequestSecondsAtStop": round(stop["stoppedAtEpoch"] - pending, 3),
        "completedModelCallbackLatenciesSeconds": latencies,
        "finalProgress": progress[-1], "callbackPoisonCount": len(poisoned),
        "prematureInventoryFreeze": False, "automaticCallbackTermination": False},
    "retrieval": {"chunkHashesVerified": len(chunks), "reviewUnits": access,
        "unfinishedUnitsReadable": sum(r["state"] in {"PENDING", "IN_REVIEW"} for r in access),
        "historicalReferenceStates": dict(Counter(r["resolutionState"] for r in source.references.values())),
        "providerDispatches": 0},
    "accounting": {"attempts": len(attempts), "responses": len(responses),
        "states": dict(Counter(row[1] for row in attempts)), "roles": dict(Counter(r["agentRole"] for r in persisted)),
        "knownInputCacheTokens": sum(int(r["usage"]["inputTokensIncludingCache"]) for r in responses.values()),
        "knownOutputTokens": sum(int(r["usage"]["outputTokens"]) for r in responses.values()),
        "completeInputCacheTokens": None, "completeOutputTokens": None,
        "knownReferenceSubtotalUSD": str(subtotal), "completeReferenceTotalUSD": None,
        "actualGatewayCharge": "UNAVAILABLE", "unknownExposureInput": 1048576, "unknownExposureOutput": 128000},
    "auditor": {"persistedReceiptsMatchCompletedReviewPayloads": len(snapshot["audits"]),
        "actualIndependentInvocationsMatched": len(snapshot["audits"]), "supportHashesRecomputed": True,
        "hmacReverification": "NOT_REPEATED: private ephemeral key unavailable; original signed receipts and prior independent HMAC verification preserved"},
    "resume": {"actualClaimHandler": snapshot["claimResumeDenied"], "graphCheckpointer": False,
        "committedUnitPayloadsRetained": 2, "activeUncommittedClaims": 0,
        "sameRunResumeSupported": False, "newPaidAuthorizationRequired": True},
    "limitations": ["Historical model text, full tool replies and conversation checkpoint were not retained.",
        "No claim that callback repair proves model convergence on the third unit or full corpus.",
        "No paid inference, Rule Set activation, staging or deployment occurred in this analysis."],
}
(HERE / "forensic-verdict.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps({"status": proof["status"], "attempts": len(attempts), "responses": len(responses),
                  "unfinishedUnitsReadable": proof["retrieval"]["unfinishedUnitsReadable"], "resumeSupported": False}))
