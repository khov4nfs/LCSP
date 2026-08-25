from __future__ import annotations

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)
from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_evaluator import (
    ENGINEERING_RULE_EVALUATION_STATUSES,
    EngineeringRuleEvaluator,
)
from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule


def _rule(*criteria: str) -> EngineeringRule:
    return EngineeringRule(
        engineering_rule_id="eng-1",
        legal_rule_id="law-1",
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        concept="HUMAN_OVERSIGHT",
        legal_intent={},
        investigation_goals=("Evaluate required controls",),
        starting_node_types=("AI_OUTPUT",),
        target_node_types=("HUMAN_REVIEW",),
        edge_strategies=("CALLS",),
        graph_queries=(),
        required_evidence=tuple(criteria),
    )


def _claim(
    criterion: str | None,
    claim_type: str,
    *,
    evidence: str | None = "evidence:1",
    confidence: float = 0.9,
    limitations: tuple[str, ...] = (),
) -> EvidenceClaim:
    return EvidenceClaim(
        claim_id=f"claim:{criterion}:{claim_type}",
        engineering_rule_id="eng-1",
        claim_type=claim_type,
        value={
            ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]: True,
            ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"]: False,
            ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]: None,
        }[claim_type],
        evidence_refs=(evidence,) if evidence else (),
        confidence=confidence,
        limitations=limitations,
        criterion=criterion,
    )


def test_all_required_criteria_backed_by_met_is_compliant() -> None:
    result = EngineeringRuleEvaluator().evaluate(
        _rule("A", "B"),
        [
            _claim("A", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:a"),
            _claim("B", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:b"),
        ],
    )

    assert result.status == ENGINEERING_RULE_EVALUATION_STATUSES["compliant"]
    assert set(result.evidence_refs) == {"evidence:a", "evidence:b"}


def test_unresolved_required_criterion_keeps_rule_unknown() -> None:
    result = EngineeringRuleEvaluator().evaluate(
        _rule("A", "B"),
        [
            _claim("A", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]),
            _claim(
                "B",
                ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                evidence=None,
                limitations=(ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],),
            ),
        ],
    )

    assert result.status == ENGINEERING_RULE_EVALUATION_STATUSES["unknown"]
    assert ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"] in result.limitations


def test_evidence_less_generic_unresolved_does_not_poison_closed_required_criteria() -> None:
    result = EngineeringRuleEvaluator().evaluate(
        _rule("A", "B"),
        [
            _claim("A", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:a"),
            _claim("B", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:b"),
            _claim(
                None,
                ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                evidence=None,
                limitations=(ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],),
            ),
        ],
    )

    assert result.status == ENGINEERING_RULE_EVALUATION_STATUSES["compliant"]
    assert ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"] not in result.limitations


def test_evidence_less_scoped_unresolved_does_not_override_backed_met_same_criterion() -> None:
    result = EngineeringRuleEvaluator().evaluate(
        _rule("A"),
        [
            _claim("A", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:a"),
            _claim(
                "A",
                ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                evidence=None,
                limitations=(ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],),
            ),
        ],
    )

    assert result.status == ENGINEERING_RULE_EVALUATION_STATUSES["compliant"]
    assert ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"] not in result.limitations


def test_provenance_backed_unscoped_claim_in_multi_criterion_rule_fails_closed() -> None:
    result = EngineeringRuleEvaluator().evaluate(
        _rule("A", "B"),
        [
            _claim("A", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:a"),
            _claim("B", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:b"),
            _claim(None, ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"], evidence="evidence:unknown"),
        ],
    )

    assert result.status == ENGINEERING_RULE_EVALUATION_STATUSES["unknown"]


def test_backed_not_met_on_one_required_criterion_is_non_compliant() -> None:
    result = EngineeringRuleEvaluator().evaluate(
        _rule("A", "B"),
        [
            _claim("A", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"], evidence="evidence:negative"),
            _claim("B", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:positive"),
        ],
    )

    assert result.status == ENGINEERING_RULE_EVALUATION_STATUSES["non_compliant"]


def test_conflicting_backed_claims_for_same_required_criterion_are_unknown() -> None:
    result = EngineeringRuleEvaluator().evaluate(
        _rule("A"),
        [
            _claim("A", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"], evidence="evidence:yes"),
            _claim("A", ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"], evidence="evidence:no"),
        ],
    )

    assert result.status == ENGINEERING_RULE_EVALUATION_STATUSES["unknown"]
    assert ENGINEERING_LIMITATION_CODES["conflicting_engineering_evidence"] in result.limitations


def test_single_required_criterion_accepts_legacy_unscoped_claim_for_compatibility() -> None:
    result = EngineeringRuleEvaluator().evaluate(
        _rule("ONLY"),
        [_claim(None, ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"])],
    )

    assert result.status == ENGINEERING_RULE_EVALUATION_STATUSES["compliant"]
