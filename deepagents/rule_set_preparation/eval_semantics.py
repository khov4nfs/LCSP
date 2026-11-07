"""Offline semantic oracle for frozen Preparation model outputs.

This module grades model-produced typed claims and scope decisions AGAINST
independently reviewed gold labels. It never supplies or fabricates the labels,
calls a model or approves a production Rule Set.
"""
from __future__ import annotations

from typing import Any
from hashlib import sha256
import json

from rule_set_preparation.scope_review import review_claim_level_development_scope

NORMATIVE = frozenset({"DUTY", "PROHIBITION", "PERMISSION"})
CRITICAL = frozenset({
    "MISSING_NORMATIVE_CLAIM",
    "INVENTED_NORMATIVE_CLAIM",
    "CLAIM_ACTOR_ACTION_MISMATCH",
    "DEVELOPMENT_DUTY_OMITTED",
    "DEPLOYMENT_DUTY_LEAK",
    "MATERIAL_CONTEXT_MISSING",
    "UNRELATED_CONTEXT_LEAK",
    "MATERIAL_RELATION_MISSING",
    "MATERIAL_RELATION_LEAK",
    "CLAIM_PROJECTION_INVALID",
    "NORMATIVE_MODIFIER_MISMATCH",
    "MATERIAL_CLAIM_MISSING",
    "MATERIAL_CLAIM_MISMATCH",
    "NON_DEVELOPMENT_STAGE_MISSING",
    "NON_DEVELOPMENT_STAGE_LEAK",
    "UNRESOLVED_STAGE_MISSING",
    "UNRESOLVED_STAGE_LEAK",
})


