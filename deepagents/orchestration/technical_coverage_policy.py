"""Scanner-workflow policy implementing frozen Interview contract sections 5 and 30."""

from hashlib import sha256
import json
from typing import Any


POLICY_VERSION = "initial-interview-bounded-evidence-v1"


def attach_partial_coverage_policy(payload: dict[str, Any]) -> dict[str, Any]:
    """Record an auditable invocation decision without asserting business readiness."""
    graph = payload.get("evidence_graph")
    if not isinstance(graph, dict):
        return payload
    state = str(graph.get("coverage_state", "")).strip().upper()
    if state not in {"PARTIAL", "LIMITED"}:
        return payload
    # Explicit prior decisions remain authoritative, including denial.
    if any(payload.get(key) is not None or graph.get(key) is not None for key in (
        "partialCoveragePolicyDecision", "partial_coverage_policy_decision",
        "coveragePolicyDecision", "coverage_policy_decision",
    )):
        return payload
    raw_notes = graph.get("coverage_notes")
    limitations = [note.strip() for note in raw_notes
                   if isinstance(note, str) and note.strip()] if isinstance(raw_notes, list) else []
    snapshot = graph.get("snapshot_id")
    commit = graph.get("commit_sha")
    pinned = all(isinstance(value, str) and value.strip() for value in (snapshot, commit))
    # A bounded report can support Interview even without complete graph extraction.
    # It cannot authorize downstream business conclusions or fill missing evidence.
    has_evidence = any(isinstance(items, list) and any(isinstance(item, dict) and item for item in items)
                       for items in (graph.get("nodes"), payload.get("technical_findings"),
                                     payload.get("structural_facts")))
    permitted = bool(pinned and limitations and has_evidence)
    basis = {"policyVersion": POLICY_VERSION, "snapshotId": snapshot,
             "commitSha": commit, "limitations": limitations,
             "evidenceDigest": sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
             "hasEvidence": has_evidence, "permittedForInterview": permitted}
    digest = sha256(json.dumps(basis, sort_keys=True).encode()).hexdigest()
    return {**payload, "partialCoveragePolicyDecision": {
        "policyDecisionRef": f"coverage-policy:{digest}",
        "policyVersion": POLICY_VERSION,
        "permittedForInterview": permitted,
        "limitations": limitations,
    }}
