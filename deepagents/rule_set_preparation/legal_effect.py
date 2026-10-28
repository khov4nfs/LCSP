"""Date-scoped projection of committed claim frames over the existing immutable AST."""
from __future__ import annotations

from datetime import date


def effect_integrity_error(claim, source):
    """Business purpose: Check the structural integrity of one legal-effect frame against its pinned source graph.

    Business rules:
    - An effect needs at least one resolved or explicitly unresolved target; resolved targets must be distinct pinned nodes, and supplied dates must form a valid increasing interval.

    Execution flow:
    1. Return no issue when the claim has no effect frame.
    2. Validate target presence, identity and pinned membership.
    3. Parse optional ISO dates and verify the end follows the start.
    4. Return the first integrity message or `None`.

    Failure cases:
    - Missing targets, duplicate/foreign nodes, malformed dates or reversed periods return a specific error string.

    Side effects:
    - None: performs deterministic structure and date checks only.
    """
    effect = (claim.get("semanticFrame") or {}).get("legalEffect")
    if effect is None:
        return None
    targets = effect["targets"]
    if not targets and not effect["unresolvedTargets"]:
        return "Identify a target or explicitly retain an unresolved target"
    if len({t["nodeId"] for t in targets}) != len(targets) or any(t["nodeId"] not in source.nodes for t in targets):
        return "Effect targets must be distinct nodes in the pinned source materialization"
    try:
        start = date.fromisoformat(effect["effectiveFrom"]) if effect["effectiveFrom"] else None
        end = date.fromisoformat(effect["effectiveUntil"]) if effect["effectiveUntil"] else None
    except ValueError:
        return "Effect dates must be valid ISO dates"
    if start and end and start >= end:
        return "Effect end must follow its start"
    return None


def applicable_legal_state(context, node_id, at_date, offset=0, limit=20):
    """Never turn a draft, unknown date or unresolved condition into operative authority.

    Business purpose: Project verified, date-scoped legal-effect claims that structurally target one pinned provision.

    Business rules:
    - Only source-accounted claims with an effective date, no unresolved conditions/targets and a non-reference effect contribute to applicable kinds.
    - Incomplete corpus review, draft claims, unknown dates, conflicts or unresolved conditions remain explicit; this projection is not a substantive legal interpretation.

    Execution flow:
    1. Validate the requested date and target node, then restore the durable review frontier.
    2. Load the claim graph and select effects that target the node or an allowed subtree.
    3. Mark each effect verified only when its owner has source accounting and classify its temporal state.
    4. Derive applicable verified kinds, completeness/conflict flags and a bounded paginated evidence response.

    Failure cases:
    - Invalid dates, nodes outside the pinned source or frontier restore failures return explicit failure responses; unresolved material facts keep the result incomplete.

    Side effects:
    - Restores durable frontier state and reads the claim graph; it does not mutate legal-effect claims or resolve legal ambiguities.
    """
    from .claim_inventory import utf16_slice
    try:
        date.fromisoformat(at_date)
    except ValueError:
        return {"outcome": "FAILED", "error": "INVALID_LEGAL_STATE_DATE"}
    source = context.source_graph
    node = source.nodes.get(node_id)
    if node is None:
        return {"outcome": "FAILED", "error": "NODE_NOT_IN_PINNED_SOURCE"}
    frontier = context.inventory.frontier
    if frontier:
        refused = frontier.restore(force=True)
        if refused:
            return frontier.failure(refused)
    graph = context.inventory.graph()
    effects, unresolved = [], []
    for claim in graph["claims"]:
        effect = (claim.get("semanticFrame") or {}).get("legalEffect")
        if not effect:
            continue
        unresolved.extend({"claimId": claim["claimId"], **target} for target in effect["unresolvedTargets"])
        targets = [t for t in effect["targets"] if t["nodeId"] == node_id or (
            t["scope"] == "SUBTREE" and source.nodes[t["nodeId"]]["documentId"] == node["documentId"]
            and node["structuralPath"].startswith(source.nodes[t["nodeId"]]["structuralPath"] + "/"))]
        if not targets:
            continue
        owner = (frontier.claim_owners.get(claim["claimId"]) if frontier else None) or (claim.get("sourceNodeIds") or [None])[0]
        if not owner:
            continue
        verified = owner in context.draft["sourceAccounting"]
        temporal = ("UNRESOLVED" if effect["effectiveFrom"] is None else
                    "FUTURE" if at_date < effect["effectiveFrom"] else
                    "ENDED" if effect["effectiveUntil"] and at_date >= effect["effectiveUntil"] else "APPLICABLE")
        effects.append({"claimId": claim["claimId"], "sourceNodeIds": claim["sourceNodeIds"], **effect,
            "verified": verified, "temporalState": temporal,
            "support": [{**s, "text": utf16_slice(source.nodes[s["nodeId"]]["content"], s["startOffset"], s["endOffset"])} for s in claim["sourceSupport"]]})
    applied = [e for e in effects if e["verified"] and e["temporalState"] == "APPLICABLE" and not e["conditions"] and not e["unresolvedTargets"] and e["kind"] != "REFERENCES"]
    kinds = sorted({e["kind"] for e in applied})
    incomplete = bool(unresolved or any(not e["verified"] or e["temporalState"] == "UNRESOLVED" or e["conditions"] for e in effects)
                      or not (frontier and frontier.snapshot.get("progress", {}).get("discoveryCompleteEligible")))
    return {"outcome": "PASSED", **source.base(), "nodeId": node_id, "structuralPath": node["structuralPath"], "atDate": at_date,
        "sourceRecordedStatus": node["legalEffectStatus"], "complete": not incomplete,
        "conflictingEffects": len(kinds) > 1,
        "applicableVerifiedKinds": kinds,
        "effects": effects[max(0, offset):max(0, offset) + min(20, max(1, limit))], "total": len(effects),
        "hasMore": max(0, offset) + min(20, max(1, limit)) < len(effects),
        "unresolvedTargets": unresolved[:20], "unresolvedTargetCount": len(unresolved),
        "guidance": "Original text is unchanged. Only applicable verified effects above affect this exact provision. Unknown dates, conditions, conflicts and incomplete corpus review require legal interpretation; sourceRecordedStatus is not a historical-date verdict."}
