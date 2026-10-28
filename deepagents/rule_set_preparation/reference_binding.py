"""Structural binding preflight and accounting projection; no legal interpretation.

The authoritative API rule is semantic-reference-binding.ts. Both runtimes are
checked against the retained fixture and the same direction/subtree matrix.
"""
from __future__ import annotations

from rule_set_preparation.claim_inventory import RELATION_KINDS


def endpoint_fingerprint(claim):
    """Business purpose: Fingerprint a claim's identity and endpoint facts for later reference-dependency validation.

    Business rules:
    - Statement, actor and action normalize to Unicode NFC with collapsed whitespace; source version, type, state, support and semantic authority remain part of identity when present.

    Execution flow:
    1. Normalize textual identity fields.
    2. Build the stable claim projection, including operative fields and optional source/evidence metadata.
    3. Return the canonical fingerprint.

    Failure cases:
    - Missing required claim/operative fields surface as malformed claim state.

    Side effects:
    - None: computes identity without changing claim data.
    """
    import unicodedata
    from rule_set_preparation.claim_inventory import fingerprint
    def text(value):
        """Business purpose: Normalize a textual endpoint fact before reference dependency fingerprinting.

        Business rules:
        - Unicode is normalized to NFC and all whitespace runs collapse to a single space.

        Execution flow:
        1. Normalize Unicode form.
        2. Collapse surrounding and repeated whitespace.
        3. Return the normalized text.

        Failure cases:
        - Non-string endpoint fields fail visibly as invalid claim data.

        Side effects:
        - None: pure text normalization.
        """
        return " ".join(unicodedata.normalize("NFC", value).split())
    operative = claim["operative"]
    return fingerprint({"claimId": claim["claimId"], "legalSourceVersionId": claim["legalSourceVersionId"],
        "claimType": claim["claimType"], "statement": text(claim["statement"]),
        "operative": {"actor": text(operative["actor"]), "modality": operative["modality"], "action": text(operative["action"])} if operative else None,
        "sourceNodeIds": sorted(claim["sourceNodeIds"]), "state": claim["state"],
        **({k: claim.get(k) for k in ("sourceSupport", "semanticFrame", "semanticAuthority", "assessability")} if "sourceSupport" in claim else {}),
        "nonOperativeReason": text(claim["nonOperativeReason"]) if claim["nonOperativeReason"] is not None else None})


def within(source, node_id, ancestor_id):
    """Business purpose: Test whether a pinned source node is the same as or a structural descendant of an ancestor node.

    Business rules:
    - Both nodes must belong to this exact LegalSourceVersion and document; path-prefix matches require a structural separator.

    Execution flow:
    1. Resolve both node records.
    2. Check pinned version, document identity and equal/descendant structural path.
    3. Return a boolean result.

    Failure cases:
    - Missing nodes, different versions or documents return false.

    Side effects:
    - None: checks graph identity only.
    """
    node, ancestor = source.nodes.get(node_id), source.nodes.get(ancestor_id)
    return bool(node and ancestor and node["legalSourceVersionId"] == ancestor["legalSourceVersionId"] == source.version
                and node["documentId"] == ancestor["documentId"]
                and (node_id == ancestor_id or node["structuralPath"].startswith(ancestor["structuralPath"] + "/")))


def side_claims(source, claims, node_id):
    """Business purpose: List claims whose pinned source support falls within a selected source-node subtree.

    Business rules:
    - Claims must use the active source version and have at least one source node within the requested branch; results sort by claim ID.

    Execution flow:
    1. Filter claims by source version and structural containment.
    2. Sort the matching claim records by stable ID.
    3. Return the list.

    Failure cases:
        - A source branch absent from the pinned graph produces no matches; malformed claims fail through structural lookup rather than being accepted.

    Side effects:
    - None: derives a read-only claim view.
    """
    return sorted((c for c in claims.values() if c["legalSourceVersionId"] == source.version
                   and any(within(source, n, node_id) for n in c["sourceNodeIds"])), key=lambda c: c["claimId"])


def valid_binding(source, claims, relation):
    """Business purpose: Check that a typed claim relation is structurally supported by its exact pinned legal reference.

    Business rules:
    - The reference must be resolved in the same source version/materialization; endpoints must be distinct claims of that version, each with at least one supporting source node at or below the respective FROM/TO node.
    - The relation kind must be a declared kind; this gate checks provenance/direction, not legal meaning.

    Execution flow:
    1. Resolve the reference and claim endpoints.
    2. Verify version, materialization, resolution, target and relation kind.
    3. Verify distinct endpoints and structural support at both ends.
    4. Return whether every condition holds.

    Failure cases:
    - Missing, unresolved, stale, mismatched or structurally unsupported bindings return false.

    Side effects:
    - None: deterministic provenance check.
    """
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
    """Material rows are derived; only explicit non-material reasons survive alone.

    Business purpose: Rebuild reference accounting from current explicit non-material decisions and structurally valid claim relations.

    Business rules:
    - Non-material decisions survive only with a reason and no relation. Empty material placeholders remain provisional; material relation IDs are derived from valid bindings rather than accepted independently.

    Execution flow:
    1. Retain valid explicit non-material rows and empty material placeholders from the current draft.
    2. Add each material reference supported by a valid typed relation.
    3. Deduplicate/sort relation IDs, mark inventory change and replace the draft projection.
    4. Return the derived accounting.

    Failure cases:
    - Invalid or foreign relations are excluded; inventory change failures propagate rather than preserving a stale projection.

    Side effects:
    - Calls `inventory.changed` and replaces `draft["referenceAccounting"]` in the run context; it does not interpret whether a legal reference is material.
    """
    source, draft = context.source_graph, context.draft
    result = {rid: row for rid, row in draft["referenceAccounting"].items()
              if rid in source.references and (
                  (not row["material"] and row["nonMaterialReason"] and not row["relationIds"]) or
                  (row["material"] and not row["relationIds"] and not row["nonMaterialReason"])
              )}
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
