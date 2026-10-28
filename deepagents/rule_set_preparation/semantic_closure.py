"""Projection of verified typed edges, not a source-law interpreter. Mirrors the API gate."""
from rule_set_preparation.claim_inventory import fingerprint

INWARD = {"CONDITION_OF", "QUALIFIES", "EXCEPTION_TO", "TEMPORALLY_APPLIES_TO", "EVIDENCE_SLICE_OF", "PRESERVES", "CONTEXT_FOR"}


def operative(claim):
    """Business purpose: Identify a relevant committed claim that can anchor a legal Requirement.

    Business rules:
    - An anchor must be RELEVANT, carry LEGAL_NORMATIVE authority and have a DUTY, PROHIBITION or PERMISSION type.

    Execution flow:
    1. Check claim presence and state.
    2. Check semantic authority and operative claim type.
    3. Return the eligibility result.

    Failure cases:
    - Missing, non-operative, non-normative or non-relevant claims return false.

    Side effects:
    - None: deterministic claim classification only.
    """
    return bool(claim and claim["state"] == "RELEVANT" and claim.get("semanticAuthority") == "LEGAL_NORMATIVE" and claim["claimType"] in {"DUTY", "PROHIBITION", "PERMISSION"})


def claim_role(claim):
    """Business purpose: Map one semantic claim to its fixed Rule Authoring accounting role.

    Business rules:
    - Assessment guidance, evidence guidance and context authority map to CONTEXT; other claim types use the canonical CLAIM_ROLES mapping.

    Execution flow:
    1. Check semantic authority for context-only categories.
    2. Otherwise read the canonical role for the claim type.
    3. Return the role.

    Failure cases:
        - An unrecognized claim type fails through the canonical mapping rather than receiving a guessed role.

    Side effects:
    - None: pure role projection.
    """
    from rule_set_preparation.claim_inventory import CLAIM_ROLES
    if claim.get("semanticAuthority") in {"ASSESSMENT_GUIDANCE", "EVIDENCE_GUIDANCE", "CONTEXT"}:
        return "CONTEXT"
    return CLAIM_ROLES[claim["claimType"]]


def semantic_closure(graph, anchor_id):
    """Business purpose: Project the typed claim neighborhood that is structurally connected to one committed operative legal anchor.

    Business rules:
    - The anchor must pass the operative-claim gate; only declared inward/outward relation kinds contribute, and a conflicting role mapping is rejected.
    - Closure follows existing validated edges and reports reference dependencies; it does not infer legal relationships from text.

    Execution flow:
    1. Index claims and require the requested relevant normative operative anchor.
    2. Traverse typed incoming modifiers/context and outgoing definition/incorporation/reference edges.
    3. Assign fixed roles, reject incompatible role collisions and collect dependency relations.
    4. Return sorted claim, relation and reference-dependency IDs.

    Failure cases:
    - A non-operative anchor raises ValueError; conflicting closure roles raise a distinct ValueError.

    Side effects:
    - None: computes a graph projection without changing claims or relations.
    """
    claims = {c["claimId"]: c for c in graph["claims"]}
    if not operative(claims.get(anchor_id)):
        raise ValueError("Committed legal normative operative anchor required")
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
    """Business purpose: Combine compatible operative anchors into one Requirement claim closure.

    Business rules:
    - At least one anchor is required; actor, modality, assessability and modifier profiles must match, and shared claim roles must agree.

    Execution flow:
    1. Compute the verified semantic closure for each anchor.
    2. Compare profiles and merge claim roles, relation IDs and reference dependencies.
    3. Return the deterministic aggregate projection.

    Failure cases:
    - Empty input, incompatible legal profiles or conflicting roles raise INCOMPATIBLE_OPERATIVE_AGGREGATION.

    Side effects:
    - None: combines graph projections only.
    """
    claims = {c["claimId"]: c for c in graph["claims"]}
    closures = [semantic_closure(graph, cid) for cid in anchor_ids]
    def profile(closure):
        """Business purpose: Produce the compatibility profile used to decide whether operative anchors may share one Requirement.

        Business rules:
        - Compatibility is defined by the anchor's actor, modality and assessability plus its verified applicability-condition, qualifier and exception claims.

        Execution flow:
        1. Resolve the closure's operative anchor.
        2. Build the normalized profile from its legal attributes and modifier claims.
        3. Return the profile for equality comparison.

        Failure cases:
        - Missing anchors or required operative fields raise through ordinary mapping access; no default compatibility is assumed.

        Side effects:
        - None: creates an in-memory comparison value.
        """
        anchor = claims[closure["anchorId"]]
        return fingerprint({"actor": anchor["operative"]["actor"], "modality": anchor["operative"]["modality"], "assessability": anchor["assessability"], "modifiers": [c for c in closure["claims"] if c["role"] in {"APPLICABILITY_CONDITION", "QUALIFIER", "EXCEPTION"}]})
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
