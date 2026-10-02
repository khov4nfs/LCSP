"""The deterministic rule-completion gate.

A rule may have several criteria. It is valid to analyse a strongly covered criterion
while another one waits (for a customer answer, for a reanalysis, for an upstream fact),
and to keep a criterion-level finding for it. It is NOT valid for that partial result to
produce a terminal whole-rule conclusion.

Each rule arrives as an item ``{ruleId, ruleConclusionReady, unresolvedCriterionIds,
activeNeedIds, applicability, contextRevision}``. This gate enforces it, after the
evaluator and before anything is aggregated or persisted, so it does not depend on a
model behaving:

    ruleConclusionReady == True   -> the evaluation is unchanged
    ruleConclusionReady == False  -> COMPLIANT / NON_COMPLIANT become UNKNOWN

UNKNOWN is the existing "no conclusion" state. NOT_APPLICABLE is untouched: it is a legal
applicability outcome that does not depend on criteria being complete. The withheld
result carries its provenance: which criteria are not ready, which customer needs are
active and the context revision it was withheld under.

A rule that is held back before analysis at all (waiting on a customer need, blocked by
an applicability fact, pending an upstream fact) gets an explicit UNKNOWN evaluation as
well, so an earlier terminal result for the same rule is superseded rather than left
standing next to an active need.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from tools.common.capabilities.platform.logging import get_logger

from .rule_evaluator import ENGINEERING_RULE_EVALUATION_STATUSES, EngineeringRuleEvaluation

logger = get_logger(__name__)

_TERMINAL_CONCLUSIONS = frozenset(
    {
        ENGINEERING_RULE_EVALUATION_STATUSES["compliant"],
        ENGINEERING_RULE_EVALUATION_STATUSES["non_compliant"],
    }
)


def rule_completion_provenance(item: Mapping[str, Any]) -> dict[str, Any]:
    """Why a rule can not conclude yet, in identifiers only."""
    return {
        "ruleId": item.get("ruleId"),
        "ruleConclusionReady": bool(item.get("ruleConclusionReady")),
        "unresolvedCriterionIds": sorted(str(c) for c in item.get("unresolvedCriterionIds") or ()),
        "activeNeedIds": sorted(str(n) for n in item.get("activeNeedIds") or ()),
        "applicability": item.get("applicability"),
        "contextRevision": int(item.get("contextRevision") or 0),
    }


def withheld_limitations(item: Mapping[str, Any]) -> tuple[str, ...]:
    """Typed limitation codes for a withheld conclusion (closed set)."""
    codes = [ENGINEERING_LIMITATION_CODES["rule_conclusion_withheld"]]
    need_ids = [str(n) for n in item.get("activeNeedIds") or ()]
    if need_ids:
        codes.append(ENGINEERING_LIMITATION_CODES["active_customer_condition_pending"])
    # Need ids are minted as ``need:{ruleId}:{criterionId}:{hash}``: a criterion with an
    # active need waits for the customer; any other unresolved criterion is technical.
    technical = [
        c
        for c in item.get("unresolvedCriterionIds") or ()
        if not any(f":{c}:" in need for need in need_ids)
    ]
    if technical:
        codes.append(ENGINEERING_LIMITATION_CODES["criterion_reanalysis_pending"])
    if item.get("applicability") == "UPSTREAM_FACT_PENDING":
        codes.append(ENGINEERING_LIMITATION_CODES["upstream_applicability_fact_pending"])
    return tuple(dict.fromkeys(codes))


def apply_rule_completion_gate(
    evaluation: EngineeringRuleEvaluation,
    item: Mapping[str, Any] | None,
) -> tuple[EngineeringRuleEvaluation, dict[str, Any] | None]:
    """The evaluation to keep, and the provenance when a conclusion was withheld.

    An item without ``ruleConclusionReady`` is left alone.
    """
    if not isinstance(item, Mapping) or "ruleConclusionReady" not in item:
        return evaluation, None
    if item.get("ruleConclusionReady"):
        return evaluation, None
    provenance = rule_completion_provenance(item)
    limitations = tuple(dict.fromkeys([*evaluation.limitations, *withheld_limitations(item)]))
    if evaluation.status in _TERMINAL_CONCLUSIONS:
        provenance["withheldStatus"] = evaluation.status
        gated = replace(
            evaluation,
            status=ENGINEERING_RULE_EVALUATION_STATUSES["unknown"],
            reason=(
                "Conclusion withheld: not every material criterion of this rule is ready "
                f"({len(provenance['unresolvedCriterionIds'])} unresolved)."
            ),
            confidence=0.0,
            limitations=limitations,
        )
        logger.info(
            "RULE_CONCLUSION_WITHHELD",
            ruleId=item.get("ruleId"),
            withheldStatus=evaluation.status,
            unresolvedCriterionCount=len(provenance["unresolvedCriterionIds"]),
            activeNeedCount=len(provenance["activeNeedIds"]),
            contextRevision=provenance["contextRevision"],
        )
        return gated, provenance
    if evaluation.status == ENGINEERING_RULE_EVALUATION_STATUSES["unknown"]:
        return replace(evaluation, limitations=limitations), provenance
    return evaluation, None


def deferred_evaluation(
    engineering_rule: Any,
    item: Mapping[str, Any],
) -> tuple[EngineeringRuleEvaluation, dict[str, Any]]:
    """An explicit UNKNOWN for a rule held back before it could be analysed."""
    provenance = rule_completion_provenance(item)
    evaluation = EngineeringRuleEvaluation(
        engineering_rule_id=str(getattr(engineering_rule, "engineering_rule_id", item.get("ruleId"))),
        legal_rule_id=str(getattr(engineering_rule, "legal_rule_id", "")),
        concept=str(getattr(engineering_rule, "concept", "")),
        status=ENGINEERING_RULE_EVALUATION_STATUSES["unknown"],
        reason="Not concluded: the rule is waiting for input that has not been provided or resolved.",
        evidence_refs=(),
        source_chunk_ids=tuple(getattr(engineering_rule, "source_chunk_ids", ()) or ()),
        source_locators=tuple(getattr(engineering_rule, "source_locators", ()) or ()),
        confidence=0.0,
        limitations=withheld_limitations(item),
    )
    return evaluation, provenance


__all__ = [
    "apply_rule_completion_gate",
    "deferred_evaluation",
    "rule_completion_provenance",
    "withheld_limitations",
]