def _operative_by_id(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Business purpose: Index relevant normative propositions for semantic scoring.

    Business rules:
    - Only relevant, legally normative DUTY/PROHIBITION/PERMISSION claims qualify.

    Execution flow:
    1. Select operative claims by trusted graph enums and map by claim ID.

    Failure cases:
    - Malformed input is rejected by the public evaluation function.

    Side effects:
    - Returns a new mapping, without modifying source or evaluation results.
    """
    return {
        c["claimId"]: c
        for c in graph.get("claims", [])
        if c.get("state") == "RELEVANT"
        and c.get("semanticAuthority") == "LEGAL_NORMATIVE"
        and c.get("claimType") in NORMATIVE
    }


def evaluate_preparation_semantics(
    gold: dict[str, Any], graph: dict[str, Any], decisions: list[dict[str, Any]]
) -> dict[str, Any]:
    """Business purpose: Score frozen model output against independently reviewed gold.

    Business rules:
    - Scores source-bound normative claims, actor/action identities, scope decisions,
      and material-context coverage without supplying answers to the model.
    - A zero-error result is not legal approval, live-model evidence or activation.

    Execution flow:
    1. Validate that gold and predicted graph share a source version.
    2. Compare expected versus predicted operative claim identities and frames.
    3. Run the read-only claim-level scope preview to detect scope/context leakage.
    4. Return exact error categories and explicit non-acceptance markers.

    Failure cases:
    - Bad gold contracts and source mismatches raise ValueError; failed previews
      remain explicit CLAIM_PROJECTION_INVALID observations.

    Side effects:
    - None. The scorer makes no provider or API calls and writes no source state.
    """
    if not isinstance(gold, dict) or not isinstance(graph, dict):
        raise ValueError("PREPARATION_EVAL_BAD_INPUT")
    if gold.get("schemaVersion") != "PREPARATION_SEMANTIC_GOLD_V1":
        raise ValueError("PREPARATION_EVAL_BAD_GOLD_VERSION")
    if gold.get("legalSourceVersionId") != graph.get("legalSourceVersionId"):
        raise ValueError("PREPARATION_EVAL_SOURCE_VERSION_MISMATCH")
    expected = gold.get("normativeClaims")
    if not isinstance(expected, list):
        raise ValueError("PREPARATION_EVAL_GOLD_CLAIMS_REQUIRED")
    errors = []
    actual_claims = _operative_by_id(graph)
    expected_claims = {row["claimId"]: row for row in expected}
    if len(expected_claims) != len(expected):
        raise ValueError("PREPARATION_EVAL_DUPLICATE_GOLD_CLAIM")
    for cid in sorted(set(expected_claims) - set(actual_claims)):
        errors.append({"code": "MISSING_NORMATIVE_CLAIM", "claimId": cid})
    for cid in sorted(set(actual_claims) - set(expected_claims)):
        errors.append({"code": "INVENTED_NORMATIVE_CLAIM", "claimId": cid})
    for cid in sorted(set(actual_claims) & set(expected_claims)):
        row = expected_claims[cid]
        actual = actual_claims[cid]
        frame = actual.get("operative") or {}
        signature = {
            "actor": frame.get("actor"),
            "modality": frame.get("modality"),
            "action": frame.get("action"),
            "claimType": actual.get("claimType"),
            "sourceNodeIds": actual.get("sourceNodeIds"),
        }
        wanted = {key: row.get(key) for key in signature}
        if signature != wanted:
            errors.append({"code": "CLAIM_ACTOR_ACTION_MISMATCH", "claimId": cid})
        # Actor/action agreement alone cannot prove unchanged source modifiers.
        if "frame" in row and actual.get("frame") != row["frame"]:
            errors.append({"code": "NORMATIVE_MODIFIER_MISMATCH", "claimId": cid})

    context_expected = gold.get("contextClaims", [])
    if not isinstance(context_expected, list) or any(
        not isinstance(row, dict) or not isinstance(row.get("claimId"), str)
        for row in context_expected
    ):
        raise ValueError("PREPARATION_EVAL_BAD_CONTEXT_GOLD")
    if len({row["claimId"] for row in context_expected}) != len(context_expected):
        raise ValueError("PREPARATION_EVAL_DUPLICATE_CONTEXT_GOLD")
    graph_claims = {
        claim["claimId"]: claim for claim in graph.get("claims", [])
        if isinstance(claim, dict) and isinstance(claim.get("claimId"), str)
    }
    for row in context_expected:
        cid = row["claimId"]
        actual = graph_claims.get(cid)
        if actual is None or actual.get("state") != "RELEVANT":
            errors.append({"code": "MATERIAL_CLAIM_MISSING", "claimId": cid})
            continue
        # Compare reviewed typed meaning, never language-dependent prose.
        checked = ("claimType", "sourceNodeIds", "legalSourceVersionId", "semanticAuthority", "frame")
        if any(actual.get(key) != row[key] for key in checked if key in row):
            errors.append({"code": "MATERIAL_CLAIM_MISMATCH", "claimId": cid})

    preview = None
    try:
        preview = review_claim_level_development_scope(graph, decisions)
    except (ValueError, KeyError, TypeError) as exc:
        errors.append({"code": "CLAIM_PROJECTION_INVALID", "reason": str(exc)[:160]})
    if preview is not None:
        for expected_key, actual_key, missing_code, extra_code in [
            ("developmentClaimIds", "developmentClaimIds", "DEVELOPMENT_DUTY_OMITTED", "DEPLOYMENT_DUTY_LEAK"),
            ("materialContextClaimIds", "materialContextClaimIds", "MATERIAL_CONTEXT_MISSING", "UNRELATED_CONTEXT_LEAK"),
        ]:
            required = set(gold.get(expected_key, []))
            observed = set(preview[actual_key])
            for cid in sorted(required - observed):
                errors.append({"code": missing_code, "claimId": cid})
            for cid in sorted(observed - required):
                errors.append({"code": extra_code, "claimId": cid})

        for expected_key, missing_code, extra_code in (
            ("nonDevelopmentClaimIds", "NON_DEVELOPMENT_STAGE_MISSING", "NON_DEVELOPMENT_STAGE_LEAK"),
            ("unresolvedClaimIds", "UNRESOLVED_STAGE_MISSING", "UNRESOLVED_STAGE_LEAK"),
        ):
            if expected_key not in gold:
                continue
            required = set(gold[expected_key])
            observed = set(preview[expected_key])
            for cid in sorted(required - observed):
                errors.append({"code": missing_code, "claimId": cid})
            for cid in sorted(observed - required):
                errors.append({"code": extra_code, "claimId": cid})

    if preview is not None and "materialRelationIds" in gold and "materialRelations" not in gold:
        required_relations = set(gold["materialRelationIds"])
        observed_relations = set(preview["materialRelationIds"])
        for rid in sorted(required_relations - observed_relations):
            errors.append({"code": "MATERIAL_RELATION_MISSING", "relationId": rid})
        for rid in sorted(observed_relations - required_relations):
            errors.append({"code": "MATERIAL_RELATION_LEAK", "relationId": rid})

    if preview is not None and "materialRelations" in gold:
        observed_edges = {
            (edge["kind"], edge["fromClaimId"], edge["toClaimId"])
            for edge in graph.get("relations", [])
            if edge.get("relationId") in preview["materialRelationIds"]
        }
        expected_edges = {
            (edge["kind"], edge["fromClaimId"], edge["toClaimId"])
            for edge in gold["materialRelations"]
        }
        for kind, origin, target in sorted(expected_edges - observed_edges):
            errors.append({"code": "MATERIAL_RELATION_MISSING", "relation": [kind, origin, target]})
        for kind, origin, target in sorted(observed_edges - expected_edges):
            errors.append({"code": "MATERIAL_RELATION_LEAK", "relation": [kind, origin, target]})

    counts = {code: sum(x["code"] == code for x in errors) for code in sorted(CRITICAL)}
    return {
        "schemaVersion": "PREPARATION_SEMANTIC_EVAL_RESULT_V1",
        "legalSourceVersionId": gold["legalSourceVersionId"],
        "goldApprovalStatus": gold.get("goldApprovalStatus", "NOT_APPROVED"),
        "scope": "GOLD_COMPARISON_ONLY_NO_MODEL_INVOCATION",
        "expectedNormativeClaims": len(expected),
        "observedNormativeClaims": len(actual_claims),
        "criticalErrorCounts": counts,
        "errors": errors,
        "fixtureMatched": not errors,
        "productionAcceptance": "NOT_PROVEN",
        "liveModelAcceptance": "NOT_RUN",
    }



def canonical_preparation_signature(
    graph: dict[str, Any], decisions: list[dict[str, Any]]
) -> str:
    """Business purpose: Fingerprint claim-level legal semantics across locales.

    Business rules:
    - Hash typed claim content, including material frame qualifiers and stage decisions.
    - Free-form translated frame text may require human alignment before parity;
      lexical equality is conservative and never proves legal equivalence.

    Execution flow:
    1. Normalize operative claims, material modifier frames and decision stages.
    2. Hash a stable sorted canonical representation of the source-bound fields.

    Failure cases:
    - Invalid claim/decision fields raise rather than invent defaults.

    Side effects:
    - None; this compares frozen outputs and exposes no source text.
    """
    rows = []
    by_id = {d["claimId"]: d for d in decisions}
    for claim in graph["claims"]:
        if claim.get("state") != "RELEVANT" or claim.get("claimType") not in NORMATIVE:
            continue
        frame = claim.get("operative") or {}
        if claim["claimId"] not in by_id:
            raise ValueError("PREPARATION_PARITY_MISSING_DECISION")
        rows.append({
            "sourceNodeIds": sorted(claim["sourceNodeIds"]),
            "claimType": claim["claimType"],
            "actor": frame["actor"],
            "action": frame["action"],
            "modality": frame["modality"],
            "frame": claim.get("frame") or {},
            "stage": by_id[claim["claimId"]]["stage"],
        })
    # Context relations are semantic, too. Two locales must not be declared
    # equivalent when one silently drops a material condition or exception.
    by_id = {c["claimId"]: c for c in graph["claims"]}
    def endpoint(cid):
        """Business purpose:
        Canonicalize the two sides of one legal context relation.

        Business rules:
        - Identity comes only from typed, source-pinned claim content.

        Execution flow:
        1. Resolve the claim ID and return its stable operative signature.

        Failure cases:
        - Missing claim or operative fields are not guessed.

        Side effects:
        - Pure normalization for cross-locale comparison."""
        claim = by_id[cid]
        frame = claim.get("operative") or {}
        return {
            "sourceNodeIds": sorted(claim["sourceNodeIds"]),
            "claimType": claim["claimType"],
            "actor": frame.get("actor"),
            "modality": frame.get("modality"),
            "action": frame.get("action"),
            "frame": claim.get("frame") or {},
            "semanticAuthority": claim.get("semanticAuthority"),
        }
    context_edges = sorted([
        {
            "kind": r["kind"],
            "from": endpoint(r["fromClaimId"]),
            "to": endpoint(r["toClaimId"]),
        }
        for r in graph.get("relations", [])
    ], key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False))
    payload = json.dumps(
        {
            "propositions": sorted(rows, key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False)),
            "contextEdges": context_edges,
        },
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    )
    return sha256(payload.encode("utf-8")).hexdigest()


def compare_preparation_locale_parity(
    en_graph: dict[str, Any], en_decisions: list[dict[str, Any]],
    vi_graph: dict[str, Any], vi_decisions: list[dict[str, Any]]
) -> dict[str, Any]:
    """Business purpose: Compare EN/VI claim semantics without conflating phrasing.

    Business rules:
    - Both runs must use one pinned legal source version.
    - Identical hashes show canonical fact agreement, not legal correctness.

    Execution flow:
    1. Validate the source-version binding on both frozen outputs.
    2. Hash each locale's typed operative propositions and stage decisions.
    3. Return parity status with explicit unproven live acceptance.

    Failure cases:
    - Missing/mismatched sources or decisions fail closed.

    Side effects:
    - None; this does not call providers or store decisions.
    """
    if en_graph.get("legalSourceVersionId") != vi_graph.get("legalSourceVersionId"):
        raise ValueError("PREPARATION_PARITY_SOURCE_MISMATCH")
    # Parity must not declare two equally malformed decision packets equivalent.
    review_claim_level_development_scope(en_graph, en_decisions)
    review_claim_level_development_scope(vi_graph, vi_decisions)
    en_sig = canonical_preparation_signature(en_graph, en_decisions)
    vi_sig = canonical_preparation_signature(vi_graph, vi_decisions)
    return {
        "parity": "MATCH" if en_sig == vi_sig else "MISMATCH",
        "enSignature": en_sig,
        "viSignature": vi_sig,
        "legalSourceVersionId": en_graph["legalSourceVersionId"],
        "semanticTruth": "NOT_ESTABLISHED_BY_PARITY",
        "liveModelAcceptance": "NOT_RUN",
    }
