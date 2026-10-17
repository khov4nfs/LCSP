"""Structural binding preflight and accounting projection; no legal interpretation.

The authoritative API rule is semantic-reference-binding.ts. Both runtimes are
checked against the retained fixture and the same direction/subtree matrix.
"""
from __future__ import annotations

from rule_set_preparation.claim_inventory import RELATION_KINDS


def within(source, node_id, ancestor_id):
    node, ancestor = source.nodes.get(node_id), source.nodes.get(ancestor_id)
    return bool(node and ancestor and node["legalSourceVersionId"] == ancestor["legalSourceVersionId"] == source.version
                and node["documentId"] == ancestor["documentId"]
                and (node_id == ancestor_id or node["structuralPath"].startswith(ancestor["structuralPath"] + "/")))


def side_claims(source, claims, node_id):
    return sorted((c for c in claims.values() if c["legalSourceVersionId"] == source.version
                   and any(within(source, n, node_id) for n in c["sourceNodeIds"])), key=lambda c: c["claimId"])


def valid_binding(source, claims, relation):
    ref = source.references.get(relation.get("referenceId"))
    origin, target = claims.get(relation["fromClaimId"]), claims.get(relation["toClaimId"])
    return bool(ref and ref.get("legalSourceVersionId", source.version) == source.version
                and ref.get("materializationId", source.graph["materializationId"]) == source.graph["materializationId"]
                and ref["resolutionState"] == "RESOLVED" and ref["toNodeId"]
                and relation["kind"] in RELATION_KINDS and origin and target
                and origin["claimId"] != target["claimId"]
                and origin["legalSourceVersionId"] == target["legalSourceVersionId"] == source.version
                and any(within(source, n, ref["fromNodeId"]) for n in origin["sourceNodeIds"])
                and any(within(source, n, ref["toNodeId"]) for n in target["sourceNodeIds"]))


def project_reference_accounting(context):
    """Material rows are derived; only explicit non-material reasons survive alone."""
    source, draft = context.source_graph, context.draft
    result = {rid: row for rid, row in draft["referenceAccounting"].items()
              if rid in source.references and not row["material"] and row["nonMaterialReason"] and not row["relationIds"]}
    for relation in draft["claimRelations"].values():
        if relation.get("referenceId") and valid_binding(source, draft["semanticClaims"], relation):
            rid = relation["referenceId"]
            row = result.get(rid)
            if not row or not row["material"]:
                row = result[rid] = {"referenceId": rid, "material": True, "relationIds": [], "nonMaterialReason": None}
            row["relationIds"].append(relation["relationId"])
    for row in result.values():
        row["relationIds"] = sorted(set(row["relationIds"]))
    context.inventory.changed(draft["referenceAccounting"], result)
    draft["referenceAccounting"] = result
    return result
