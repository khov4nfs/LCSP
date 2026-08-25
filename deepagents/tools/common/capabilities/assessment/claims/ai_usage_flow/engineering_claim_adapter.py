"""Adapt validated EngineeringRule investigation claims into the governed AIUsageFlow."""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from .ai_usage_flow_rule_engine import (
    AIUsageFlow,
    AIUsageFlowClaim,
    AIUsageFlowRuleEngine,
)


class EngineeringClaimAdapter:
    """Carry validated engineering facts forward without re-interpreting them.

    The law-guided investigator may synthesize engineering facts, but it may not
    decide legal applicability, compliance, violation, or risk tier. This adapter
    preserves that boundary: it only projects already validated EvidenceClaims
    from TechnicalProfile into AIUsageFlow so reconciliation and VerifiedProfile
    can use the same immutable evidence refs later.
    """

    def apply(
        self,
        *,
        flow: AIUsageFlow,
        technical_profile: dict[str, Any],
    ) -> AIUsageFlow:
        investigation = technical_profile.get("engineering_investigation")
        if not isinstance(investigation, dict):
            return flow

        status = str(investigation.get("status") or "UNKNOWN").upper()
        raw_claims = investigation.get("claims")
        rows = raw_claims if isinstance(raw_claims, list) else []
        projected: list[AIUsageFlowClaim] = []
        invalid_claim_count = 0
        for row in rows:
            claim = self._project(flow.ai_usage_flow_id, row)
            if claim is None:
                invalid_claim_count += 1
                continue
            projected.append(claim)

        reasons = list(flow.uncertainty_reasons)
        reasons.extend(
            str(value)
            for value in investigation.get("limitations") or []
            if str(value)
        )
        if invalid_claim_count:
            reasons.append(
                f"ENGINEERING_INVESTIGATION_INVALID_CLAIMS:{invalid_claim_count}"
            )
        if status in {"PARTIAL", "NOT_RUN", "FAILED", "UNKNOWN"}:
            reasons.append(f"ENGINEERING_INVESTIGATION_{status}")

        combined_claims = self._deduplicate([*flow.claims, *projected])
        next_status = flow.status
        if next_status not in {"BLOCKED", "CONFLICTED"} and any(
            reason.startswith("ENGINEERING_INVESTIGATION_") for reason in reasons
        ):
            next_status = "UNCLEAR"

        return replace(
            flow,
            claims=combined_claims,
            status=next_status,
            uncertainty_reasons=sorted(set(reasons)),
        )

    def _project(
        self,
        flow_id: str,
        value: object,
    ) -> AIUsageFlowClaim | None:
        if not isinstance(value, dict):
            return None
        claim_id = str(value.get("claim_id") or value.get("claimId") or "").strip()
        claim_type = str(value.get("claim_type") or value.get("claimType") or "").strip()
        engineering_rule_id = str(
            value.get("engineering_rule_id")
            or value.get("engineeringRuleId")
            or ""
        ).strip()
        refs = self._strings(value.get("evidence_refs") or value.get("evidenceRefs"))
        limitations = self._strings(value.get("limitations"))
        try:
            confidence = float(value.get("confidence", 0.0))
        except (TypeError, ValueError):
            return None
        if (
            not claim_id
            or not claim_type
            or not engineering_rule_id
            or not refs
            or confidence < 0.0
            or confidence > 1.0
        ):
            return None

        raw_value = value.get("value")
        claim_value = (
            dict(raw_value)
            if isinstance(raw_value, dict)
            else {claim_type: raw_value}
        )
        claim_value["engineeringRuleId"] = engineering_rule_id
        lifecycle = (
            "VALIDATED"
            if confidence >= 0.75 and not limitations
            else "ABSTAINED"
        )
        uncertainty = list(limitations)
        if confidence < 0.75:
            uncertainty.append("ENGINEERING_CLAIM_CONFIDENCE_BELOW_VALIDATION_THRESHOLD")

        return AIUsageFlowClaim(
            claim_id=claim_id,
            ai_usage_flow_id=flow_id,
            claim_category="ENGINEERING_EVIDENCE",
            claim_field=claim_type.lower(),
            claim_value=claim_value,
            lifecycle_state=lifecycle,
            evidence_refs=refs,
            confidence=confidence,
            confidence_breakdown={"engineering_investigation": confidence},
            uncertainty_reasons=sorted(set(uncertainty)),
        )

    @staticmethod
    def _strings(value: object) -> list[str]:
        if not isinstance(value, (list, tuple)):
            return []
        return sorted({str(item) for item in value if str(item)})

    @staticmethod
    def _deduplicate(claims: list[AIUsageFlowClaim]) -> list[AIUsageFlowClaim]:
        by_id: dict[str, AIUsageFlowClaim] = {}
        for claim in claims:
            if claim.claim_id in by_id:
                raise ValueError(f"duplicate AIUsageFlow claim id: {claim.claim_id}")
            by_id[claim.claim_id] = claim
        return list(by_id.values())


class EngineeringAwareAIUsageFlowRuleEngine:
    """Compose deterministic AI usage rules with validated engineering claims."""

    def __init__(
        self,
        base_engine: AIUsageFlowRuleEngine | None = None,
        adapter: EngineeringClaimAdapter | None = None,
    ) -> None:
        self._base_engine = base_engine or AIUsageFlowRuleEngine()
        self._adapter = adapter or EngineeringClaimAdapter()

    def generate(
        self,
        *,
        technical_profile: dict[str, Any] | None,
        evidence_report: dict[str, Any] | None,
        wizard_profile: dict[str, Any] | None,
    ) -> AIUsageFlow:
        flow = self._base_engine.generate(
            technical_profile=technical_profile,
            evidence_report=evidence_report,
            wizard_profile=wizard_profile,
        )
        if not technical_profile:
            return flow
        return self._adapter.apply(
            flow=flow,
            technical_profile=technical_profile,
        )
