"""Read-only, non-activatable claim-level preparation scope review.

This inspects already-pinned typed semantic claims. It does not infer actor/stage
from raw legal language, grant human approval or replace the API Completion Gate.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

OPERATIVE = frozenset({"DUTY", "PROHIBITION", "PERMISSION"})
STAGES = frozenset({"DEVELOPMENT", "NON_DEVELOPMENT", "LEGAL_REVIEW_REQUIRED"})
MATERIAL_INBOUND = frozenset({
    "CONDITION_OF", "QUALIFIES", "EXCEPTION_TO", "TEMPORALLY_APPLIES_TO",
    "PRESERVES", "CONTEXT_FOR", "EVIDENCE_SLICE_OF",
})
MATERIAL_OUTBOUND = frozenset({"DEFINED_BY", "INCORPORATES", "CROSS_REFERENCE"})


def review_claim_level_development_scope(
    graph: dict[str, Any], decisions: list[dict[str, Any]]
) -> dict[str, Any]:
    """Business purpose: Review actor-separated operative claims and context closure.

    Business rules:
    - Decisions bind 1:1 to operative claims and their pinned source identities.
    - Multiple actors at one source unit require separate operative claims.
    - Context survives only via a real directed material relation, never proximity.
    - The output is review-only; approval and activation stay with the server.

    Execution flow:
    1. Validate pinned claim and decision identities against the semantic graph.
    2. Account for every operative claim and distinguish development/other/unknown.
    3. Traverse only declared material-context edges toward selected duties.
    4. Return source IDs and claim IDs without raw deploy-only source passages.

    Failure cases:
    - Missing/duplicate claims, altered actors, wrong source IDs, and invalid
      decisions fail closed; unlinked context never reaches the output.

    Side effects:
    - None; the function neither modifies claims nor authorizes publication.
    """
    if not isinstance(graph, dict) or not isinstance(decisions, list):
        raise ValueError("SCOPE_REVIEW_INVALID_INPUT")
    version = graph.get("legalSourceVersionId")
    if not isinstance(version, str) or not version:
        raise ValueError("SCOPE_REVIEW_SOURCE_NOT_PINNED")
    claims_raw = graph.get("claims")
    relations_raw = graph.get("relations")
    if not isinstance(claims_raw, list) or not isinstance(relations_raw, list):
        raise ValueError("SCOPE_REVIEW_GRAPH_MISSING")

    claims = {}
    for claim in claims_raw:
        if not isinstance(claim, dict) or not isinstance(claim.get("claimId"), str):
            raise ValueError("SCOPE_REVIEW_CLAIM_INVALID")
        if claim["claimId"] in claims:
            raise ValueError("SCOPE_REVIEW_DUPLICATE_CLAIM_ID")
        claims[claim["claimId"]] = claim

    operative = {
        cid: claim for cid, claim in claims.items()
        if claim.get("state") == "RELEVANT"
        and claim.get("semanticAuthority") == "LEGAL_NORMATIVE"
        and claim.get("claimType") in OPERATIVE
    }
    by_source_and_proposition = set()
    for cid, claim in operative.items():
        frame = claim.get("operative")
        nodes = claim.get("sourceNodeIds")
        if (not isinstance(frame, dict)
                or any(not isinstance(frame.get(k), str) or not frame[k].strip()
                       for k in ("actor", "modality", "action"))
                or not isinstance(nodes, list) or not nodes
                or claim.get("legalSourceVersionId") != version):
            raise ValueError("SCOPE_REVIEW_NONATOMIC_OR_UNPINNED_CLAIM:" + cid)
        signature = (tuple(sorted(nodes)), frame["actor"].strip(),
                     frame["modality"].strip(), frame["action"].strip())
        if signature in by_source_and_proposition:
            raise ValueError("SCOPE_REVIEW_DUPLICATE_OPERATIVE_PROPOSITION:" + cid)
        by_source_and_proposition.add(signature)

    bound = {}
    for decision in decisions:
        if not isinstance(decision, dict):
            raise ValueError("SCOPE_REVIEW_DECISION_INVALID")
        cid = decision.get("claimId")
        if cid not in operative or cid in bound:
            raise ValueError("SCOPE_REVIEW_UNKNOWN_OR_DUPLICATE_DECISION")
        claim = operative[cid]
        frame = claim["operative"]
        if (decision.get("legalSourceVersionId") != version
                or decision.get("sourceNodeIds") != claim["sourceNodeIds"]
                or decision.get("actor") != frame["actor"]
                or decision.get("modality") != frame["modality"]
                or decision.get("action") != frame["action"]
                or decision.get("stage") not in STAGES):
            raise ValueError("SCOPE_REVIEW_DECISION_PROVENANCE_OR_ACTOR_MISMATCH:" + cid)
        # Permission may be shown in legal-source accounting, but cannot be
        # published as a mandatory development Assessment Rule.
        if decision["stage"] == "DEVELOPMENT" and claim["claimType"] == "PERMISSION":
            raise ValueError("SCOPE_REVIEW_PERMISSION_AS_MANDATORY_RULE:" + cid)
        bound[cid] = decision
    missing = sorted(set(operative) - set(bound))
    if missing:
        raise ValueError("SCOPE_REVIEW_MISSING_OPERATIVE_DECISIONS:" + ",".join(missing))

    included = {cid for cid, row in bound.items() if row["stage"] == "DEVELOPMENT"}
    material_ids = set()
    relation_ids = set()
    queue = list(sorted(included))
    seen = set(queue)
    # The source graph was pinned by Preparation; only actual directed edges
    # can establish context dependency. No arbitrary manual links.
    while queue:
        anchor = queue.pop(0)
        for rel in relations_raw:
            kind = rel.get("kind")
            inbound = rel.get("toClaimId") == anchor and kind in MATERIAL_INBOUND
            outbound = rel.get("fromClaimId") == anchor and kind in MATERIAL_OUTBOUND
            if not inbound and not outbound:
                continue
            target_id = rel["fromClaimId"] if inbound else rel["toClaimId"]
            target = claims.get(target_id)
            if not target or target.get("state") != "RELEVANT":
                raise ValueError("SCOPE_REVIEW_DANGLING_MATERIAL_EDGE")
            if target_id in operative:
                # An independently regulated deployment duty is not an
                # admissible context substitute; split out its modifier.
                continue
            # Context can qualify a development duty only when it is
            # independently traceable to the SAME pinned legal source.
            # A valid relation alone is not provenance.
            nodes = target.get("sourceNodeIds")
            if (target.get("legalSourceVersionId") != version
                    or not isinstance(nodes, list) or not nodes
                    or any(not isinstance(node, str) or not node.strip()
                           for node in nodes)):
                raise ValueError("SCOPE_REVIEW_UNPINNED_MATERIAL_CONTEXT:" + target_id)
            if not isinstance(rel.get("relationId"), str) or not rel["relationId"]:
                raise ValueError("SCOPE_REVIEW_RELATION_ID_MISSING")
            relation_ids.add(rel["relationId"])
            material_ids.add(target_id)
            if target_id not in seen:
                seen.add(target_id)
                queue.append(target_id)

    return {
        "status": "REVIEW_ONLY_NOT_ACTIVATABLE",
        "legalSourceVersionId": version,
        "sourceOperativeClaimsAccounted": len(operative),
        "developmentClaimIds": sorted(included),
        "nonDevelopmentClaimIds": sorted(
            cid for cid, d in bound.items() if d["stage"] == "NON_DEVELOPMENT"
        ),
        "unresolvedClaimIds": sorted(
            cid for cid, d in bound.items() if d["stage"] == "LEGAL_REVIEW_REQUIRED"
        ),
        "materialContextClaimIds": sorted(material_ids),
        "materialRelationIds": sorted(relation_ids),
        "needsServerScopeValidator": True,
        "needsLegalHumanApproval": True,
        "activationEligible": False,
    }
