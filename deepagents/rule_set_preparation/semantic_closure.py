"""Projection of verified typed edges, not a source-law interpreter. Mirrors the API gate."""
from rule_set_preparation.semantic_audit import digest

INWARD = {"CONDITION_OF", "QUALIFIES", "EXCEPTION_TO", "TEMPORALLY_APPLIES_TO", "EVIDENCE_SLICE_OF", "PRESERVES", "CONTEXT_FOR"}


def operative(claim):
    return bool(claim and claim["state"] == "RELEVANT" and claim.get("semanticAuthority") == "LEGAL_NORMATIVE" and claim["claimType"] in {"DUTY", "PROHIBITION", "PERMISSION"})


def claim_role(claim):
    from rule_set_preparation.claim_inventory import CLAIM_ROLES
    if claim.get("semanticAuthority") in {"ASSESSMENT_GUIDANCE", "EVIDENCE_GUIDANCE", "CONTEXT"}:
        return "CONTEXT"
    return CLAIM_ROLES[claim["claimType"]]


def semantic_closure(graph, anchor_id):
    claims = {c["claimId"]: c for c in graph["claims"]}
    if not operative(claims.get(anchor_id)):
        raise ValueError("Verified legal normative operative anchor required")
    roles, queue = {anchor_id: "OPERATIVE_PROPOSITION"}, [anchor_id]
    while queue:
        cid = queue.pop(0)
        for relation in graph["relations"]:
            incoming = relation["toClaimId"] == cid and relation["kind"] in INWARD
            outgoing = relation["fromClaimId"] == cid and relation["kind"] in {"DEFINED_BY", "INCORPORATES", "CROSS_REFERENCE"}
            if not incoming and not outgoing:
                continue
            target = relation["fromClaimId"] if incoming else relation["toClaimId"]
            claim = claims.get(target)
            if not claim or claim["state"] != "RELEVANT" or operative(claim):
                continue
            role = "CONTEXT" if relation["kind"] in {"PRESERVES", "EVIDENCE_SLICE_OF", "CONTEXT_FOR"} or relation["kind"] == "CONDITION_OF" and not operative(claims.get(cid)) else claim_role(claim)
            if target in roles:
                if roles[target] == role or role == "CONTEXT":
                    continue
                if roles[target] != "CONTEXT":
                    raise ValueError("CONFLICTING_CLOSURE_ROLE:" + target)
                roles[target] = role
                continue
            roles[target] = role
            queue.append(target)
    dependencies = sorted([r for r in graph["relations"] if r["fromClaimId"] in roles and r["toClaimId"] != anchor_id and operative(claims.get(r["toClaimId"])) and r["kind"] in {"INCORPORATES", "CROSS_REFERENCE", "PRESERVES"}], key=lambda r:r["relationId"])
    return {"anchorId": anchor_id, "claims": [{"claimId": cid, "role": role} for cid, role in sorted(roles.items())], "relationIds": sorted(r["relationId"] for r in graph["relations"] if r["fromClaimId"] in roles and r["toClaimId"] in roles), "referenceDependencies": dependencies}


def aggregate_closure(graph, anchor_ids):
    claims = {c["claimId"]: c for c in graph["claims"]}
    closures = [semantic_closure(graph, cid) for cid in anchor_ids]
    def profile(closure):
        anchor = claims[closure["anchorId"]]
        return digest({"actor": anchor["operative"]["actor"], "modality": anchor["operative"]["modality"], "assessability": anchor["assessability"], "modifiers": [c for c in closure["claims"] if c["role"] in {"APPLICABILITY_CONDITION", "QUALIFIER", "EXCEPTION"}]})
    if not closures or len({profile(c) for c in closures}) != 1:
        raise ValueError("INCOMPATIBLE_OPERATIVE_AGGREGATION")
    roles = {}
    for closure in closures:
        for row in closure["claims"]:
            if row["claimId"] in roles and roles[row["claimId"]] != row["role"]:
                raise ValueError("INCOMPATIBLE_OPERATIVE_AGGREGATION")
            roles[row["claimId"]] = row["role"]
    dependencies = {r["relationId"]: r for c in closures for r in c["referenceDependencies"]}
    return {"anchorIds": sorted(anchor_ids), "claims": [{"claimId": cid, "role": role} for cid, role in sorted(roles.items())], "relationIds": sorted({rid for c in closures for rid in c["relationIds"]}), "referenceDependencies": [dependencies[k] for k in sorted(dependencies)]}
