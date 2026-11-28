"""XTRAREG (IEEE RE 2025) atomic obligation, chain, and holdout scorer for Rule Set Preparation.

Evaluates the semantic chain:
    semanticClaims -> LegalRequirements -> AssessmentRules
across both FULL_PREPARATION (discovery + authoring) and DIRECT_DRAFT modes
against an independently reviewed gold annotation set (>= 30 obligations).
"""

from __future__ import annotations

import re
from typing import Any

XTRAREG_GOLD_SCHEMA = "XTRAREG_PREPARATION_GOLD_V1"
XTRAREG_SOURCE_SCHEMA = "XTRAREG_PINNED_LEGAL_SOURCE_V1"
CRITICAL_ERROR_CODES = frozenset({
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
    3. Validate per-obligation citation grounding, actor, applicability, and reviewer provenance.

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
    return errors


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

    mode = candidate.get("mode")
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
                "actor": op.get("actor") or claim.get("actor") or "",
                "modality": claim.get("claimType") or op.get("modality") or "",
                "action": op.get("action") or claim.get("action") or "",
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
    - When sourceQuote is supplied, it must match the pinned text of the cited node(s).

    Execution flow:
    1. Check non-empty sourceNodeIds and existence in pinned source.
    2. If sourceQuote is non-empty, verify normalized substring containment.

    Failure cases:
    - Returns False for missing, fabricated, or misquoted citations.

    Side effects:
    - None: read-only check.
    """
    node_ids = pred.get("sourceNodeIds") or []
    if not node_ids or any(nid not in source_nodes for nid in node_ids):
        return False
    quote = _norm_text(pred.get("sourceQuote"))
    if quote:
        combined = " ".join(_norm_text(source_nodes[nid].get("text")) for nid in node_ids)
        if quote not in combined:
            return False
    return True


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
    - Flags critical errors (UNGROUNDED_OBLIGATION, MISSING_EXCEPTION, MODALITY_INVERSION, MISSING_OBLIGATION) in failedCases.

    Execution flow:
    1. Filter predictions relevant to the split's source nodes (or all predictions for ALL).
    2. Check grounding of every prediction and align grounded predictions to atomic gold obligations.
    3. Detect duplicates and classify each gold obligation as FULL, PARTIAL, INCORRECT, or MISSED.
    4. Aggregate precision, recall, coverage, grounding, duplication, actor/applicability/exception rates, and chain integrity.

    Failure cases:
    - Zero denominators return None for rates rather than raising ZeroDivisionError.

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
    expected_rules_total = 0
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
        gold_exceptions = [_norm_text(e) for e in item.get("exceptions", []) if _norm_text(e)]
        gold_exception_total += len(gold_exceptions)

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

        case_errors: list[str] = []
        modality_match = _norm_text(primary.get("modality")) == _norm_text(item["modality"])
        if not modality_match:
            case_errors.append("MODALITY_INVERSION")
            critical_counts["MODALITY_INVERSION"] += 1

        actor_match = _norm_text(primary.get("actor")) == _norm_text(item["actor"])
        if actor_match:
            actor_correct += 1
        else:
            case_errors.append("ACTOR_MISMATCH")

        # P0-05: Use structured field comparison instead of lexical similarity for FULL/PARTIAL/INCORRECT.
        # Token Jaccard is kept only for alignment (candidate-to-gold matching above), never for scoring.
        # FULL requires: modality match AND actor match AND applicability match AND ALL exceptions covered.
        # PARTIAL: modality match AND actor match AND at least one structural field partially off.
        # INCORRECT: modality mismatch OR actor mismatch (normalized exact match).
        g_app = item["applicability"]
        p_app = primary.get("applicability") or {}
        g_conds = {_norm_text(c) for c in g_app.get("conditions", []) if _norm_text(c)}
        p_conds = {_norm_text(c) for c in p_app.get("conditions", []) if _norm_text(c)}
        # Applicability matches when mode matches and all gold conditions are covered
        # (allowing a 0.4 token-Jaccard or substring match against predicted conditions).
        app_match = _norm_text(p_app.get("mode")) == _norm_text(g_app.get("mode")) and (
            not g_conds or all(any(_token_jaccard(gc, pc) >= 0.4 or gc in pc or pc in gc for pc in p_conds) for gc in g_conds)
        )
        if app_match:
            applicability_correct += 1
        else:
            case_errors.append("APPLICABILITY_MISMATCH")

        p_exceptions = [_norm_text(e) for e in primary.get("exceptions", []) if _norm_text(e)]
        preserved_here = sum(
            1 for ge in gold_exceptions
            # Require >= 0.5 token Jaccard for structured exception matching (raised from 0.35
            # to prevent spurious matches between semantically distinct legal clauses).
            if any(_token_jaccard(ge, pe) >= 0.5 or ge in pe or pe in ge for pe in p_exceptions)
        )
        preserved_exception_total += preserved_here
        if preserved_here < len(gold_exceptions):
            case_errors.append("MISSING_EXCEPTION")
            critical_counts["MISSING_EXCEPTION"] += 1

        # Chain integrity: semanticClaim -> LegalRequirement -> AssessmentRule
        if primary.get("hasClaim") and primary.get("hasRequirement"):
            claims_to_reqs += 1
        expected_assessable = bool(item["expectedAssessmentRule"]["expectedAssessable"])
        if expected_assessable:
            expected_rules_total += 1
            if primary.get("hasAssessmentRule"):
                reqs_to_rules += 1
            else:
                case_errors.append("CHAIN_MISSING_ASSESSMENT_RULE")
        else:
            if not primary.get("hasAssessmentRule") and primary.get("coverageState") == "NON_ASSESSABLE":
                non_assessable_correct += 1
            elif primary.get("hasAssessmentRule"):
                case_errors.append("CHAIN_SPURIOUS_ASSESSMENT_RULE")

        # P0-05: Structured FULL/PARTIAL/INCORRECT classification.
        # INCORRECT when modality is wrong OR actor is wrong (the two invariants that cannot be partially right).
        # PARTIAL when both modality and actor match but at least one structural field (action,
        #   applicability, exceptions, chain) differs.
        # FULL when every structural field matches.
        if not modality_match or not actor_match:
            incorrect_count += 1
            classification = "INCORRECT"
            if not actor_match:
                case_errors.append("ACTION_MISMATCH")  # kept for backward-compat label; structural mismatch
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

    # P1-03: Report grounded predictions that were not matched to any gold obligation.
    # These are NOT errors (gold may be incomplete), but must appear in analysis for transparency.
    matched_pred_ids: set[str] = {p["predId"] for oid_preds in matches.values() for p in oid_preds}
    for pred in grounded_preds:
        if pred["predId"] not in matched_pred_ids:
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
            "expectedAssessableRules": expected_rules_total,
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
            "groundingRate": len(grounded_preds) / total_predicted if total_predicted else 1.0,
            "ungroundedCount": len(ungrounded_preds),
            "duplicateCount": duplicate_count,
            "duplicationRate": duplicate_count / total_predicted if total_predicted else 0.0,
            "actorAccuracy": actor_correct / matched_count if matched_count else 0.0,
            "applicabilityAccuracy": applicability_correct / matched_count if matched_count else 0.0,
            "exceptionPreservationRate": preserved_exception_total / gold_exception_total if gold_exception_total else 1.0,
            "claimsToRequirementsRate": claims_to_reqs / matched_count if matched_count else 0.0,
            "requirementsToRulesRate": reqs_to_rules / expected_rules_total if expected_rules_total else 1.0,
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
    - Enforces AC1 gold validity before scoring any predictions.
    - Reports ALL, DEV, and HOLDOUT splits separately with explicit denominators (AC3).
    - Fails closed on critical regressions such as ungrounded obligations or dropped exceptions (AC2).

    Execution flow:
    1. Validate gold dataset and pinned source provenance (AC1).
    2. Normalize candidate predictions (FULL_PREPARATION or DIRECT_DRAFT).
    3. Score ALL, DEV, and HOLDOUT splits and compute critical regression gate status.

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

    critical_total = sum(all_report["criticalErrorCounts"].values())
    return {
        "schemaVersion": "XTRAREG_EVAL_REPORT_V1",
        "legalSourceVersionId": gold["legalSourceVersionId"],
        "annotationVersion": gold["annotationVersion"],
        "mode": mode,
        # passedCriticalGate is False when any critical regression is present OR when the
        # gold corpus is synthetic (acceptance cannot be claimed for smoke-test datasets).
        "passedCriticalGate": critical_total == 0 and not acceptance_warnings,
        "acceptanceWarnings": acceptance_warnings,
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
    - Warns when candidates were produced by different model versions (may confound comparison).
    - Never claims semantic gain unless ALL of: holdout strictRecall non-negative delta,
      exceptionPreservation non-negative delta, criticalErrorDelta <= 0, AND at least one metric
      strictly positive (AC3). Synthetic corpora (SYNTHETIC_NOT_REVIEWED) always block gain claims.

    Execution flow:
    1. Verify source version identity and optional model version parity.
    2. Run evaluate_xtrareg_chain on both DIRECT_DRAFT and FULL_PREPARATION outputs.
    3. Compute holdout metric deltas (strictRecall, groundingRate, exceptionPreservationRate, duplicationRate).
    4. Emit an evidence-bound semanticGainClaimed boolean and explicit assessment reason.

    Failure cases:
    - Mismatched legalSourceVersionId raises ValueError to prevent cross-corpus comparisons.
    - Gold/source/candidate validation errors propagate from evaluate_xtrareg_chain.

    Side effects:
    - None: pure comparison report.
    """
    # P1-05: Verify that both candidates and gold all share the same legal source version.
    gold_source_version = gold.get("legalSourceVersionId")
    dd_source_version = direct_draft_candidate.get("legalSourceVersionId")
    prep_source_version = preparation_candidate.get("semanticGraph", {}).get("legalSourceVersionId")
    source_mismatch_errors: list[str] = []
    if dd_source_version and dd_source_version != gold_source_version:
        source_mismatch_errors.append(f"DIRECT_DRAFT_SOURCE_VERSION_MISMATCH:{dd_source_version}!={gold_source_version}")
    if prep_source_version and prep_source_version != gold_source_version:
        source_mismatch_errors.append(f"PREPARATION_SOURCE_VERSION_MISMATCH:{prep_source_version}!={gold_source_version}")
    if source_mismatch_errors:
        raise ValueError("XTRAREG_SOURCE_VERSION_IDENTITY_FAILED:" + ",".join(source_mismatch_errors))

    # P1-05: Warn when candidates report different modelIds (comparison validity concern, not a blocker).
    dd_model = direct_draft_candidate.get("modelId")
    prep_model = preparation_candidate.get("modelId")
    model_parity_warning: str | None = None
    if dd_model and prep_model and dd_model != prep_model:
        model_parity_warning = (
            f"MODEL_ID_MISMATCH: direct_draft={dd_model}, preparation={prep_model}. "
            "Comparison may be confounded by different model versions."
        )

    direct_report = evaluate_xtrareg_chain(gold, pinned_source, direct_draft_candidate)
    prep_report = evaluate_xtrareg_chain(gold, pinned_source, preparation_candidate)

    d_hold = direct_report["splits"]["HOLDOUT"]["metrics"]
    p_hold = prep_report["splits"]["HOLDOUT"]["metrics"]
    p_crit = sum(prep_report["splits"]["HOLDOUT"]["criticalErrorCounts"].values())
    d_crit = sum(direct_report["splits"]["HOLDOUT"]["criticalErrorCounts"].values())

    deltas = {
        "strictRecallDelta": p_hold["strictRecall"] - d_hold["strictRecall"],
        "lenientRecallDelta": p_hold["lenientRecall"] - d_hold["lenientRecall"],
        "groundingRateDelta": p_hold["groundingRate"] - d_hold["groundingRate"],
        "exceptionPreservationDelta": p_hold["exceptionPreservationRate"] - d_hold["exceptionPreservationRate"],
        "duplicationRateDelta": p_hold["duplicationRate"] - d_hold["duplicationRate"],
        "criticalErrorDelta": p_crit - d_crit,
    }

    # P1-05 / P0-01: Semantic gain requires ALL of these conditions (not just one positive delta):
    # 1. Zero critical errors in FULL_PREPARATION holdout.
    # 2. strictRecallDelta >= 0 (no regression in recall).
    # 3. exceptionPreservationDelta >= 0 (no regression in exception coverage).
    # 4. criticalErrorDelta <= 0 (no new critical errors introduced).
    # 5. At least one metric strictly improved (> 0).
    # 6. The gold corpus is independently reviewed (synthetic corpora always block gain claims).
    is_accepted_corpus = not prep_report.get("acceptanceWarnings")
    gain_supported = (
        is_accepted_corpus
        and p_crit == 0
        and deltas["criticalErrorDelta"] <= 0
        and deltas["strictRecallDelta"] >= 0
        and deltas["exceptionPreservationDelta"] >= 0
        and (
            deltas["strictRecallDelta"] > 0
            or deltas["exceptionPreservationDelta"] > 0
            or deltas["groundingRateDelta"] > 0
        )
    )
    if not is_accepted_corpus:
        reason = (
            "Semantic gain NOT claimed: gold corpus is SYNTHETIC_NOT_REVIEWED — "
            "only an independently reviewed corpus can support acceptance claims. "
            "Scorer arithmetic is valid for diagnostic purposes only."
        )
    elif not gain_supported:
        reason = "Holdout data does not support claiming a semantic gain (equal or negative delta, or critical errors present)."
    else:
        reason = "Holdout metrics show positive semantic gain with zero critical errors."

    return {
        "schemaVersion": "XTRAREG_MODE_COMPARISON_V1",
        "legalSourceVersionId": gold_source_version,
        "directDraft": direct_report,
        "fullPreparation": prep_report,
        "holdoutDeltas": deltas,
        "semanticGainClaimed": gain_supported,
        "gainAssessmentReason": reason,
        **({"modelParityWarning": model_parity_warning} if model_parity_warning else {}),
    }
