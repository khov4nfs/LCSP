"""XTRAREG (IEEE RE 2025) atomic obligation, chain, and holdout scorer for Rule Set Preparation.

Evaluates the semantic chain:
    semanticClaims -> LegalRequirements -> AssessmentRules
across both FULL_PREPARATION (discovery + authoring) and DIRECT_DRAFT modes
against an independently reviewed gold annotation set (>= 30 obligations).
"""

from __future__ import annotations

import re
from types import SimpleNamespace
from typing import Any

from rule_set_preparation.claim_inventory import (
    ROLE_FIELDS,
    canonical_support,
    utf16_slice,
)
from rule_set_preparation.semantic_closure import operative, semantic_closure

XTRAREG_GOLD_SCHEMA = "XTRAREG_PREPARATION_GOLD_V1"
XTRAREG_SOURCE_SCHEMA = "XTRAREG_PINNED_LEGAL_SOURCE_V1"
CRITICAL_ERROR_CODES = frozenset({
    "ACTION_REVIEW_REQUIRED",
    "CITATION_REVIEW_REQUIRED",
    "DUPLICATE_PREDICTION",
    "UNGROUNDED_OBLIGATION",
    "MISSING_EXCEPTION",
    "MODALITY_INVERSION",
    "MISSING_OBLIGATION",
})
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _norm_text(value: Any) -> str:
    """Business purpose: Normalize free text for deterministic token and substring comparisons.

    Business rules:
    - Lowercases and collapses whitespace without altering semantic tokens or inventing content.

    Execution flow:
    1. Coerce non-string inputs safely to an empty string.
    2. Lowercase and normalize whitespace.

    Failure cases:
    - None or non-string values return an empty string.

    Side effects:
    - None: pure string normalization.
    """
    if not isinstance(value, str):
        return ""
    return " ".join(value.lower().split())


def _token_jaccard(left: str, right: str) -> float:
    """Business purpose: Measure lexical overlap between expected and predicted obligation text.

    Business rules:
    - Uses token-set Jaccard similarity strictly for candidate-to-gold alignment, never as legal proof.

    Execution flow:
    1. Extract alphanumeric lowercase tokens from both strings.
    2. Return intersection size divided by union size (or 0.0 if either is empty).

    Failure cases:
    - Empty token sets return 0.0 instead of raising ZeroDivisionError.

    Side effects:
    - None: pure in-memory calculation.
    """
    a = set(_TOKEN_RE.findall(_norm_text(left)))
    b = set(_TOKEN_RE.findall(_norm_text(right)))
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def validate_xtrareg_gold_dataset(
    gold: dict[str, Any],
    pinned_source: dict[str, Any],
) -> list[str]:
    """Business purpose: Enforce AC1 quality and provenance invariants on an XTRAREG gold dataset.

    Business rules:
    - Must match XTRAREG_PREPARATION_GOLD_V1 and share legalSourceVersionId with the pinned source.
    - Must contain at least 30 atomic obligations/conditions/exceptions split across DEV and HOLDOUT.
    - Every gold item must carry pinned citations, actor, modality, applicability, dual-reviewer provenance, and non-LLM-only review status.

    Execution flow:
    1. Validate top-level schemas, source version alignment, and approval status.
    2. Validate minimum count (>= 30), unique IDs, and presence of both DEV and HOLDOUT splits.
    3. Validate per-obligation citations, reviewer provenance and source leakage across splits.

    Failure cases:
    - Returns explicit validation error strings for every missing or ungrounded gold field.

    Side effects:
    - None: read-only validation of caller-supplied structures.
    """
    errors: list[str] = []
    if not isinstance(gold, dict) or gold.get("schemaVersion") != XTRAREG_GOLD_SCHEMA:
        return ["XTRAREG_INVALID_GOLD_SCHEMA"]
    if not isinstance(pinned_source, dict) or pinned_source.get("schemaVersion") != XTRAREG_SOURCE_SCHEMA:
        return ["XTRAREG_INVALID_SOURCE_SCHEMA"]
    if gold.get("legalSourceVersionId") != pinned_source.get("legalSourceVersionId"):
        errors.append("XTRAREG_SOURCE_VERSION_MISMATCH")
    # Accept both INDEPENDENTLY_REVIEWED (required for acceptance) and SYNTHETIC_NOT_REVIEWED
    # (valid for smoke-test/diagnostic corpora).  An absent or unrecognised status is always an error.
    approval_status = gold.get("goldApprovalStatus")
    if approval_status not in {"INDEPENDENTLY_REVIEWED", "SYNTHETIC_NOT_REVIEWED"}:
        errors.append("XTRAREG_GOLD_NOT_INDEPENDENTLY_REVIEWED")
    elif approval_status == "SYNTHETIC_NOT_REVIEWED":
        # Diagnostic corpus: scoring is allowed but acceptance cannot be claimed.
        errors.append("XTRAREG_GOLD_SYNTHETIC_NOT_REVIEWED_ACCEPTANCE_BLOCKED")

    obligations = gold.get("obligations")
    if not isinstance(obligations, list) or len(obligations) < 30:
        errors.append("XTRAREG_GOLD_MINIMUM_30_OBLIGATIONS_REQUIRED")
        return errors

    source_nodes = {
        n["nodeId"]: n
        for n in pinned_source.get("nodes", [])
        if isinstance(n, dict) and isinstance(n.get("nodeId"), str)
    }
    seen_ids: set[str] = set()
    split_content: dict[str, set[str]] = {"DEV": set(), "HOLDOUT": set()}
    splits: set[str] = set()
    for idx, item in enumerate(obligations):
        oid = item.get("obligationId") if isinstance(item, dict) else None
        if not isinstance(oid, str) or not oid:
            errors.append(f"XTRAREG_GOLD_MISSING_ID:{idx}")
            continue
        if oid in seen_ids:
            errors.append(f"XTRAREG_GOLD_DUPLICATE_ID:{oid}")
        seen_ids.add(oid)

        split = item.get("split")
        if split not in {"DEV", "HOLDOUT"}:
            errors.append(f"XTRAREG_GOLD_INVALID_SPLIT:{oid}")
        else:
            splits.add(split)

        citation = item.get("citation") or {}
        node_ids = citation.get("sourceNodeIds") or []
        quote = citation.get("sourceQuote")
        if not node_ids or not isinstance(quote, str) or not quote.strip():
            errors.append(f"XTRAREG_GOLD_MISSING_CITATION:{oid}")
        else:
            missing_nodes = [nid for nid in node_ids if nid not in source_nodes]
            if missing_nodes:
                errors.append(f"XTRAREG_GOLD_UNKNOWN_SOURCE_NODE:{oid}")
            else:
                combined_text = " ".join(_norm_text(source_nodes[nid].get("text")) for nid in node_ids)
                if _norm_text(quote) not in combined_text:
                    errors.append(f"XTRAREG_GOLD_QUOTE_NOT_IN_SOURCE:{oid}")
                if split in split_content:
                    # Source IDs can differ while exposing the same legal text.
                    split_content[split].update(_norm_text(source_nodes[nid]["text"]) for nid in node_ids)
                    split_content[split].add(_norm_text(quote))

        if not isinstance(item.get("actor"), str) or not item["actor"].strip():
            errors.append(f"XTRAREG_GOLD_MISSING_ACTOR:{oid}")
        if not isinstance(item.get("modality"), str) or not item["modality"].strip():
            errors.append(f"XTRAREG_GOLD_MISSING_MODALITY:{oid}")
        applicability = item.get("applicability")
        if not isinstance(applicability, dict) or applicability.get("mode") not in {"UNCONDITIONAL", "CONDITIONAL"}:
            errors.append(f"XTRAREG_GOLD_INVALID_APPLICABILITY:{oid}")
        if not item.get("reviewerId") or not item.get("secondReviewerId") or not item.get("annotationVersion"):
            errors.append(f"XTRAREG_GOLD_MISSING_REVIEWER_PROVENANCE:{oid}")
        if item.get("adjudicationStatus") not in {"AGREED", "ADJUDICATED"}:
            errors.append(f"XTRAREG_GOLD_INVALID_ADJUDICATION_STATUS:{oid}")

    if not {"DEV", "HOLDOUT"}.issubset(splits):
        errors.append("XTRAREG_GOLD_DEV_AND_HOLDOUT_SPLITS_REQUIRED")
    if split_content["DEV"] & split_content["HOLDOUT"]:
        errors.append("XTRAREG_SPLIT_SOURCE_CONTENT_OVERLAP")
    return errors


