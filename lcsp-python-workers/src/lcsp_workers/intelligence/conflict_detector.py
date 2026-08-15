"""Detect deterministic conflicts between AI usage evidence and wizard answers."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .conflict_score_calculator import ConflictScoreCalculator


SCHEMA_VERSION = "1.0.0"
DEFAULT_PROVIDER_VERSION = "lcsp.conflict-detection-worker.v1"
LOW_COVERAGE_MARKERS = {"low", "limited", "partial", "unknown"}


@dataclass(frozen=True)
class ConflictRecord:
    """Normalized reconciliation conflict with scoring and provenance metadata."""

    conflict_id: str
    conflict_type: str
    ai_usage_flow_id: str
    assessment_id: str
    affected_claim_id: str
    affected_claim_field: str
    conflicting_source_refs: dict[str, Any]
    evidence_refs: list[str]
    conflict_score: float
    score_explanation: str
    explanation_basis: dict[str, Any]
    confidence: str
    contradiction_severity: str
    source_versions: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        """Serialize the conflict record for callback persistence."""
        return asdict(self)


class ConflictDetector:
    """Compare claims with manager answers and flag material contradictions."""

    def __init__(
        self,
        *,
        provider_version: str = DEFAULT_PROVIDER_VERSION,
        score_calculator: ConflictScoreCalculator | None = None,
    ) -> None:
        """Create the detector with an optional deterministic score calculator."""
        self.provider_version = provider_version
        self._score_calculator = score_calculator or ConflictScoreCalculator()

    def detect(
        self,
        *,
        ai_usage_flow: dict[str, Any] | None,
        wizard_profile: dict[str, Any] | None,
    ) -> list[ConflictRecord]:
        """Detect supported contradiction, scope-mismatch, and unverifiable conflicts.

        Args:
            ai_usage_flow: Accepted AIUsageFlow artifact containing evidence claims.
            wizard_profile: Manager/wizard answers for the same assessment.

        Returns:
            Deterministically constructed conflict records; empty when either
            comparison source is absent or no supported conflict is detected.
        """
        if not ai_usage_flow or not wizard_profile:
            return []

        flow_data = self._flow_data(ai_usage_flow)
        claims = self._claims(ai_usage_flow)
        answers = self._answers(wizard_profile)
        conflicts: list[ConflictRecord] = []

        if self._wizard_external_llm_usage_is_false(answers):
            for claim in claims:
                if self._claim_says_external_llm_usage(claim):
                    conflicts.append(
                        self._build_record(
                            conflict_type="evidence_contradiction",
                            claim=claim,
                            ai_usage_flow=flow_data,
                            wizard_profile=wizard_profile,
                            wizard_answer_ref="answers.external_llm_usage",
                            severity="direct",
                        )
                    )

        if self._wizard_says_no_autonomous_decision(answers):
            for claim in claims:
                if self._claim_says_agent_pattern(claim):
                    conflicts.append(
                        self._build_record(
                            conflict_type="scope_mismatch",
                            claim=claim,
                            ai_usage_flow=flow_data,
                            wizard_profile=wizard_profile,
                            wizard_answer_ref="answers.decision_role",
                            severity="scope_only",
                        )
                    )

        for claim in claims:
            if self._is_high_confidence(claim) and self._low_coverage_only(claim):
                conflicts.append(
                    self._build_record(
                        conflict_type="unverifiable",
                        claim=claim,
                        ai_usage_flow=flow_data,
                        wizard_profile=wizard_profile,
                        wizard_answer_ref="coverage_limitations",
                        severity="partial",
                    )
                )

        return conflicts

    def to_callback_payload(
        self,
        *,
        ai_usage_flow: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """Build the privacy-safe reconciliation callback around detected conflicts."""
        flow_data = self._flow_data(ai_usage_flow)
        return {
            "ai_usage_flow_id": self._flow_id(flow_data),
            "assessment_id": self._assessment_id(flow_data, wizard_profile),
            "schema_version": SCHEMA_VERSION,
            "provider_version": self.provider_version,
            "conflicts": [
                conflict.to_dict()
                for conflict in self.detect(
                    ai_usage_flow=ai_usage_flow,
                    wizard_profile=wizard_profile,
                )
            ],
            "privacy_flags": {
                "containsSourceCode": False,
                "secretsRedacted": True,
            },
        }

    def _build_record(
        self,
        *,
        conflict_type: str,
        claim: dict[str, Any],
        ai_usage_flow: dict[str, Any],
        wizard_profile: dict[str, Any],
        wizard_answer_ref: str,
        severity: str,
    ) -> ConflictRecord:
        """Create one conflict record with stable IDs, score, and source versions."""
        confidence = self._confidence_label(claim)
        score = self._score_calculator.calculate(
            evidence_confidence=confidence,
            contradiction_severity=severity,
        )
        claim_id = self._claim_id(claim)
        flow_id = self._flow_id(ai_usage_flow)
        evidence_refs = self._evidence_refs(claim)
        evidence_context = self._evidence_context(claim, evidence_refs)
        return ConflictRecord(
            conflict_id=f"{flow_id}:{conflict_type}:{claim_id}",
            conflict_type=conflict_type,
            ai_usage_flow_id=flow_id,
            assessment_id=self._assessment_id(ai_usage_flow, wizard_profile),
            affected_claim_id=claim_id,
            affected_claim_field=str(
                claim.get("claim_field") or claim.get("claimField") or "unknown"
            ),
            conflicting_source_refs={
                "ai_usage_flow_claim": claim_id,
                "wizard_profile": wizard_profile.get("id") or wizard_profile.get("wizard_profile_id"),
                "wizard_answer": wizard_answer_ref,
            },
            evidence_refs=evidence_refs,
            conflict_score=score,
            score_explanation=self._score_calculator.explain(
                conflict_type=conflict_type,
                evidence_confidence=confidence,
                contradiction_severity=severity,
            ),
            explanation_basis={
                "affected_field": str(
                    claim.get("claim_field") or claim.get("claimField") or "unknown"
                ),
                "confidence": confidence,
                "materiality_reason": self._materiality_reason(conflict_type),
                "score_priority_explanation": (
                    "This score prioritizes Manager review effort and is not a legal "
                    "risk, compliance status, or final classification."
                ),
                "source_values": {
                    "manager_answer": self._manager_answer_summary(
                        wizard_profile, wizard_answer_ref
                    ),
                    "technical_evidence": self._technical_evidence_summary(
                        conflict_type, claim
                    ),
                },
                "source_refs": {
                    "ai_usage_flow_claim": claim_id,
                    "wizard_profile": str(
                        wizard_profile.get("id")
                        or wizard_profile.get("wizard_profile_id")
                        or "wizard_profile"
                    ),
                    "wizard_answer": wizard_answer_ref,
                },
                "evidence_context": evidence_context,
            },
            confidence=confidence,
            contradiction_severity=severity,
            source_versions={
                "ai_usage_flow_schema_version": ai_usage_flow.get("schema_version")
                or ai_usage_flow.get("schemaVersion"),
                "wizard_profile_version": wizard_profile.get("version")
                or wizard_profile.get("schema_version")
                or wizard_profile.get("schemaVersion"),
            },
        )

    def _flow_data(self, ai_usage_flow: dict[str, Any]) -> dict[str, Any]:
        """Normalize embedded ``flow_data`` while retaining top-level claims."""
        flow_data = ai_usage_flow.get("flow_data") or ai_usage_flow.get("flowData")
        if isinstance(flow_data, dict):
            merged = dict(flow_data)
            merged.setdefault("claims", ai_usage_flow.get("claims"))
            return merged
        return ai_usage_flow

    def _claims(self, ai_usage_flow: dict[str, Any]) -> list[dict[str, Any]]:
        """Extract structured claims from compact or rich AIUsageFlow shapes."""
        flow_data = self._flow_data(ai_usage_flow)
        raw_claims = ai_usage_flow.get("claims") or flow_data.get("claims") or []
        return [claim for claim in raw_claims if isinstance(claim, dict)]

    def _answers(self, wizard_profile: dict[str, Any]) -> dict[str, Any]:
        """Return wizard answers only when represented as a dictionary."""
        answers = wizard_profile.get("answers")
        return answers if isinstance(answers, dict) else {}

    def _wizard_external_llm_usage_is_false(self, answers: dict[str, Any]) -> bool:
        """Recognize supported answer aliases that explicitly deny external AI use."""
        values = [
            answers.get("external_llm_usage"),
            answers.get("externalLlmUsage"),
            answers.get("usesExternalLlm"),
            answers.get("uses_external_llm"),
            answers.get("aiUse"),
            answers.get("usesAi"),
        ]
        return any(self._is_false(value) for value in values)

    def _wizard_says_no_autonomous_decision(self, answers: dict[str, Any]) -> bool:
        """Return whether the wizard explicitly denies autonomous decision-making."""
        value = answers.get("decision_role") or answers.get("decisionRole")
        return str(value or "").lower() == "no_autonomous_decision"

    def _claim_says_external_llm_usage(self, claim: dict[str, Any]) -> bool:
        """Recognize claim values/categories/fields that establish external LLM use."""
        value = claim.get("claim_value") or claim.get("claimValue") or {}
        category = str(claim.get("claim_category") or claim.get("claimCategory") or "")
        field = str(claim.get("claim_field") or claim.get("claimField") or "")
        if isinstance(value, dict):
            explicit_values = [
                value.get("external_llm_usage"),
                value.get("externalLlmUsage"),
                value.get("external_llm_usage_detected"),
                value.get("externalLlmUsageDetected"),
                value.get("invocationDetected"),
            ]
            if any(self._is_true(item) for item in explicit_values):
                return True
        return category in {"MODEL_PROVIDER_USAGE", "MODEL_INVOCATION"} or field in {
            "external_llm_usage",
            "provider_usage",
            "model_invocation",
        }

    def _claim_says_agent_pattern(self, claim: dict[str, Any]) -> bool:
        """Recognize claim shapes that indicate an agent/autonomous-decision pattern."""
        value = claim.get("claim_value") or claim.get("claimValue") or {}
        category = str(claim.get("claim_category") or claim.get("claimCategory") or "")
        field = str(claim.get("claim_field") or claim.get("claimField") or "")
        if category in {"AGENT_PATTERN", "AGENTIC_WORKFLOW"}:
            return True
        if field == "agent_pattern":
            return True
        if isinstance(value, dict):
            return any(
                self._is_true(value.get(key))
                for key in (
                    "agent_pattern",
                    "agentPattern",
                    "autonomousDecisionDetected",
                    "autonomous_decision_detected",
                )
            )
        return False

    def _is_high_confidence(self, claim: dict[str, Any]) -> bool:
        """Apply the configured high-confidence threshold/label convention."""
        raw = claim.get("confidence")
        if isinstance(raw, (int, float)):
            return float(raw) >= 0.8
        return str(raw or "").lower() == "high"

    def _low_coverage_only(self, claim: dict[str, Any]) -> bool:
        """Return whether all available evidence coverage indicators are weak."""
        ref_details = claim.get("evidence_ref_details") or claim.get("evidenceRefDetails")
        if isinstance(ref_details, list) and ref_details:
            coverage_values = [
                str(
                    item.get("coverage")
                    or item.get("coverage_level")
                    or item.get("coverageLevel")
                    or item.get("tool_coverage")
                    or item.get("toolCoverage")
                    or ""
                ).lower()
                for item in ref_details
                if isinstance(item, dict)
            ]
            return bool(coverage_values) and all(
                value in LOW_COVERAGE_MARKERS for value in coverage_values
            )

        coverage = claim.get("evidence_coverage") or claim.get("evidenceCoverage")
        if coverage:
            if isinstance(coverage, list):
                return bool(coverage) and all(
                    str(item).lower() in LOW_COVERAGE_MARKERS for item in coverage
                )
            return str(coverage).lower() in LOW_COVERAGE_MARKERS

        evidence_refs = self._evidence_refs(claim)
        return bool(evidence_refs) and all(
            ref.lower().startswith(("low:", "low-", "limited:", "limited-"))
            for ref in evidence_refs
        )

    def _confidence_label(self, claim: dict[str, Any]) -> str:
        """Normalize numeric/string confidence into high/medium/low/unknown."""
        raw = claim.get("confidence")
        if isinstance(raw, (int, float)):
            value = float(raw)
            if value >= 0.8:
                return "high"
            if value >= 0.55:
                return "medium"
            if value > 0:
                return "low"
        label = str(raw or "unknown").lower()
        return label if label in {"high", "medium", "low"} else "unknown"

    def _claim_id(self, claim: dict[str, Any]) -> str:
        """Resolve a claim identifier from supported field aliases."""
        return str(claim.get("claim_id") or claim.get("claimId") or "claim")

    def _flow_id(self, ai_usage_flow: dict[str, Any]) -> str:
        """Resolve an AIUsageFlow identifier from supported field aliases."""
        return str(
            ai_usage_flow.get("ai_usage_flow_id")
            or ai_usage_flow.get("aiUsageFlowId")
            or ai_usage_flow.get("id")
            or "ai-usage-flow"
        )

    def _assessment_id(
        self,
        ai_usage_flow: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
    ) -> str:
        """Resolve the assessment ID from flow data then wizard context."""
        return str(
            ai_usage_flow.get("assessment_id")
            or ai_usage_flow.get("assessmentId")
            or (wizard_profile or {}).get("assessment_id")
            or (wizard_profile or {}).get("assessmentId")
            or "assessment"
        )

    def _evidence_refs(self, claim: dict[str, Any]) -> list[str]:
        """Normalize a claim's evidence-reference list to strings."""
        refs = claim.get("evidence_refs") or claim.get("evidenceRefs") or []
        return [str(ref) for ref in refs]

    def _materiality_reason(self, conflict_type: str) -> str:
        """Return a business-language reason for why the conflict needs review."""
        if conflict_type == "evidence_contradiction":
            return (
                "Manager answers and technical evidence differ on whether external "
                "AI is used."
            )
        if conflict_type == "scope_mismatch":
            return (
                "Manager answers and technical evidence differ on whether the "
                "system makes autonomous decisions."
            )
        if conflict_type == "unverifiable":
            return (
                "The claim has high confidence but the supporting evidence coverage "
                "is limited."
            )
        return (
            "The AI usage record and Manager answers differ on a material review "
            "point."
        )

    def _manager_answer_summary(
        self, wizard_profile: dict[str, Any], wizard_answer_ref: str
    ) -> str | None:
        """Summarize the relevant wizard answer without copying free-form content."""
        answers = self._answers(wizard_profile)
        if wizard_answer_ref == "answers.external_llm_usage":
            value = (
                answers["external_llm_usage"]
                if "external_llm_usage" in answers
                else answers.get("externalLlmUsage")
            )
            if self._is_false(value):
                return "No external AI use"
            if self._is_true(value):
                return "External AI use"
        if wizard_answer_ref == "answers.decision_role":
            value = answers.get("decision_role") or answers.get("decisionRole")
            if str(value or "").lower() == "no_autonomous_decision":
                return "No autonomous decisions"
            if value:
                return "Decision role provided by Manager"
        return None

    def _technical_evidence_summary(
        self, conflict_type: str, claim: dict[str, Any]
    ) -> str:
        """Summarize technical evidence in business terms."""
        if conflict_type == "evidence_contradiction":
            return "External model invocation detected"
        if conflict_type == "scope_mismatch":
            return "Agent-like workflow detected"
        if conflict_type == "unverifiable":
            return "High-confidence claim with limited evidence coverage"
        field = str(claim.get("claim_field") or claim.get("claimField") or "claim")
        return f"Technical evidence supports {field}"

    def _evidence_context(
        self, claim: dict[str, Any], evidence_refs: list[str]
    ) -> list[dict[str, str]]:
        """Build redacted evidence context and coverage limits for each ref."""
        ref_details = claim.get("evidence_ref_details") or claim.get("evidenceRefDetails")
        details_by_ref: dict[str, dict[str, Any]] = {}
        if isinstance(ref_details, list):
            for item in ref_details:
                if isinstance(item, dict):
                    ref = str(
                        item.get("evidence_ref")
                        or item.get("evidenceRef")
                        or item.get("ref")
                        or ""
                    )
                    if ref:
                        details_by_ref[ref] = item

        contexts: list[dict[str, str]] = []
        for evidence_ref in evidence_refs:
            detail = details_by_ref.get(evidence_ref, {})
            coverage = str(
                detail.get("coverage")
                or detail.get("coverage_level")
                or detail.get("coverageLevel")
                or claim.get("evidence_coverage")
                or claim.get("evidenceCoverage")
                or "unknown"
            ).lower()
            contexts.append(
                {
                    "evidence_ref": evidence_ref,
                    "redacted_context": (
                        "A technical evidence reference supports this conflict. "
                        "Raw source, secrets, and full prompts are redacted."
                    ),
                    "coverage_limitations": self._coverage_limitations(coverage),
                }
            )
        return contexts

    def _coverage_limitations(self, coverage: str) -> str:
        """Explain coverage limits without upgrading the score to legal risk."""
        if coverage in LOW_COVERAGE_MARKERS:
            return (
                "Evidence coverage is limited and needs Manager review before the "
                "claim is treated as settled."
            )
        if coverage in {"high", "full", "broad"}:
            return (
                "Evidence supports this review point, but it does not provide legal "
                "risk, compliance status, or final classification."
            )
        return (
            "Coverage is not fully described; use this evidence as review context "
            "only."
        )

    def _is_false(self, value: Any) -> bool:
        """Normalize boolean/string representations of a negative answer."""
        if value is None:
            return False
        return value is False or str(value).lower() in {"false", "no", "none", "no_ai"}

    def _is_true(self, value: Any) -> bool:
        """Normalize boolean/string representations of a positive/detected fact."""
        return value is True or str(value).lower() in {"true", "yes", "detected"}
