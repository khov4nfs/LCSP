from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


SCHEMA_VERSION = "1.0.0"
DEFAULT_PROVIDER_VERSION = "lcsp.verified-profile-worker.v1"
TECHNICAL_ONLY = "TECHNICAL_ONLY"
TECHNICAL_PLUS_WIZARD = "TECHNICAL_PLUS_WIZARD"
NON_MATERIAL_STATES = {"REJECTED", "UNKNOWN", "BLOCKED"}
LEGAL_MATCH_ELIGIBLE_STATES = {"VALIDATED", "VERIFIED"}
LEGAL_MATCH_MIN_CONFIDENCE = 0.75


@dataclass(frozen=True)
class VerifiedProfileData:
    verified_claims: list[dict[str, Any]]
    merged_profile: dict[str, Any]
    fact_evidence_refs: dict[str, list[str]]
    evidence_refs: list[str]
    verification_source: str
    wizard_context: dict[str, Any] | None
    conflict_resolutions: list[dict[str, Any]] = field(default_factory=list)
    gates_passed_at: dict[str, str] = field(default_factory=dict)
    evidence_chain_integrity: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class VerifiedProfileBuilder:
    def build(
        self,
        *,
        ai_usage_flow: dict[str, Any],
        conflict_records: list[dict[str, Any]],
        wizard_profile: dict[str, Any] | None,
        conflicts_resolved_at: str,
    ) -> VerifiedProfileData:
        verification_source = self._verification_source(ai_usage_flow, wizard_profile)
        verified_claims = self._claims(ai_usage_flow)
        wizard_context = self._wizard_context(wizard_profile, verification_source)
        fact_evidence_refs = self._fact_evidence_refs(verified_claims)

        # This worker finalizes evidence-backed claims; it never infers or
        # creates claims beyond the AIUsageFlow artifact it was handed.
        profile = VerifiedProfileData(
            verified_claims=verified_claims,
            merged_profile=self._merged_profile(verified_claims, wizard_context),
            fact_evidence_refs=fact_evidence_refs,
            evidence_refs=sorted(
                {
                    ref
                    for refs in fact_evidence_refs.values()
                    for ref in refs
                    if ref
                }
            ),
            verification_source=verification_source,
            wizard_context=wizard_context,
            conflict_resolutions=self._conflict_resolutions(
                conflict_records,
                verification_source,
            ),
            gates_passed_at={"conflicts_resolved": conflicts_resolved_at},
            evidence_chain_integrity=self._evidence_chain_integrity(verified_claims),
        )
        return profile

    def _claims(self, ai_usage_flow: dict[str, Any]) -> list[dict[str, Any]]:
        flow_data = ai_usage_flow.get("flow_data") or ai_usage_flow.get("flowData")
        raw_claims = ai_usage_flow.get("claims")
        if raw_claims is None and isinstance(flow_data, dict):
            raw_claims = flow_data.get("claims")
        return [dict(claim) for claim in raw_claims or [] if isinstance(claim, dict)]

    def _merged_profile(
        self,
        claims: list[dict[str, Any]],
        wizard_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        merged: dict[str, Any] = {}
        if wizard_context:
            answers = wizard_context.get("answers")
            if isinstance(answers, dict):
                merged.update(answers)

        for claim in claims:
            claim_value = claim.get("claim_value") or claim.get("claimValue")
            if not isinstance(claim_value, dict):
                continue
            for key, value in claim_value.items():
                if isinstance(key, str) and key:
                    merged[key] = value
        return merged

    def _fact_evidence_refs(
        self,
        claims: list[dict[str, Any]],
    ) -> dict[str, list[str]]:
        mapped: dict[str, set[str]] = {}
        for claim in claims:
            if not self._is_legal_match_eligible_claim(claim):
                continue
            claim_value = claim.get("claim_value") or claim.get("claimValue")
            if not isinstance(claim_value, dict):
                continue
            refs = self._evidence_refs(claim)
            for key in claim_value:
                if isinstance(key, str) and key:
                    mapped.setdefault(key, set()).update(refs)
        return {key: sorted(refs) for key, refs in sorted(mapped.items())}

    def _is_legal_match_eligible_claim(self, claim: dict[str, Any]) -> bool:
        state = str(
            claim.get("lifecycle_state")
            or claim.get("lifecycleState")
            or ""
        ).upper()
        conflict_refs = claim.get("conflict_refs") or claim.get("conflictRefs") or []
        return (
            self._is_material_claim(claim)
            and state in LEGAL_MATCH_ELIGIBLE_STATES
            and self._numeric_confidence(claim) >= LEGAL_MATCH_MIN_CONFIDENCE
            and bool(self._evidence_refs(claim))
            and not conflict_refs
        )

    def _numeric_confidence(self, claim: dict[str, Any]) -> float:
        value = claim.get("claim_confidence")
        if value is None:
            value = claim.get("claimConfidence")
        if value is None and isinstance(claim.get("confidence"), (int, float)):
            value = claim.get("confidence")
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def _verification_source(
        self,
        ai_usage_flow: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
    ) -> str:
        flow_data = ai_usage_flow.get("flow_data") or ai_usage_flow.get("flowData")
        if isinstance(flow_data, dict):
            value = flow_data.get("verification_source") or flow_data.get(
                "verificationSource"
            )
        else:
            value = None
        value = (
            value
            or ai_usage_flow.get("verification_source")
            or ai_usage_flow.get("verificationSource")
        )
        if value in {TECHNICAL_ONLY, TECHNICAL_PLUS_WIZARD}:
            return str(value)
        return TECHNICAL_PLUS_WIZARD if wizard_profile else TECHNICAL_ONLY

    def _wizard_context(
        self,
        wizard_profile: dict[str, Any] | None,
        verification_source: str,
    ) -> dict[str, Any] | None:
        if verification_source == TECHNICAL_ONLY or wizard_profile is None:
            return None
        answers = wizard_profile.get("answers")
        return {
            "wizard_profile_id": wizard_profile.get("id")
            or wizard_profile.get("wizard_profile_id")
            or wizard_profile.get("wizardProfileId"),
            "version": wizard_profile.get("version")
            or wizard_profile.get("schema_version")
            or wizard_profile.get("schemaVersion"),
            "answers": dict(answers) if isinstance(answers, dict) else {},
        }

    def _conflict_resolutions(
        self,
        conflict_records: list[dict[str, Any]],
        verification_source: str,
    ) -> list[dict[str, Any]]:
        if verification_source == TECHNICAL_ONLY:
            return []
        return [
            self._resolution_summary(record)
            for record in conflict_records
            if isinstance(record, dict)
        ]

    def _resolution_summary(self, record: dict[str, Any]) -> dict[str, Any]:
        # Manager notes can be free-form sensitive text. Keep only structured
        # resolution metadata needed to prove the gate was passed.
        return {
            "conflict_id": record.get("conflict_id") or record.get("conflictId"),
            "conflict_type": record.get("conflict_type") or record.get("conflictType"),
            "affected_claim_id": record.get("affected_claim_id")
            or record.get("affectedClaimId"),
            "affected_claim_field": record.get("affected_claim_field")
            or record.get("affectedClaimField"),
            "status": record.get("status"),
            "resolution": record.get("resolution"),
            "resolved_at": record.get("resolved_at") or record.get("resolvedAt"),
            "evidence_refs": self._evidence_refs(record),
        }

    def _evidence_chain_integrity(self, claims: list[dict[str, Any]]) -> bool:
        material_claims = [claim for claim in claims if self._is_material_claim(claim)]
        return all(bool(self._evidence_refs(claim)) for claim in material_claims)

    def _is_material_claim(self, claim: dict[str, Any]) -> bool:
        if claim.get("is_material") is False:
            return False
        state = str(
            claim.get("lifecycle_state")
            or claim.get("lifecycleState")
            or ""
        ).upper()
        return bool(state) and state not in NON_MATERIAL_STATES

    def _evidence_refs(self, item: dict[str, Any]) -> list[str]:
        refs = item.get("evidence_refs") or item.get("evidenceRefs") or []
        if not isinstance(refs, list):
            return []
        return sorted({str(ref) for ref in refs if ref})