def _project_packet(packet: dict[str, Any]) -> list[dict[str, Any]]:
    """Business purpose: Score the chain emitted by Rule Set Preparation and Direct Draft.

    Business rules:
    - Only canonical operative claims anchor an obligation.
    - Requirement bindings must preserve propositions and the typed claim closure.
    - AssessmentRule linkage uses the canonical plural parent IDs.

    Execution flow:
    1. Index operative owners and rule parents.
    2. Project each operative claim, its conditions and exceptions, and its chain evidence.

    Failure cases:
    - Missing, duplicate and inconsistent bindings remain visible as chain errors.
    - An invalid typed graph fails projection through the canonical closure validator.

    Side effects:
    - Read-only projection of the supplied packet.
    """
    graph = packet["semanticGraph"]
    claims = {claim["claimId"]: claim for claim in graph["claims"]}
    owners: dict[str, list[tuple[dict[str, Any], int]]] = {}
    for requirement in packet.get("legalRequirements", []):
        for binding in requirement["claimBindings"]:
            if binding["role"] == "OPERATIVE_PROPOSITION":
                owners.setdefault(binding["claimId"], []).append((requirement, binding["index"]))
    rules: dict[str, list[dict[str, Any]]] = {}
    for rule in packet.get("assessmentRules", []):
        for requirement_id in rule["legalRequirementIds"]:
            rules.setdefault(requirement_id, []).append(rule)

    # The canonical closure keeps typed context distinct from free-text modifiers.
    predictions = []
    for claim_id, claim in claims.items():
        if not operative(claim):
            continue
        frame = claim.get("frame") or claim.get("semanticFrame") or {}
        proposition = claim.get("operative") or frame
        bindings = owners.get(claim_id, [])
        requirement, index = bindings[0] if bindings else ({}, 0)
        coverage = requirement.get("coverage", {})
        related_rules = rules.get(requirement.get("legalRequirementId"), [])
        closure = semantic_closure(graph, claim_id)
        chain_errors = []
        if not bindings:
            chain_errors.append("CHAIN_MISSING_REQUIREMENT")
        if len(bindings) > 1:
            chain_errors.append("CHAIN_MULTIPLE_REQUIREMENTS")
        if requirement:
            propositions = requirement["operativePropositions"]
            bound = propositions[index] if 0 <= index < len(propositions) else {}
            if any(bound.get(key) != proposition.get(key) for key in ("actor", "modality", "action")):
                chain_errors.append("CHAIN_PROPOSITION_DRIFT")
            for entry in closure["claims"]:
                role = entry["role"]
                if role == "OPERATIVE_PROPOSITION":
                    continue
                context_id = entry["claimId"]
                matches = [
                    binding for binding in requirement["claimBindings"]
                    if binding["claimId"] == context_id and binding["role"] == role
                ]
                rows = requirement.get(ROLE_FIELDS[role], [])
                if len(matches) != 1 or not 0 <= matches[0]["index"] < len(rows) or rows[matches[0]["index"]] != claims[context_id]["statement"]:
                    chain_errors.append("CHAIN_CONTEXT_DRIFT")
                    break

        conditions = requirement.get("applicabilityConditions", [])
        applicability = {
            "mode": requirement.get("applicabilityMode") or frame.get("applicabilityMode")
                    or ("CONDITIONAL" if conditions else "UNCONDITIONAL"),
            "conditions": conditions,
        }
        if requirement.get("applicabilityLogic") is not None:
            applicability["logic"] = requirement["applicabilityLogic"]
        if coverage.get("state") not in {None, "COVERED_BY_ASSESSMENT_RULES", "NON_ASSESSABLE"}:
            chain_errors.append("CHAIN_COVERAGE_REVIEW_REQUIRED")
        # Rule criteria inherit their meaning from legal parents. An explicit
        # rendering needs semantic verification against the canonical parent set.
        for rule in related_rules:
            criteria = rule.get("criteria", [])
            parent_ids = set(rule["legalRequirementIds"])
            criterion_parents = [set(criterion.get("legalRequirementIds", [])) for criterion in criteria]
            if not any(requirement["legalRequirementId"] in parents for parents in criterion_parents) or any(
                not parents or not parents <= parent_ids for parents in criterion_parents
            ):
                chain_errors.append("CHAIN_RULE_CRITERION_BINDING_INVALID")
            if rule.get("applicabilityGuidance") or any(criterion.get("statement") for criterion in criteria):
                chain_errors.append("CHAIN_RULE_SEMANTICS_REVIEW_REQUIRED")
        predictions.append({
            "predId": claim_id,
            "sourceNodeIds": claim["sourceNodeIds"],
            "sourceSupport": claim.get("sourceSupport"),
            "actor": proposition.get("actor"),
            "action": proposition.get("action"),
            "modality": proposition.get("modality") or claim["claimType"],
            "applicability": applicability,
            "exceptions": requirement.get("exceptions", []),
            "hasClaim": True,
            "hasRequirement": bool(bindings),
            "hasAssessmentRule": bool(related_rules),
            "coverageState": coverage.get("state"),
            "chainErrors": sorted(set(chain_errors)),
        })
    return predictions


