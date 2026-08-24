"""Deterministically turn validated engineering claims into rule outcomes."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterable

from tools.legal.legal.engineering_rules.models import EngineeringRule

from tools.planner.investigation.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)


ENGINEERING_RULE_EVALUATION_STATUSES = {
    "compliant": "COMPLIANT",
    "non_compliant": "NON_COMPLIANT",
    "unknown": "UNKNOWN",
}


@dataclass(frozen=True)
class EngineeringRuleEvaluation:
    engineering_rule_id: str
    legal_rule_id: str
    concept: str
    status: str
    reason: str
    evidence_refs: tuple[str, ...]
    source_chunk_ids: tuple[str, ...]
    source_locators: tuple[str, ...]
    confidence: float
    limitations: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class EngineeringRuleEvaluator:
    """Evaluate one EngineeringRule without allowing the LLM to be the final gate."""

    def evaluate(
        self,
        rule: EngineeringRule,
        claims: Iterable[EvidenceClaim],
    ) -> EngineeringRuleEvaluation:
        rows = list(claims)
        limitations = tuple(
            sorted({item for row in rows for item in row.limitations if item})
        )
        # Real EngineeringRule instances always expose required_evidence. Keep the
        # deterministic evaluator compatible with older pipeline fixtures/adapters
        # that intentionally provide only the historical minimal rule projection.
        required_criteria = tuple(
            dict.fromkeys(getattr(rule, "required_evidence", ()) or ())
        )

        if required_criteria:
            return self._evaluate_required_criteria(
                rule,
                rows,
                required_criteria,
                limitations,
            )

        # Compatibility for EngineeringRules without explicit requiredEvidence.
        failed = [
            row
            for row in rows
            if row.claim_type
            == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"]
        ]
        passed = [
            row
            for row in rows
            if row.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]
        ]
        unresolved = [
            row
            for row in rows
            if row.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
            and self._has_evidence(row)
        ]

        if failed and passed:
            return self._result(
                rule,
                ENGINEERING_RULE_EVALUATION_STATUSES["unknown"],
                "Conflicting evidence supports both satisfied and unsatisfied control states.",
                rows,
                (
                    ENGINEERING_LIMITATION_CODES[
                        "conflicting_engineering_evidence"
                    ],
                ),
            )

        if failed:
            backed = [row for row in failed if self._has_evidence(row)]
            if backed:
                return self._result(
                    rule,
                    ENGINEERING_RULE_EVALUATION_STATUSES["non_compliant"],
                    "Repository evidence demonstrates that the engineering requirement is not met.",
                    backed,
                    (),
                )
            unresolved.append(failed[0])

        if passed:
            backed = [row for row in passed if self._has_evidence(row)]
            if backed and not unresolved:
                return self._result(
                    rule,
                    ENGINEERING_RULE_EVALUATION_STATUSES["compliant"],
                    "Repository evidence demonstrates that the engineering requirement is met.",
                    backed,
                    (),
                )

        return self._unknown(rule, rows, limitations)

    def _evaluate_required_criteria(
        self,
        rule: EngineeringRule,
        rows: list[EvidenceClaim],
        required_criteria: tuple[str, ...],
        limitations: tuple[str, ...],
    ) -> EngineeringRuleEvaluation:
        """Aggregate only closed EngineeringRule requiredEvidence criteria.

        A rule is compliant only when every required criterion is backed by a MET claim.
        A backed NOT_MET on any required criterion is non-compliant unless that same
        criterion also has conflicting backed MET evidence. Missing, scoped unresolved,
        invalid, or provenance-backed unscoped claims fail closed to UNKNOWN. An
        evidence-less generic UNRESOLVED emitted beside already-backed required claims is
        ignored so model hedging cannot poison a deterministic positive result.
        """
        groups: dict[str, list[EvidenceClaim]] = {
            criterion: [] for criterion in required_criteria
        }
        unscoped: list[EvidenceClaim] = []
        for row in rows:
            criterion = self._criterion_for(row, required_criteria)
            if criterion is None:
                if (
                    row.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                    and not self._has_evidence(row)
                ):
                    continue
                unscoped.append(row)
            else:
                groups[criterion].append(row)

        satisfied: list[EvidenceClaim] = []
        unresolved_required = bool(unscoped)
        scoped_limitations = [
            item
            for row in rows
            if not (
                row.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                and not self._has_evidence(row)
            )
            for item in row.limitations
            if item
        ]

        for criterion in required_criteria:
            criterion_rows = groups[criterion]
            failed = [
                row
                for row in criterion_rows
                if row.claim_type
                == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"]
                and self._has_evidence(row)
            ]
            passed = [
                row
                for row in criterion_rows
                if row.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]
                and self._has_evidence(row)
            ]
            unresolved = [
                row
                for row in criterion_rows
                if row.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                and self._has_evidence(row)
            ]

            if failed and passed:
                return self._result(
                    rule,
                    ENGINEERING_RULE_EVALUATION_STATUSES["unknown"],
                    "Conflicting evidence supports both satisfied and unsatisfied control states.",
                    criterion_rows,
                    (
                        ENGINEERING_LIMITATION_CODES[
                            "conflicting_engineering_evidence"
                        ],
                    ),
                )

            if failed:
                return self._result(
                    rule,
                    ENGINEERING_RULE_EVALUATION_STATUSES["non_compliant"],
                    "Repository evidence demonstrates that the engineering requirement is not met.",
                    failed,
                    (),
                )

            if passed and not unresolved:
                satisfied.extend(passed)
                continue

            unresolved_required = True

        if not unresolved_required and len(groups) == len(required_criteria):
            return self._result(
                rule,
                ENGINEERING_RULE_EVALUATION_STATUSES["compliant"],
                "Repository evidence demonstrates that the engineering requirement is met.",
                satisfied,
                (),
            )

        if ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"] not in scoped_limitations:
            scoped_limitations.append(
                ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
            )
        return self._unknown(
            rule,
            rows,
            tuple(scoped_limitations),
        )

    @staticmethod
    def _criterion_for(
        claim: EvidenceClaim,
        required_criteria: tuple[str, ...],
    ) -> str | None:
        if claim.criterion in required_criteria:
            return claim.criterion
        if claim.criterion is None and len(required_criteria) == 1:
            return required_criteria[0]
        return None

    @staticmethod
    def _has_evidence(claim: EvidenceClaim) -> bool:
        return bool(
            claim.evidence_refs or claim.graph_path_refs or claim.source_anchor_refs
        )

    def _unknown(
        self,
        rule: EngineeringRule,
        claims: list[EvidenceClaim],
        limitations: tuple[str, ...],
    ) -> EngineeringRuleEvaluation:
        return self._result(
            rule,
            ENGINEERING_RULE_EVALUATION_STATUSES["unknown"],
            "Available repository evidence is insufficient to determine this engineering requirement.",
            claims,
            limitations
            or (
                ENGINEERING_LIMITATION_CODES[
                    "engineering_evidence_insufficient"
                ],
            ),
        )

    @staticmethod
    def _result(
        rule: EngineeringRule,
        status: str,
        reason: str,
        claims: list[EvidenceClaim],
        extra_limitations: tuple[str, ...],
    ) -> EngineeringRuleEvaluation:
        confidence = max((row.confidence for row in claims), default=0.0)
        confidence = max(0.0, min(1.0, float(confidence)))
        evidence_refs = tuple(
            sorted(
                {
                    ref
                    for row in claims
                    for ref in (
                        *row.evidence_refs,
                        *row.graph_path_refs,
                        *row.source_anchor_refs,
                    )
                    if ref
                }
            )
        )
        claim_limitations = tuple(
            item
            for row in claims
            for item in row.limitations
            if item
        )
        return EngineeringRuleEvaluation(
            engineering_rule_id=rule.engineering_rule_id,
            legal_rule_id=rule.legal_rule_id,
            concept=rule.concept,
            status=status,
            reason=reason,
            evidence_refs=evidence_refs,
            source_chunk_ids=rule.source_chunk_ids,
            source_locators=rule.source_locators,
            confidence=confidence,
            limitations=tuple(
                dict.fromkeys((*claim_limitations, *extra_limitations))
            ),
        )
