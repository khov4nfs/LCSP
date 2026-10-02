"""Assessment result carried from the per-rule loop to the classification callback."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from tools.common.capabilities.assessment.claims.evidence_claim.models import EvidenceClaim
from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_evaluator import (
    ENGINEERING_RULE_EVALUATION_STATUSES,
    EngineeringRuleEvaluation,
)


@dataclass(frozen=True)
class EngineeringInvestigationResult:
    """Canonical direct assessment output produced from the Program Evidence Graph."""

    status: str
    legal_rule_catalog_version_id: str
    legal_corpus_version_id: str
    rules_considered: int
    engineering_rules_executed: int
    engineering_rule_cache_hits: int
    claims: tuple[EvidenceClaim, ...] = ()
    evaluations: tuple[EngineeringRuleEvaluation, ...] = ()
    limitations: tuple[str, ...] = ()
    technical_evidence_by_rule: dict[str, tuple[dict[str, Any], ...]] = field(
        default_factory=dict
    )
    observability: dict[str, Any] = field(default_factory=dict)

    def to_assessment_data(self) -> dict[str, Any]:
        evaluations: list[dict[str, Any]] = []
        for evaluation in self.evaluations:
            payload = evaluation.to_dict()
            payload["technical_evidence"] = list(
                self.technical_evidence_by_rule.get(
                    evaluation.engineering_rule_id,
                    (),
                )
            )
            evaluations.append(payload)
        return {
            "mode": "ENGINEERING_RULE_EVALUATION",
            "status": self.status,
            "legal_rule_catalog_version_id": self.legal_rule_catalog_version_id,
            "legal_corpus_version_id": self.legal_corpus_version_id,
            "rules_considered": self.rules_considered,
            "engineering_rules_executed": self.engineering_rules_executed,
            "engineering_rule_cache_hits": self.engineering_rule_cache_hits,
            "summary": {
                "compliant": sum(
                    1 for item in self.evaluations if item.status == "COMPLIANT"
                ),
                "non_compliant": sum(
                    1 for item in self.evaluations if item.status == "NON_COMPLIANT"
                ),
                "unknown": sum(
                    1 for item in self.evaluations if item.status == "UNKNOWN"
                ),
                "not_applicable": sum(
                    1
                    for item in self.evaluations
                    if item.status
                    == ENGINEERING_RULE_EVALUATION_STATUSES["not_applicable"]
                ),
                "total": len(self.evaluations),
            },
            "evaluations": evaluations,
            "claims": [claim.to_dict() for claim in self.claims],
            "limitations": list(self.limitations),
            "observability": {
                **dict(self.observability),
                "provenance": self._provenance_summary(evaluations),
            },
        }

    # Compatibility for any tests/readers still calling the old method name. The
    # payload is no longer persisted as TechnicalProfile data.
    def to_profile_data(self) -> dict[str, Any]:
        return self.to_assessment_data()

    def _provenance_summary(
        self,
        evaluation_payloads: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "claim_count": len(self.claims),
            "claims_with_evidence": sum(
                1
                for claim in self.claims
                if claim.evidence_refs
                or claim.graph_path_refs
                or claim.source_anchor_refs
                or claim.source_locations
                or claim.customer_context_refs
            ),
            "evaluations_with_evidence": sum(
                1
                for item in evaluation_payloads
                if item.get("evidence_refs")
                or item.get("graph_path_refs")
                or item.get("source_anchor_refs")
                or item.get("technical_evidence")
            ),
            "evaluations_with_displayable_technical_evidence": sum(
                1 for item in evaluation_payloads if item.get("technical_evidence")
            ),
        }


__all__ = ["EngineeringInvestigationResult"]