def _normalize_predictions(candidate: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    """Business purpose: Project either FULL_PREPARATION or DIRECT_DRAFT output into unified chain records.

    Business rules:
    - Supports FULL_PREPARATION (semanticGraph + legalRequirements + assessmentRules) and DIRECT_DRAFT (candidates + assessmentRules).
    - Preserves missing downstream links explicitly so chain integrity gaps are never hidden.

    Execution flow:
    1. Detect candidate mode from explicit mode marker or payload structure.
    2. Normalize each predicted obligation with sourceNodeIds, sourceQuote, actor, modality, action, applicability, exceptions, and downstream requirement/rule status.

    Failure cases:
    - Unsupported or missing payload shapes raise ValueError rather than inventing predictions.

    Side effects:
    - None: pure in-memory projection.
    """
    if not isinstance(candidate, dict):
        raise ValueError("XTRAREG_CANDIDATE_MUST_BE_DICT")

    # Both production workflows share the packet shape. Legacy flattened
    # diagnostic fixtures remain readable for historical metric comparisons.
    packet = candidate.get("packet", candidate)
    mode = candidate.get("mode") or packet.get("mode")
    graph = packet.get("semanticGraph")
    if isinstance(graph, dict) and (packet is not candidate or graph.get("contractVersion") == "LEGAL_GRAPH_V3"):
        return mode or "FULL_PREPARATION", _project_packet(packet)
    if mode == "DIRECT_DRAFT" or ("candidates" in candidate and "semanticGraph" not in candidate):
        raw_items = candidate.get("candidates")
        if not isinstance(raw_items, list):
            raise ValueError("XTRAREG_DIRECT_DRAFT_CANDIDATES_REQUIRED")
        rules_by_req = {
            r.get("legalRequirementId"): r
            for r in candidate.get("assessmentRules", [])
            if isinstance(r, dict) and r.get("legalRequirementId")
        }
        normalized = []
        for idx, item in enumerate(raw_items):
            cid = item.get("candidateId") or f"direct-{idx}"
            req = item.get("legalRequirement") or item
            rule = item.get("assessmentRule") or rules_by_req.get(cid)
            normalized.append({
                "predId": cid,
                "obligationId": item.get("obligationId"),
                "sourceNodeIds": list(item.get("sourceNodeIds") or []),
                "sourceQuote": item.get("sourceQuote") or "",
                "actor": item.get("actor") or req.get("actor") or "",
                "modality": item.get("modality") or req.get("requirementType") or "",
                "action": item.get("action") or req.get("action") or "",
                "applicability": item.get("applicability") or req.get("applicability") or {"mode": "UNCONDITIONAL", "conditions": []},
                "exceptions": list(item.get("exceptions") or req.get("exceptions") or []),
                "hasClaim": bool(item.get("sourceNodeIds")),
                "hasRequirement": bool(req),
                "requirementType": req.get("requirementType") or item.get("modality") or "",
                "coverageState": req.get("coverageState") or ("ASSESSABLE" if rule else "NON_ASSESSABLE"),
                "hasAssessmentRule": rule is not None,
                "nonAssessableReason": req.get("nonAssessableReason"),
            })
        return "DIRECT_DRAFT", normalized

    if "semanticGraph" in candidate:
        graph = candidate["semanticGraph"]
        claims = [c for c in graph.get("claims", []) if isinstance(c, dict)]
        reqs = [r for r in candidate.get("legalRequirements", []) if isinstance(r, dict)]
        rules = [r for r in candidate.get("assessmentRules", []) if isinstance(r, dict)]

        req_by_claim: dict[str, dict[str, Any]] = {}
        for req in reqs:
            for cid in req.get("operativeClaimIds", []):
                req_by_claim[cid] = req
        rule_by_req = {r.get("legalRequirementId"): r for r in rules if r.get("legalRequirementId")}

        normalized = []
        for claim in claims:
            cid = claim.get("claimId") or ""
            op = claim.get("operative") or {}
            frame = claim.get("frame") or {}
            req = req_by_claim.get(cid)
            rule = rule_by_req.get(req.get("legalRequirementId")) if req else None
            normalized.append({
                "predId": cid,
                "obligationId": claim.get("obligationId"),
                "sourceNodeIds": list(claim.get("sourceNodeIds") or []),
                "sourceQuote": claim.get("sourceQuote") or "",
                "actor": op.get("actor") or frame.get("actor") or claim.get("actor") or "",
                "modality": claim.get("claimType") or op.get("modality") or "",
                "action": op.get("action") or frame.get("action") or claim.get("action") or "",
                "applicability": (
                    (req.get("applicability") if req else None)
                    or claim.get("applicability")
                    or {"mode": "CONDITIONAL" if frame.get("trigger") else "UNCONDITIONAL", "conditions": [frame["trigger"]] if frame.get("trigger") else []}
                ),
                "exceptions": list(claim.get("exceptions") or ([frame["exception"]] if frame.get("exception") else [])),
                "hasClaim": True,
                "hasRequirement": req is not None,
                "requirementType": (req.get("requirementType") if req else None) or claim.get("claimType") or "",
                "coverageState": (req.get("coverageState") if req else None) or "UNMAPPED",
                "hasAssessmentRule": rule is not None,
                "nonAssessableReason": req.get("nonAssessableReason") if req else None,
            })
        return "FULL_PREPARATION", normalized

    raise ValueError("XTRAREG_CANDIDATE_MODE_UNRECOGNIZED")


def _is_grounded(pred: dict[str, Any], source_nodes: dict[str, dict[str, Any]]) -> bool:
    """Business purpose: Verify that a predicted obligation cites valid pinned source nodes and optional verbatim quote.

    Business rules:
    - Empty sourceNodeIds or unknown nodeIds fail grounding immediately.
    - Evidence requires canonical source spans or a quote matching the pinned source.

    Execution flow:
    1. Check non-empty sourceNodeIds and existence in pinned source.
    2. Validate exact production spans or verify containment of the legacy quote.

    Failure cases:
    - Returns False for missing, fabricated, or misquoted citations.

    Side effects:
    - None: read-only check.
    """
    node_ids = pred.get("sourceNodeIds") or []
    if not node_ids or any(nid not in source_nodes for nid in node_ids):
        return False
    # Production claims carry exact UTF-16 spans rather than a joined quote.
    if "sourceSupport" in pred:
        spans = pred["sourceSupport"]
        try:
            source = SimpleNamespace(nodes={nid: {"content": source_nodes[nid]["text"]} for nid in node_ids})
            verified = canonical_support(source, node_ids, spans)
            return sorted(spans, key=lambda span: (span["nodeId"], span["startOffset"], span["endOffset"])) == verified
        except (AttributeError, KeyError, TypeError, ValueError):
            return False
    quote = _norm_text(pred.get("sourceQuote"))
    if not quote:
        return False
    combined = " ".join(_norm_text(source_nodes[nid].get("text")) for nid in node_ids)
    return quote in combined


def _meaning_differences(
    gold: dict[str, Any], prediction: dict[str, Any], source_nodes: dict[str, dict[str, Any]],
) -> tuple[list[str], int]:
    """Business purpose: Detect unresolved changes to an aligned legal proposition.

    Business rules:
    - Diagnostic agreement requires exact action, applicability and exception fields.
    - Extra conditions and exceptions can change who is subject to the obligation.

    Execution flow:
    1. Compare the action and complete applicability structure.
    2. Count exactly retained exception conditions and flag missing or extra ones.
    3. Require the annotated citation to be supported by the prediction's validated evidence.

    Failure cases:
    - Unresolved action text requires review, including empty predictions.

    Side effects:
    - None. The comparison does not adjudicate legal paraphrases.
    """
    errors = []
    action = " ".join((prediction.get("action") or "").split())
    if not action or action != " ".join(gold["action"].split()):
        errors.append("ACTION_REVIEW_REQUIRED")
    if prediction.get("applicability") != gold["applicability"]:
        errors.append("APPLICABILITY_MISMATCH")
    expected = set(gold["exceptions"])
    observed = set(prediction.get("exceptions") or [])
    if expected - observed:
        errors.append("MISSING_EXCEPTION")
    if observed - expected:
        errors.append("EXCEPTION_REVIEW_REQUIRED")
    # An existing node establishes reference integrity. The annotated quote
    # must also be present in the supplied evidence before it receives credit.
    citation = gold["citation"]
    expected_nodes = set(citation["sourceNodeIds"])
    support_quote = prediction.get("sourceQuote", "")
    if "sourceSupport" in prediction:
        support_quote = " ".join(
            utf16_slice(source_nodes[span["nodeId"]]["text"], span["startOffset"], span["endOffset"])
            for span in prediction["sourceSupport"] if span["nodeId"] in expected_nodes
        )
    if not expected_nodes.issubset(prediction["sourceNodeIds"]) or _norm_text(citation["sourceQuote"]) not in _norm_text(support_quote):
        errors.append("CITATION_REVIEW_REQUIRED")
    return errors, len(expected & observed)


def _score_subset(
    obligations: list[dict[str, Any]],
    predictions: list[dict[str, Any]],
    source_nodes: dict[str, dict[str, Any]],
    split_name: str,
) -> dict[str, Any]:
    """Business purpose: Score one split (DEV, HOLDOUT, or ALL) across all XTRAREG Table III dimensions.

    Business rules:
    - Separates FULL, PARTIAL, INCORRECT, and MISSED atomic obligations with explicit denominators.
    - Tracks grounding, duplication, source coverage, actor accuracy, applicability accuracy, exception preservation, and chain integrity.
    - Counts missed assessable gold in end-to-end coverage and uses matched gold for conditional conversion.
    - Citation integrity is mechanical; semantic grounding requires independent review.
    - Flags critical errors (UNGROUNDED_OBLIGATION, MISSING_EXCEPTION, MODALITY_INVERSION, MISSING_OBLIGATION) in failedCases.

    Execution flow:
    1. Filter predictions relevant to the split's source nodes (or all predictions for ALL).
    2. Check grounding of every prediction and align grounded predictions to atomic gold obligations.
    3. Detect duplicates and classify each gold obligation as FULL, PARTIAL, INCORRECT, or MISSED.
    4. Aggregate precision, recall, coverage, grounding, duplication, actor/applicability/exception rates, and chain integrity.

    Failure cases:
    - New rates return None when their denominator is empty or semantic review is unavailable.

    Side effects:
    - None: pure evaluation calculation.
    """
    gold_by_id = {item["obligationId"]: item for item in obligations}
    split_nodes = {nid for item in obligations for nid in item["citation"]["sourceNodeIds"]}

    if split_name == "ALL":
        scoped_preds = list(predictions)
    else:
        scoped_preds = [
            p for p in predictions
            if (p.get("obligationId") in gold_by_id)
            or bool(split_nodes.intersection(p.get("sourceNodeIds") or []))
            or not _is_grounded(p, source_nodes)
        ]
        # Only count predictions belonging to this split (explicit obligationId in gold_by_id,
        # or untagged grounded predictions overlapping this split's source nodes).
        if split_name in {"DEV", "HOLDOUT"}:
            scoped_preds = [
                p for p in predictions
                if (p.get("obligationId") in gold_by_id)
                or (
                    p.get("obligationId") is None
                    and bool(split_nodes.intersection(p.get("sourceNodeIds") or []))
                    and _is_grounded(p, source_nodes)
                )
                or (not _is_grounded(p, source_nodes) and split_name == "HOLDOUT" and not p.get("obligationId"))
            ]

    ungrounded_preds: list[dict[str, Any]] = []
    grounded_preds: list[dict[str, Any]] = []
    for pred in scoped_preds:
        if _is_grounded(pred, source_nodes):
            grounded_preds.append(pred)
        else:
            ungrounded_preds.append(pred)

    matches: dict[str, list[dict[str, Any]]] = {oid: [] for oid in gold_by_id}
    for pred in grounded_preds:
        explicit_oid = pred.get("obligationId")
        # Explicit alignment is only a scoring hint. Evidence is verified
        # against this obligation's annotated citation before awarding credit.
        if explicit_oid in gold_by_id:
            matches[explicit_oid].append(pred)
            continue
        # Align by shared sourceNodeId + highest action/modality/actor overlap.
        p_nodes = set(pred.get("sourceNodeIds") or [])
        best_oid = None
        best_score = -1.0
        for oid, item in gold_by_id.items():
            g_nodes = set(item["citation"]["sourceNodeIds"])
            if not p_nodes.intersection(g_nodes):
                continue
            score = _token_jaccard(pred.get("action", ""), item["action"])
            if _norm_text(pred.get("modality")) == _norm_text(item["modality"]):
                score += 0.35
            if _norm_text(pred.get("actor")) == _norm_text(item["actor"]):
                score += 0.25
            if score > best_score:
                best_score = score
                best_oid = oid
        if best_oid is not None and best_score >= 0.2:
            matches[best_oid].append(pred)

    full_count = 0
    partial_count = 0
    incorrect_count = 0
    missed_count = 0
    duplicate_count = 0
    actor_correct = 0
    applicability_correct = 0
    matched_count = 0
    gold_exception_total = 0
    preserved_exception_total = 0
    claims_to_reqs = 0
    reqs_to_rules = 0
    matched_assessable_gold = 0
    non_assessable_correct = 0
    covered_nodes: set[str] = set()
    failed_cases: list[dict[str, Any]] = []
    critical_counts = {code: 0 for code in sorted(CRITICAL_ERROR_CODES)}

    for pred in ungrounded_preds:
        critical_counts["UNGROUNDED_OBLIGATION"] += 1
        failed_cases.append({
            "obligationId": pred.get("obligationId") or pred["predId"],
            "split": split_name,
            "classification": "INCORRECT",
            "errorCodes": ["UNGROUNDED_OBLIGATION"],
            "details": f"Predicted obligation '{pred['predId']}' lacks valid pinned sourceNodeIds or matching sourceQuote.",
        })

    for item in obligations:
        oid = item["obligationId"]
        gold_exception_total += len(set(item["exceptions"]))

        preds = matches[oid]
        if not preds:
            missed_count += 1
            critical_counts["MISSING_OBLIGATION"] += 1
            failed_cases.append({
                "obligationId": oid,
                "split": item["split"],
                "classification": "MISSED",
                "errorCodes": ["MISSING_OBLIGATION"],
                "details": f"Gold obligation {oid} ({item['citation']['locator']}) was not extracted.",
            })
            continue

        if len(preds) > 1:
            duplicate_count += len(preds) - 1

        # Evaluate primary matched prediction for this atomic obligation.
        primary = preds[0]
        matched_count += 1
        covered_nodes.update(set(item["citation"]["sourceNodeIds"]) & set(primary.get("sourceNodeIds") or []))

        case_errors = list(primary.get("chainErrors", []))
        modality_match = _norm_text(primary.get("modality")) == _norm_text(item["modality"])
        if not modality_match:
            case_errors.append("MODALITY_INVERSION")
            critical_counts["MODALITY_INVERSION"] += 1

        actor_match = _norm_text(primary.get("actor")) == _norm_text(item["actor"])
        if actor_match:
            actor_correct += 1
        else:
            case_errors.append("ACTOR_MISMATCH")

        # Lexical overlap aligns candidates only. Exact field agreement is a
        # conservative diagnostic; any unresolved action blocks a FULL result.
        semantic_errors, preserved_here = _meaning_differences(item, primary, source_nodes)
        case_errors.extend(semantic_errors)
        if "APPLICABILITY_MISMATCH" not in semantic_errors:
            applicability_correct += 1
        preserved_exception_total += preserved_here
        for code in CRITICAL_ERROR_CODES.intersection(semantic_errors):
            critical_counts[code] += 1

        # Score every duplicate for review while retaining one metric row per
        # atomic obligation. A duplicate cannot hide a contradictory proposition.
        for duplicate in preds[1:]:
            duplicate_errors, _ = _meaning_differences(item, duplicate, source_nodes)
            duplicate_errors.extend(["DUPLICATE_PREDICTION", *duplicate.get("chainErrors", [])])
            if _norm_text(duplicate.get("actor")) != _norm_text(item["actor"]):
                duplicate_errors.append("ACTOR_MISMATCH")
            if _norm_text(duplicate.get("modality")) != _norm_text(item["modality"]):
                duplicate_errors.append("MODALITY_INVERSION")
            for code in CRITICAL_ERROR_CODES.intersection(duplicate_errors):
                critical_counts[code] += 1
            failed_cases.append({
                "obligationId": oid,
                "predictionId": duplicate["predId"],
                "split": item["split"],
                "classification": "REVIEW_REQUIRED",
                "errorCodes": sorted(duplicate_errors),
                "details": "Additional prediction aligned to the same atomic obligation.",
            })

        # Chain integrity: semanticClaim -> LegalRequirement -> AssessmentRule
        has_claim_and_requirement = primary.get("hasClaim") and primary.get("hasRequirement")
        if has_claim_and_requirement:
            claims_to_reqs += 1
        expected_assessable = bool(item["expectedAssessmentRule"]["expectedAssessable"])
        if expected_assessable:
            matched_assessable_gold += 1
            if primary.get("hasAssessmentRule"):
                # Coverage requires the complete structural chain.
                if has_claim_and_requirement:
                    reqs_to_rules += 1
            else:
                case_errors.append("CHAIN_MISSING_ASSESSMENT_RULE")
        else:
            if not primary.get("hasAssessmentRule") and primary.get("coverageState") == "NON_ASSESSABLE":
                non_assessable_correct += 1
            elif primary.get("hasAssessmentRule"):
                case_errors.append("CHAIN_SPURIOUS_ASSESSMENT_RULE")

        # An unverified action does not receive lenient recall credit.
        if not modality_match or not actor_match or any(
            code in case_errors for code in ("ACTION_REVIEW_REQUIRED", "CITATION_REVIEW_REQUIRED")
        ):
            incorrect_count += 1
            classification = "INCORRECT"
        elif case_errors:
            partial_count += 1
            classification = "PARTIAL"
        else:
            full_count += 1
            classification = "FULL"

        if case_errors:
            failed_cases.append({
                "obligationId": oid,
                "split": item["split"],
                "classification": classification,
                "errorCodes": sorted(set(case_errors)),
                "details": f"Predicted '{primary['predId']}' classified as {classification} with errors: {', '.join(sorted(set(case_errors)))}.",
            })

    total_gold = len(obligations)
    total_predicted = len(scoped_preds)
    non_assessable_gold = sum(1 for item in obligations if not item["expectedAssessmentRule"]["expectedAssessable"])
    # Count gold directly so an extraction miss still lowers end-to-end coverage.
    assessable_gold = total_gold - non_assessable_gold
    matched_to_rules_rate = reqs_to_rules / matched_assessable_gold if matched_assessable_gold else None
    citation_integrity_rate = len(grounded_preds) / total_predicted if total_predicted else None

    # P1-03: Report grounded predictions that were not matched to any gold obligation.
    # These are NOT errors (gold may be incomplete), but must appear in analysis for transparency.
    matched_predictions = {id(p) for oid_preds in matches.values() for p in oid_preds}
    for pred in grounded_preds:
        if id(pred) not in matched_predictions:
            failed_cases.append({
                "obligationId": pred.get("obligationId") or pred["predId"],
                "split": split_name,
                "classification": "UNMATCHED_GROUNDED_PREDICTION",
                "errorCodes": ["UNMATCHED_GROUNDED_PREDICTION"],
                "details": (
                    f"Grounded prediction '{pred['predId']}' was not matched to any gold obligation "
                    f"in the {split_name} split. Gold corpus may be incomplete."
                ),
            })

    return {
        "split": split_name,
        "denominators": {
            "totalGoldObligations": total_gold,
            "totalPredictedObligations": total_predicted,
            "totalGoldSourceNodes": len(split_nodes),
            "totalGoldExceptions": gold_exception_total,
            "matchedObligations": matched_count,
            # Retain the V1 conditional denominator for existing report readers.
            "expectedAssessableRules": matched_assessable_gold,
            "matchedAssessableGoldObligations": matched_assessable_gold,
            "expectedAssessableGoldObligations": assessable_gold,
            "expectedNonAssessableRequirements": non_assessable_gold,
        },
        "classifications": {
            "full": full_count,
            "partial": partial_count,
            "incorrect": incorrect_count,
            "missed": missed_count,
        },
        "metrics": {
            "strictPrecision": full_count / total_predicted if total_predicted else 0.0,
            "lenientPrecision": (full_count + partial_count) / total_predicted if total_predicted else 0.0,
            "strictRecall": full_count / total_gold if total_gold else 0.0,
            "lenientRecall": (full_count + partial_count) / total_gold if total_gold else 0.0,
            "sourceUnitCoverage": len(covered_nodes) / len(split_nodes) if split_nodes else 0.0,
            "obligationCoverage": (full_count + partial_count) / total_gold if total_gold else 0.0,
            # Preserve the V1 citation alias while exposing its measured scope.
            "groundingRate": citation_integrity_rate if citation_integrity_rate is not None else 1.0,
            "citationIntegrityRate": citation_integrity_rate,
            "semanticGroundingRate": None,
            # Every mechanically valid citation is pending semantic review.
            "groundingReviewRequiredCount": len(grounded_preds),
            "ungroundedCount": len(ungrounded_preds),
            "duplicateCount": duplicate_count,
            "duplicationRate": duplicate_count / total_predicted if total_predicted else 0.0,
            "actorAccuracy": actor_correct / matched_count if matched_count else 0.0,
            "applicabilityAccuracy": applicability_correct / matched_count if matched_count else 0.0,
            "exceptionPreservationRate": preserved_exception_total / gold_exception_total if gold_exception_total else 1.0,
            "claimsToRequirementsRate": claims_to_reqs / matched_count if matched_count else 0.0,
            "requirementsToRulesRate": matched_to_rules_rate if matched_to_rules_rate is not None else 1.0,
            "matchedAssessableToRulesRate": matched_to_rules_rate,
            "endToEndAssessableRuleCoverage": reqs_to_rules / assessable_gold if assessable_gold else None,
            "nonAssessableAccuracy": non_assessable_correct / non_assessable_gold if non_assessable_gold else 1.0,
        },
        "criticalErrorCounts": critical_counts,
        "failedCases": failed_cases,
    }


def evaluate_xtrareg_chain(
    gold: dict[str, Any],
    pinned_source: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose: Evaluate a Preparation or Direct-Draft output across the full XTRAREG semantic chain.

    Business rules:
    - Enforces diagnostic gold structure before scoring predictions.
    - Reports ALL, DEV, and HOLDOUT splits separately with explicit denominators (AC3).
    - Fails closed on critical regressions such as ungrounded obligations or dropped exceptions (AC2).

    Execution flow:
    1. Validate gold dataset and pinned source provenance (AC1).
    2. Normalize candidate predictions (FULL_PREPARATION or DIRECT_DRAFT).
    3. Score ALL, DEV, and HOLDOUT splits and keep reviewed acceptance blocked.

    Failure cases:
    - Invalid gold/source raises ValueError; semantic or chain errors are reported in criticalErrorCounts and failedCases.

    Side effects:
    - None: pure offline evaluation without LLM calls or persistence.
    """
    gold_errors = validate_xtrareg_gold_dataset(gold, pinned_source)
    # SYNTHETIC_NOT_REVIEWED is a soft warning: scoring is permitted but acceptance cannot be claimed.
    # All other validation errors are hard blockers that prevent scoring.
    acceptance_blocked_errors = {e for e in gold_errors if e == "XTRAREG_GOLD_SYNTHETIC_NOT_REVIEWED_ACCEPTANCE_BLOCKED"}
    hard_errors = [e for e in gold_errors if e not in acceptance_blocked_errors]
    if hard_errors:
        raise ValueError("XTRAREG_GOLD_VALIDATION_FAILED:" + ",".join(hard_errors))
    # Carry acceptance-blocking warnings into the report for transparency.
    acceptance_warnings = list(acceptance_blocked_errors)

    mode, predictions = _normalize_predictions(candidate)
    source_nodes = {n["nodeId"]: n for n in pinned_source["nodes"]}
    obligations = gold["obligations"]
    dev_obligations = [o for o in obligations if o["split"] == "DEV"]
    holdout_obligations = [o for o in obligations if o["split"] == "HOLDOUT"]

    all_report = _score_subset(obligations, predictions, source_nodes, "ALL")
    dev_report = _score_subset(dev_obligations, predictions, source_nodes, "DEV")
    holdout_report = _score_subset(holdout_obligations, predictions, source_nodes, "HOLDOUT")

    return {
        "schemaVersion": "XTRAREG_EVAL_REPORT_V1",
        "legalSourceVersionId": gold["legalSourceVersionId"],
        "annotationVersion": gold["annotationVersion"],
        "mode": mode,
        # XTRAREG's annotation label is caller data. No verified XTRAREG
        # evidence package currently authorizes this scorer to grant acceptance.
        "passedCriticalGate": False,
        "acceptanceWarnings": [*acceptance_warnings, "XTRAREG_REVIEWED_EVIDENCE_REQUIRED"],
        "splits": {
            "ALL": all_report,
            "DEV": dev_report,
            "HOLDOUT": holdout_report,
        },
        "failedCases": all_report["failedCases"],
    }


def compare_direct_draft_vs_preparation(
    gold: dict[str, Any],
    pinned_source: dict[str, Any],
    direct_draft_candidate: dict[str, Any],
    preparation_candidate: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose: Compare DIRECT_DRAFT versus FULL_PREPARATION on the exact same pinned source and holdout.

    Business rules:
    - Evaluates both modes using identical gold and pinned source definitions.
    - P1-05: Requires both candidates share the same legalSourceVersionId as gold.
    - Warns when model identity is missing or differs between the candidates.
    - Deltas are diagnostic until an independently verified paired execution is available.

    Execution flow:
    1. Verify source version identity and optional model version parity.
    2. Run evaluate_xtrareg_chain on both DIRECT_DRAFT and FULL_PREPARATION outputs.
    3. Compute holdout deltas including citation integrity when both arms have predictions.
    4. Emit deltas with an explicit diagnostic status.

    Failure cases:
    - Mismatched legalSourceVersionId raises ValueError to prevent cross-corpus comparisons.
    - Gold/source/candidate validation errors propagate from evaluate_xtrareg_chain.

    Side effects:
    - None: pure comparison report.
    """
    # Compare graph pins in both packet formats. Missing identity cannot
    # establish that both executions used the same reviewed text.
    gold_source_version = gold.get("legalSourceVersionId")
    for label, candidate in (("DIRECT_DRAFT", direct_draft_candidate), ("FULL_PREPARATION", preparation_candidate)):
        packet = candidate.get("packet", candidate)
        version = packet.get("semanticGraph", packet).get("legalSourceVersionId")
        if not version or version != gold_source_version:
            raise ValueError(f"XTRAREG_SOURCE_VERSION_IDENTITY_FAILED:{label}:{version}!={gold_source_version}")

    dd_model = direct_draft_candidate.get("modelId")
    prep_model = preparation_candidate.get("modelId")
    model_parity_warning = None
    if not dd_model or not prep_model:
        model_parity_warning = "MODEL_ID_MISSING"
    elif dd_model != prep_model:
        model_parity_warning = "MODEL_ID_MISMATCH"

    # Production packets share one schema, so the paired slot supplies the
    # diagnostic role when the Direct Draft artifact has no outer mode label.
    direct_report = evaluate_xtrareg_chain(
        gold, pinned_source, {"mode": "DIRECT_DRAFT", **direct_draft_candidate},
    )
    prep_report = evaluate_xtrareg_chain(gold, pinned_source, preparation_candidate)
    if direct_report["mode"] != "DIRECT_DRAFT" or prep_report["mode"] != "FULL_PREPARATION":
        raise ValueError("XTRAREG_PAIRED_MODE_MISMATCH")

    d_hold = direct_report["splits"]["HOLDOUT"]["metrics"]
    p_hold = prep_report["splits"]["HOLDOUT"]["metrics"]
    p_crit = sum(prep_report["splits"]["HOLDOUT"]["criticalErrorCounts"].values())
    d_crit = sum(direct_report["splits"]["HOLDOUT"]["criticalErrorCounts"].values())
    prep_citation_rate = p_hold["citationIntegrityRate"]
    direct_citation_rate = d_hold["citationIntegrityRate"]

    deltas = {
        "strictRecallDelta": p_hold["strictRecall"] - d_hold["strictRecall"],
        "lenientRecallDelta": p_hold["lenientRecall"] - d_hold["lenientRecall"],
        "groundingRateDelta": p_hold["groundingRate"] - d_hold["groundingRate"],
        # A missing prediction set has no citation rate to compare.
        "citationIntegrityRateDelta": (
            prep_citation_rate - direct_citation_rate
            if prep_citation_rate is not None and direct_citation_rate is not None
            else None
        ),
        "exceptionPreservationDelta": p_hold["exceptionPreservationRate"] - d_hold["exceptionPreservationRate"],
        "duplicationRateDelta": p_hold["duplicationRate"] - d_hold["duplicationRate"],
        "criticalErrorDelta": p_crit - d_crit,
    }

    # Deltas describe the supplied artifacts. A diagnostic comparison cannot
    # promote them to an independently reviewed result.
    reason = "NOT_EVALUATED: independently verified XTRAREG paired execution evidence is required."
    return {
        "schemaVersion": "XTRAREG_MODE_COMPARISON_V1",
        "legalSourceVersionId": gold_source_version,
        "directDraft": direct_report,
        "fullPreparation": prep_report,
        "holdoutDeltas": deltas,
        "semanticGainClaimed": False,
        "gainAssessmentReason": reason,
        **({"modelParityWarning": model_parity_warning} if model_parity_warning else {}),
    }
