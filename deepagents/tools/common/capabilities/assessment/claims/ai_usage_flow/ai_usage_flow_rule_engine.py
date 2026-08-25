"""Derive AIUsageFlow claims deterministically from technical evidence and bounded wizard context.

The rule engine is the authoritative claim-construction layer. It never uses an
LLM, requires evidence references for material claims, degrades lifecycle/status
when coverage is incomplete, and treats wizard data as business context rather
than a substitute for technical evidence.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from typing import Any

from middleware.redaction import redact_string

from .confidence_calculator import calculate_claim_confidence, lifecycle_for_confidence
from .conflict_candidate_builder import ConflictCandidateBuilder


SCHEMA_VERSION = "1.0.0"
DEFAULT_PROVIDER_VERSION = "lcsp.ai-usage-flow-worker.v1"
TECHNICAL_ONLY = "TECHNICAL_ONLY"
TECHNICAL_PLUS_WIZARD = "TECHNICAL_PLUS_WIZARD"
SYNTHETIC_OUTPUT_CATEGORIES = {"audio", "image", "video", "synthetic_media"}
DOCUMENT_OUTPUT_CATEGORIES = {
    "document",
    "report",
    "pdf",
    "docx",
    "generated_document",
    "document_generation",
}
PERSONAL_DATA_CATEGORIES = {
    "personal_data",
    "personal",
    "sensitive_data",
    "sensitive",
    "financial",
    "health",
    "biometric",
    "identity",
    "location",
}
DOWNSTREAM_ACTION_SIGNALS = {
    "AI_DECISION_FLOW_SIGNAL",
    "STATUS_UPDATE_SIGNAL",
    "AUTOMATED_DECISION_SIGNAL",
    "USER_IMPACT_SIGNAL",
    "DISPLAY_ONLY_SIGNAL",
    "RANKING_SIGNAL",
    "RECOMMENDATION_SIGNAL",
}
TRAINING_SIGNALS = {
    "TRAINING_ACTIVITY_SIGNAL",
    "MODEL_TRAINING_SIGNAL",
    "FINE_TUNE_SIGNAL",
    "FINE_TUNING_SIGNAL",
}
DOCUMENT_GENERATION_SIGNALS = {
    "DOCUMENT_GENERATION_SIGNAL",
    "REPORT_GENERATION_SIGNAL",
}
CONTENT_LABELING_SIGNALS = {
    "CONTENT_LABELING_SIGNAL",
    "LABELING_SIGNAL",
    "WATERMARK_SIGNAL",
}


class PrivacyAssertionError(RuntimeError):
    """Raised when AIUsageFlow generation detects unsafe raw content."""


@dataclass(frozen=True)
class AIUsageFlowClaim:
    """One evidence-backed AI usage fact with confidence and lifecycle metadata."""

    claim_id: str
    ai_usage_flow_id: str
    claim_category: str
    claim_field: str
    claim_value: object
    lifecycle_state: str
    evidence_refs: list[str]
    confidence: float
    confidence_breakdown: dict[str, float]
    uncertainty_reasons: list[str] = field(default_factory=list)
    conflict_refs: list[str] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize the claim for callbacks and persisted flow data."""
        return asdict(self)


@dataclass(frozen=True)
class AIUsageFlow:
    """Governed AI usage artifact produced from technical evidence and optional wizard context."""

    ai_usage_flow_id: str
    assessment_id: str
    technical_profile_id: str
    technical_evidence_report_id: str | None
    schema_version: str
    provider_version: str
    status: str
    verification_source: str
    summary: dict[str, Any]
    claims: list[AIUsageFlowClaim]
    confidence: float
    uncertainty_reasons: list[str]
    coverage_limitations: list[str]
    conflict_candidates: list[dict[str, Any]]
    privacy_flags: dict[str, bool]

    def to_dict(self) -> dict[str, Any]:
        """Serialize the flow while preserving explicit claim dictionaries."""
        data = asdict(self)
        data["claims"] = [claim.to_dict() for claim in self.claims]
        return data


class AIUsageFlowRuleEngine:
    """Build AI usage claims using deterministic evidence rules and fail-closed gates."""

    def __init__(
        self,
        *,
        provider_version: str = DEFAULT_PROVIDER_VERSION,
        conflict_builder: ConflictCandidateBuilder | None = None,
    ) -> None:
        """Create the rule engine with provider version and conflict-candidate builder."""
        self._provider_version = provider_version
        self._conflict_builder = conflict_builder or ConflictCandidateBuilder()

    def generate(
        self,
        *,
        technical_profile: dict[str, Any] | None,
        evidence_report: dict[str, Any] | None,
        wizard_profile: dict[str, Any] | None,
    ) -> AIUsageFlow:
        """Generate the authoritative AIUsageFlow from accepted technical evidence.

        Args:
            technical_profile: Accepted technical profile summarized from scanner evidence.
            evidence_report: Accepted technical evidence report containing findings/signals.
            wizard_profile: Optional manager profile used for business context/conflict checks.

        Returns:
            Deterministic AIUsageFlow with claims, confidence, status, and privacy flags.

        Raises:
            PrivacyAssertionError: If input/output contains source code or unredacted secrets.
        """
        if not technical_profile:
            return self._blocked_flow("MISSING_TECHNICAL_PROFILE")
        if not evidence_report:
            return self._blocked_flow(
                "MISSING_TECHNICAL_EVIDENCE_REPORT",
                technical_profile=technical_profile,
            )
        if str(evidence_report.get("status", "")).lower() not in {"", "accepted"}:
            return self._blocked_flow(
                "TECHNICAL_EVIDENCE_REPORT_NOT_ACCEPTED",
                technical_profile=technical_profile,
                evidence_report=evidence_report,
            )

        self._assert_privacy(technical_profile, evidence_report)

        flow_id = self._flow_id(technical_profile)
        findings = self._findings(evidence_report)
        coverage_limitations = self._coverage_limitations(
            technical_profile, evidence_report
        )
        uncertainty_reasons = list(coverage_limitations)
        claims: list[AIUsageFlowClaim] = []

        provider_refs = self._refs_for(
            findings,
            {"AI_PROVIDER_USAGE", "AI_FRAMEWORK_USAGE", "provider_integration"},
        )
        invocation_refs = self._refs_for(
            findings, {"AI_MODEL_INVOCATION", "model_call"}
        )
        output_refs = self._refs_for(
            findings, {"AI_OUTPUT_SIGNAL", "output_signal", "MODEL_OUTPUT_PARSER_SIGNAL"}
        )

        if (
            provider_refs
            or self._list_field(technical_profile, "providers")
            or self._list_field(technical_profile, "frameworks")
            or self._list_field(technical_profile, "dependency_ai_packages")
        ):
            claims.append(
                self._claim(
                    flow_id=flow_id,
                    claim_category="MODEL_PROVIDER_USAGE",
                    claim_field="provider_usage",
                    claim_value={
                        "providers": self._list_field(technical_profile, "providers"),
                        "frameworks": self._list_field(technical_profile, "frameworks"),
                        "packages": self._list_field(
                            technical_profile, "dependency_ai_packages"
                        ),
                    },
                    evidence_refs=provider_refs
                    or self._list_field(technical_profile, "evidence_refs"),
                    optional_signal_count=1
                    if self._list_field(technical_profile, "providers")
                    or self._list_field(technical_profile, "dependency_ai_packages")
                    else 0,
                    material_coverage_limitations=len(coverage_limitations),
                )
            )

        if invocation_refs or self._has_signal(
            findings, {"AI_MODEL_INVOCATION", "model_call"}
        ):
            claims.append(
                self._claim(
                    flow_id=flow_id,
                    claim_category="MODEL_INVOCATION",
                    claim_field="model_invocation",
                    claim_value={"invocationDetected": True},
                    evidence_refs=invocation_refs,
                    optional_signal_count=1
                    if provider_refs
                    or self._list_field(technical_profile, "providers")
                    else 0,
                    material_coverage_limitations=len(coverage_limitations),
                )
            )
        elif provider_refs or self._list_field(technical_profile, "providers"):
            uncertainty_reasons.append("PROVIDER_ONLY_SIGNAL")

        if output_refs:
            claims.append(
                self._claim(
                    flow_id=flow_id,
                    claim_category="AI_GENERATED_OUTPUT",
                    claim_field="output_categories",
                    claim_value={
                        "outputCategories": self._output_categories(
                            technical_profile, findings
                        )
                    },
                    evidence_refs=output_refs,
                    optional_signal_count=1
                    if self._has_signal(findings, {"MODEL_OUTPUT_PARSER_SIGNAL"})
                    else 0,
                    material_coverage_limitations=len(coverage_limitations),
                )
            )

        downstream_claim = self._downstream_action_claim(
            flow_id=flow_id,
            findings=findings,
            coverage_limitations=coverage_limitations,
        )
        if downstream_claim:
            claims.append(downstream_claim)

        automated_claim = self._automated_decision_claim(
            flow_id=flow_id,
            findings=findings,
            coverage_limitations=coverage_limitations,
        )
        if automated_claim:
            claims.append(automated_claim)
            if automated_claim.lifecycle_state == "ABSTAINED":
                uncertainty_reasons.append("UNRESOLVED_OUTPUT_ACTION_PATH")

        human_review_claim = self._human_review_claim(
            flow_id=flow_id,
            findings=findings,
            automated_claim=automated_claim,
            coverage_limitations=coverage_limitations,
        )
        if human_review_claim:
            claims.append(human_review_claim)

        prompt_refs = self._refs_for(
            findings, {"SYSTEM_PROMPT_DETECTED", "DYNAMIC_SYSTEM_PROMPT_REFERENCE"}
        )
        if prompt_refs:
            claims.append(
                self._claim(
                    flow_id=flow_id,
                    claim_category="PROMPT_STORAGE",
                    claim_field="prompt_configuration",
                    claim_value={"promptReferenceDetected": True},
                    evidence_refs=prompt_refs,
                    optional_signal_count=1
                    if self._has_signal(findings, {"DYNAMIC_SYSTEM_PROMPT_REFERENCE"})
                    else 0,
                    material_coverage_limitations=len(coverage_limitations),
                )
            )

        personal_data_claim = self._personal_data_claim(
            flow_id=flow_id,
            technical_profile=technical_profile,
            findings=findings,
            coverage_limitations=coverage_limitations,
        )
        if personal_data_claim:
            claims.append(personal_data_claim)

        training_refs = self._refs_for(findings, TRAINING_SIGNALS)
        if training_refs:
            claims.append(
                self._claim(
                    flow_id=flow_id,
                    claim_category="TRAINING_ACTIVITY",
                    claim_field="training_activity",
                    claim_value={"trainingActivityDetected": True},
                    evidence_refs=training_refs,
                    optional_signal_count=0,
                    material_coverage_limitations=len(coverage_limitations),
                )
            )

        rag_refs = self._refs_for(findings, {"RAG_USAGE_SIGNAL"})
        if rag_refs:
            claims.append(
                self._claim(
                    flow_id=flow_id,
                    claim_category="RAG_USAGE",
                    claim_field="retrieval_augmented_generation",
                    claim_value={"ragUsageDetected": True},
                    evidence_refs=rag_refs,
                    optional_signal_count=0,
                    material_coverage_limitations=len(coverage_limitations),
                )
            )

        document_claim = self._document_generation_claim(
            flow_id=flow_id,
            technical_profile=technical_profile,
            findings=findings,
            output_refs=output_refs,
            coverage_limitations=coverage_limitations,
        )
        if document_claim:
            claims.append(document_claim)

        content_labeling_claim = self._content_labeling_claim(
            flow_id=flow_id,
            technical_profile=technical_profile,
            findings=findings,
            coverage_limitations=coverage_limitations,
        )
        if content_labeling_claim:
            claims.append(content_labeling_claim)

        oversight_claim = self._control_claim(
            flow_id=flow_id,
            category="HUMAN_OVERSIGHT_CONTROL",
            field_name="intervention_control",
            present_key="interventionControlPresent",
            signal_type="HUMAN_OVERSIGHT_CONTROL_SIGNAL",
            findings=findings,
            required_basis=automated_claim or downstream_claim,
            coverage_limitations=coverage_limitations,
        )
        if oversight_claim:
            claims.append(oversight_claim)

        disclosure_refs = self._refs_for(
            findings, {"AI_INTERACTION_DISCLOSURE_SIGNAL"}
        )
        if disclosure_refs:
            claims.append(
                self._claim(
                    flow_id=flow_id,
                    claim_category="AI_INTERACTION_DISCLOSURE",
                    claim_field="interaction_disclosure",
                    claim_value={"aiInteractionDisclosurePresent": "PRESENT"},
                    evidence_refs=disclosure_refs,
                    optional_signal_count=0,
                    material_coverage_limitations=len(coverage_limitations),
                )
            )

        incident_claim = self._control_claim(
            flow_id=flow_id,
            category="INCIDENT_HANDLING",
            field_name="incident_handling",
            present_key="incidentHandlingPresent",
            signal_type="INCIDENT_HANDLING_SIGNAL",
            findings=findings,
            required_basis=self._claim_by_category(claims, "MODEL_INVOCATION"),
            coverage_limitations=coverage_limitations,
        )
        if incident_claim:
            claims.append(incident_claim)

        conflict_candidates = self._conflict_builder.build(
            technical_profile=technical_profile,
            wizard_profile=wizard_profile,
            has_validated_invocation=any(
                claim.claim_category == "MODEL_INVOCATION"
                and claim.lifecycle_state == "VALIDATED"
                for claim in claims
            ),
        )
        if conflict_candidates:
            claims = [
                self._apply_conflict(claim, conflict_candidates)
                if claim.claim_category == "MODEL_INVOCATION"
                else claim
                for claim in claims
            ]

        summary = self._summary(
            technical_profile=technical_profile,
            wizard_profile=wizard_profile,
            claims=claims,
            findings=findings,
            uncertainty_reasons=uncertainty_reasons,
        )
        status = self._status(claims, uncertainty_reasons, conflict_candidates)
        confidence = self._overall_confidence(claims, uncertainty_reasons)
        privacy_flags = {"containsSourceCode": False, "secretsRedacted": True}
        flow = AIUsageFlow(
            ai_usage_flow_id=flow_id,
            assessment_id=self._str_field(technical_profile, "assessment_id"),
            technical_profile_id=self._technical_profile_id(technical_profile),
            technical_evidence_report_id=self._evidence_report_id(
                technical_profile, evidence_report
            ),
            schema_version=SCHEMA_VERSION,
            provider_version=self._provider_version,
            status=status,
            verification_source=TECHNICAL_PLUS_WIZARD
            if wizard_profile
            else TECHNICAL_ONLY,
            summary=summary,
            claims=claims,
            confidence=confidence,
            uncertainty_reasons=sorted(set(uncertainty_reasons)),
            coverage_limitations=coverage_limitations,
            conflict_candidates=conflict_candidates,
            privacy_flags=privacy_flags,
        )
        self._assert_output_safe(flow.to_dict())
        return flow

    def _claim(
        self,
        *,
        flow_id: str,
        claim_category: str,
        claim_field: str,
        claim_value: object,
        evidence_refs: list[str],
        optional_signal_count: int,
        material_coverage_limitations: int,
    ) -> AIUsageFlowClaim:
        """Build one scored claim and derive its lifecycle from evidence quality."""
        missing_refs = not evidence_refs
        confidence, breakdown = calculate_claim_confidence(
            claim_category,
            required_evidence_present=not missing_refs,
            optional_signal_count=optional_signal_count,
            material_coverage_limitations=material_coverage_limitations,
            has_wizard_conflict=False,
            missing_required_evidence_class=missing_refs,
        )
        uncertainty = ["MISSING_EVIDENCE_REF"] if missing_refs else []
        return AIUsageFlowClaim(
            claim_id=f"claim_{claim_category.lower()}",
            ai_usage_flow_id=flow_id,
            claim_category=claim_category,
            claim_field=claim_field,
            claim_value=claim_value,
            lifecycle_state=lifecycle_for_confidence(
                confidence,
                missing_evidence_ref=missing_refs,
            ),
            evidence_refs=evidence_refs,
            confidence=confidence,
            confidence_breakdown=breakdown,
            uncertainty_reasons=uncertainty,
        )

    def _abstained_claim(
        self,
        *,
        flow_id: str,
        claim_category: str,
        claim_field: str,
        claim_value: object,
        evidence_refs: list[str],
        reason: str,
        material_coverage_limitations: int,
    ) -> AIUsageFlowClaim:
        """Force a claim to ABSTAINED while preserving its evidence/confidence trace."""
        claim = self._claim(
            flow_id=flow_id,
            claim_category=claim_category,
            claim_field=claim_field,
            claim_value=claim_value,
            evidence_refs=evidence_refs,
            optional_signal_count=0,
            material_coverage_limitations=material_coverage_limitations,
        )
        return replace(
            claim,
            lifecycle_state="ABSTAINED",
            uncertainty_reasons=sorted(
                set([*claim.uncertainty_reasons, reason])
            ),
        )

    def _downstream_action_claim(
        self,
        *,
        flow_id: str,
        findings: list[dict[str, Any]],
        coverage_limitations: list[str],
    ) -> AIUsageFlowClaim | None:
        """Classify the strongest detected downstream action from evidence signals."""
        refs = self._refs_for(findings, DOWNSTREAM_ACTION_SIGNALS)
        if not refs:
            return None
        action = "DECISION_FLOW"
        if self._has_signal(findings, {"AUTOMATED_DECISION_SIGNAL"}):
            action = "AUTOMATED_DECISION"
        elif self._has_signal(findings, {"USER_IMPACT_SIGNAL"}):
            action = "USER_IMPACT"
        elif self._has_signal(findings, {"STATUS_UPDATE_SIGNAL"}):
            action = "STATUS_UPDATE"
        elif self._has_signal(findings, {"RANKING_SIGNAL"}):
            action = "RANKING"
        elif self._has_signal(findings, {"RECOMMENDATION_SIGNAL"}):
            action = "RECOMMENDATION"
        elif self._has_signal(findings, {"DISPLAY_ONLY_SIGNAL"}):
            action = "DISPLAY_ONLY"
        return self._claim(
            flow_id=flow_id,
            claim_category="DOWNSTREAM_ACTION",
            claim_field="downstream_action",
            claim_value={"downstreamAction": action},
            evidence_refs=refs,
            optional_signal_count=1 if len(refs) > 1 else 0,
            material_coverage_limitations=len(coverage_limitations),
        )

    def _automated_decision_claim(
        self,
        *,
        flow_id: str,
        findings: list[dict[str, Any]],
        coverage_limitations: list[str],
    ) -> AIUsageFlowClaim | None:
        """Create automated-decision claim, abstaining when output/action path is unresolved."""
        refs = self._refs_for(findings, {"AUTOMATED_DECISION_SIGNAL"})
        if not refs:
            return None
        if not self._path_resolved(findings):
            return self._abstained_claim(
                flow_id=flow_id,
                claim_category="AUTOMATED_DECISION",
                claim_field="automation_level",
                claim_value={"automationLevel": "UNKNOWN"},
                evidence_refs=refs,
                reason="UNRESOLVED_OUTPUT_ACTION_PATH",
                material_coverage_limitations=len(coverage_limitations),
            )
        return self._claim(
            flow_id=flow_id,
            claim_category="AUTOMATED_DECISION",
            claim_field="automation_level",
            claim_value={"automationLevel": "FULLY_AUTOMATED"},
            evidence_refs=refs,
            optional_signal_count=1
            if self._has_signal(
                findings, {"STATUS_UPDATE_SIGNAL", "USER_IMPACT_SIGNAL"}
            )
            else 0,
            material_coverage_limitations=len(coverage_limitations),
        )

    def _human_review_claim(
        self,
        *,
        flow_id: str,
        findings: list[dict[str, Any]],
        automated_claim: AIUsageFlowClaim | None,
        coverage_limitations: list[str],
    ) -> AIUsageFlowClaim | None:
        """Represent observed review or bounded absence only when evidence supports it."""
        review_refs = self._refs_for(findings, {"HUMAN_REVIEW_SIGNAL"})
        if review_refs:
            return self._claim(
                flow_id=flow_id,
                claim_category="HUMAN_REVIEW",
                claim_field="human_review",
                claim_value={"humanReview": "PRESENT"},
                evidence_refs=review_refs,
                optional_signal_count=0,
                material_coverage_limitations=len(coverage_limitations),
            )
        if (
            automated_claim
            and automated_claim.lifecycle_state != "ABSTAINED"
            and self._path_resolved(findings)
        ):
            return self._claim(
                flow_id=flow_id,
                claim_category="HUMAN_REVIEW",
                claim_field="human_review",
                claim_value={"humanReview": "ABSENT_WITH_BOUNDED_PATH"},
                evidence_refs=list(automated_claim.evidence_refs),
                optional_signal_count=0,
                material_coverage_limitations=len(coverage_limitations),
            )
        return None

    def _personal_data_claim(
        self,
        *,
        flow_id: str,
        technical_profile: dict[str, Any],
        findings: list[dict[str, Any]],
        coverage_limitations: list[str],
    ) -> AIUsageFlowClaim | None:
        """Create a personal-data-input claim from evidence signals or input categories."""
        refs = self._refs_for(findings, {"SENSITIVE_DATA_SIGNAL"})
        input_categories = self._list_field(technical_profile, "input_categories")
        sensitive_categories = sorted(
            category
            for category in input_categories
            if category.lower() in PERSONAL_DATA_CATEGORIES
        )
        if not refs and not sensitive_categories:
            return None
        evidence_refs = refs or self._list_field(technical_profile, "evidence_refs")
        return self._claim(
            flow_id=flow_id,
            claim_category="PERSONAL_DATA_INPUT",
            claim_field="personal_data_input",
            claim_value={
                "personalDataInput": True,
                "categories": sensitive_categories,
            },
            evidence_refs=evidence_refs,
            optional_signal_count=1 if refs and sensitive_categories else 0,
            material_coverage_limitations=len(coverage_limitations),
        )

    def _document_generation_claim(
        self,
        *,
        flow_id: str,
        technical_profile: dict[str, Any],
        findings: list[dict[str, Any]],
        output_refs: list[str],
        coverage_limitations: list[str],
    ) -> AIUsageFlowClaim | None:
        """Detect document generation from explicit signals or document output categories."""
        explicit_refs = self._refs_for(findings, DOCUMENT_GENERATION_SIGNALS)
        output_categories = {
            category.lower()
            for category in self._output_categories(technical_profile, findings)
        }
        if not explicit_refs and not (
            output_refs and output_categories.intersection(DOCUMENT_OUTPUT_CATEGORIES)
        ):
            return None
        return self._claim(
            flow_id=flow_id,
            claim_category="DOCUMENT_GENERATION",
            claim_field="document_generation",
            claim_value={"documentGenerationDetected": True},
            evidence_refs=explicit_refs or output_refs,
            optional_signal_count=1 if explicit_refs and output_refs else 0,
            material_coverage_limitations=len(coverage_limitations),
        )

    def _content_labeling_claim(
        self,
        *,
        flow_id: str,
        technical_profile: dict[str, Any],
        findings: list[dict[str, Any]],
        coverage_limitations: list[str],
    ) -> AIUsageFlowClaim | None:
        """Evaluate labeling controls only when synthetic-media output is in scope."""
        output_categories = set(
            self._output_categories(technical_profile, findings)
        )
        synthetic_output = bool(output_categories & SYNTHETIC_OUTPUT_CATEGORIES)
        if not synthetic_output:
            return None

        labeling_refs = self._refs_for(findings, CONTENT_LABELING_SIGNALS)
        output_refs = self._refs_for(
            findings, {"AI_OUTPUT_SIGNAL", "output_signal"}
        )
        path_resolved = self._path_resolved(findings)
        status = (
            "PRESENT"
            if labeling_refs
            else "ABSENT"
            if path_resolved
            else "UNCLEAR"
        )
        return self._claim(
            flow_id=flow_id,
            claim_category="CONTENT_LABELING",
            claim_field="content_labeling_status",
            claim_value={"contentLabelingStatus": status},
            evidence_refs=labeling_refs or output_refs,
            optional_signal_count=1 if labeling_refs else 0,
            material_coverage_limitations=len(coverage_limitations),
        )

    def _control_claim(
        self,
        *,
        flow_id: str,
        category: str,
        field_name: str,
        present_key: str,
        signal_type: str,
        findings: list[dict[str, Any]],
        required_basis: AIUsageFlowClaim | None,
        coverage_limitations: list[str],
    ) -> AIUsageFlowClaim | None:
        """Build present/absent control claims only when the relevant path is bounded."""
        refs = self._refs_for(findings, {signal_type})
        if refs:
            return self._claim(
                flow_id=flow_id,
                claim_category=category,
                claim_field=field_name,
                claim_value={present_key: "PRESENT"},
                evidence_refs=refs,
                optional_signal_count=0,
                material_coverage_limitations=len(coverage_limitations),
            )
        if required_basis and self._path_resolved(findings):
            return self._claim(
                flow_id=flow_id,
                claim_category=category,
                claim_field=field_name,
                claim_value={present_key: "ABSENT"},
                evidence_refs=list(required_basis.evidence_refs),
                optional_signal_count=0,
                material_coverage_limitations=len(coverage_limitations),
            )
        return None

    def _apply_conflict(
        self,
        claim: AIUsageFlowClaim,
        conflicts: list[dict[str, Any]],
    ) -> AIUsageFlowClaim:
        """Penalize confidence and force CONFLICTED lifecycle for a disputed claim."""
        confidence, breakdown = calculate_claim_confidence(
            claim.claim_category,
            required_evidence_present=bool(claim.evidence_refs),
            optional_signal_count=0,
            material_coverage_limitations=0,
            has_wizard_conflict=True,
            missing_required_evidence_class=False,
        )
        return AIUsageFlowClaim(
            claim_id=claim.claim_id,
            ai_usage_flow_id=claim.ai_usage_flow_id,
            claim_category=claim.claim_category,
            claim_field=claim.claim_field,
            claim_value=claim.claim_value,
            lifecycle_state="CONFLICTED",
            evidence_refs=claim.evidence_refs,
            confidence=confidence,
            confidence_breakdown=breakdown,
            uncertainty_reasons=list(claim.uncertainty_reasons),
            conflict_refs=[str(conflict["conflict_id"]) for conflict in conflicts],
        )

    def _blocked_flow(
        self,
        reason: str,
        *,
        technical_profile: dict[str, Any] | None = None,
        evidence_report: dict[str, Any] | None = None,
    ) -> AIUsageFlow:
        """Return a safe BLOCKED artifact when mandatory upstream inputs fail gates."""
        technical_profile = technical_profile or {}
        return AIUsageFlow(
            ai_usage_flow_id="blocked_ai_usage_flow",
            assessment_id=self._str_field(technical_profile, "assessment_id"),
            technical_profile_id=self._technical_profile_id(technical_profile),
            technical_evidence_report_id=self._evidence_report_id(
                technical_profile, evidence_report or {}
            ),
            schema_version=SCHEMA_VERSION,
            provider_version=self._provider_version,
            status="BLOCKED",
            verification_source=TECHNICAL_ONLY,
            summary=self._empty_summary([reason]),
            claims=[],
            confidence=0.0,
            uncertainty_reasons=[reason],
            coverage_limitations=[],
            conflict_candidates=[],
            privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
        )

    def _summary(
        self,
        *,
        technical_profile: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
        claims: list[AIUsageFlowClaim],
        findings: list[dict[str, Any]],
        uncertainty_reasons: list[str],
    ) -> dict[str, Any]:
        """Build the business-facing summary from claims plus wizard-authoritative context.

        Wizard answers provide business-process/purpose/affected-subject context;
        technical facts such as automation, review, controls, and evidence-backed
        material claim references remain derived from scanner claims.
        """
        answers = wizard_profile.get("answers") if wizard_profile else {}
        answers = answers if isinstance(answers, dict) else {}
        material_claim_refs = [
            claim.claim_id
            for claim in claims
            if claim.lifecycle_state == "VALIDATED"
            and claim.evidence_refs
            and claim.confidence >= 0.75
        ]
        downstream_action = self._claim_value(
            claims, "DOWNSTREAM_ACTION", "downstreamAction", "UNKNOWN"
        )
        human_review = self._claim_value(
            claims, "HUMAN_REVIEW", "humanReview", "UNCLEAR"
        )
        automation_level = self._claim_value(
            claims, "AUTOMATED_DECISION", "automationLevel", "UNKNOWN"
        )
        content_labeling = self._claim_value(
            claims,
            "CONTENT_LABELING",
            "contentLabelingStatus",
            "NOT_APPLICABLE",
        )
        intervention_control = self._claim_value(
            claims,
            "HUMAN_OVERSIGHT_CONTROL",
            "interventionControlPresent",
            "NOT_APPLICABLE",
        )
        interaction_disclosure = self._claim_value(
            claims,
            "AI_INTERACTION_DISCLOSURE",
            "aiInteractionDisclosurePresent",
            "NOT_APPLICABLE",
        )
        incident_handling = self._claim_value(
            claims,
            "INCIDENT_HANDLING",
            "incidentHandlingPresent",
            "UNCLEAR",
        )
        potential_harms = (
            ["POTENTIAL_HIGH_IMPACT"]
            if self._has_signal(findings, {"HARM_POTENTIAL_SIGNAL"})
            else []
        )
        return {
            "aiDetected": self._str_field(technical_profile, "ai_detected")
            or "unknown",
            "businessProcess": answers.get("businessProcess", "UNKNOWN"),
            "aiPurpose": answers.get("aiPurpose", "UNKNOWN"),
            "aiInputTypes": self._list_field(technical_profile, "input_categories"),
            "aiOutputTypes": self._list_field(technical_profile, "output_categories"),
            "downstreamAction": downstream_action,
            "affectedSubjects": answers.get("affectedSubjects", "UNKNOWN"),
            "humanReview": human_review,
            "automationLevel": automation_level,
            "potentialHarmCategories": potential_harms,
            "contentLabelingStatus": content_labeling,
            "riskDocumentationEvidence": "NOT_DETERMINABLE_FROM_CODE",
            "trainingDataLawfulnessSignal": "NOT_DETERMINABLE_FROM_CODE",
            "interventionControlPresent": intervention_control,
            "aiInteractionDisclosurePresent": interaction_disclosure,
            "incidentHandlingPresent": incident_handling,
            "materialClaimRefs": material_claim_refs,
            "blockingReasons": sorted(set(uncertainty_reasons)),
        }

    def _empty_summary(self, reasons: list[str]) -> dict[str, Any]:
        """Return the conservative summary shape used for blocked flows."""
        return {
            "aiDetected": "unknown",
            "businessProcess": "UNKNOWN",
            "aiPurpose": "UNKNOWN",
            "aiInputTypes": [],
            "aiOutputTypes": [],
            "downstreamAction": "UNKNOWN",
            "affectedSubjects": "UNKNOWN",
            "humanReview": "UNCLEAR",
            "automationLevel": "UNKNOWN",
            "potentialHarmCategories": [],
            "contentLabelingStatus": "NOT_APPLICABLE",
            "riskDocumentationEvidence": "NOT_DETERMINABLE_FROM_CODE",
            "trainingDataLawfulnessSignal": "NOT_DETERMINABLE_FROM_CODE",
            "interventionControlPresent": "NOT_APPLICABLE",
            "aiInteractionDisclosurePresent": "NOT_APPLICABLE",
            "incidentHandlingPresent": "UNCLEAR",
            "materialClaimRefs": [],
            "blockingReasons": list(reasons),
        }

    def _status(
        self,
        claims: list[AIUsageFlowClaim],
        uncertainty_reasons: list[str],
        conflicts: list[dict[str, Any]],
    ) -> str:
        """Derive flow readiness with conflicts/abstentions/uncertainty taking precedence."""
        if conflicts:
            return "CONFLICTED"
        if not claims or any(claim.lifecycle_state == "REJECTED" for claim in claims):
            return "UNCLEAR"
        if any(claim.lifecycle_state == "ABSTAINED" for claim in claims):
            return "UNCLEAR"
        if uncertainty_reasons:
            return "UNCLEAR"
        return "READY"

    def _overall_confidence(
        self,
        claims: list[AIUsageFlowClaim],
        uncertainty_reasons: list[str],
    ) -> float:
        """Average material claim confidence and subtract bounded uncertainty penalty."""
        material = [
            claim.confidence
            for claim in claims
            if claim.evidence_refs and claim.lifecycle_state != "ABSTAINED"
        ]
        if not material:
            return 0.0
        raw = sum(material) / len(material) - (0.05 * len(uncertainty_reasons))
        return round(max(0.0, min(1.0, raw)), 2)

    def _assert_privacy(
        self,
        technical_profile: dict[str, Any],
        evidence_report: dict[str, Any],
    ) -> None:
        """Validate upstream privacy flags and recursively inspect structured inputs."""
        for payload in (technical_profile, evidence_report):
            privacy_flags = payload.get("privacy_flags") or payload.get("privacyFlags")
            if isinstance(privacy_flags, dict):
                if privacy_flags.get("containsSourceCode") is True:
                    raise PrivacyAssertionError("AIUsageFlow input contains source code")
                if privacy_flags.get("secretsRedacted") is False:
                    raise PrivacyAssertionError("AIUsageFlow input contains secrets")
        self._assert_output_safe(
            {
                "technical_profile": technical_profile,
                "evidence_report": evidence_report,
            }
        )

    def _assert_output_safe(self, value: Any) -> None:
        """Recursively reject raw source fields/text and strings that contain secrets."""
        if isinstance(value, dict):
            for key, nested_value in value.items():
                if str(key) in {
                    "raw_source",
                    "rawSource",
                    "source_code",
                    "sourceCode",
                    "ast_body",
                    "astBody",
                }:
                    raise PrivacyAssertionError("AIUsageFlow contains raw source field")
                self._assert_output_safe(nested_value)
            return
        if isinstance(value, list):
            for nested_value in value:
                self._assert_output_safe(nested_value)
            return
        if isinstance(value, str):
            if "def " in value or "function " in value or "class " in value:
                raise PrivacyAssertionError("AIUsageFlow contains raw source text")
            if redact_string(value) != value:
                raise PrivacyAssertionError("AIUsageFlow contains unredacted secret")

    def _findings(self, evidence_report: dict[str, Any]) -> list[dict[str, Any]]:
        """Merge and deduplicate supported finding collections from evidence payload."""
        payload = (
            evidence_report.get("evidence_payload")
            or evidence_report.get("evidencePayload")
            or {}
        )
        if not isinstance(payload, dict):
            return []

        merged: list[dict[str, Any]] = []
        for key in ("ai_usage_signals", "technical_findings", "findings"):
            entries = payload.get(key) or []
            if not isinstance(entries, list):
                continue
            for raw in entries:
                if not isinstance(raw, dict):
                    continue
                finding = dict(raw)
                if not finding.get("signal_type") and finding.get("finding_type"):
                    finding["signal_type"] = finding["finding_type"]
                if key == "technical_findings" and not finding.get("evidence_ref"):
                    ref = finding.get("finding_id") or finding.get("id")
                    if ref:
                        finding["evidence_ref"] = str(ref)
                merged.append(finding)

        deduped: dict[tuple[str, str], dict[str, Any]] = {}
        for index, finding in enumerate(merged):
            key = (
                self._signal_type(finding),
                str(finding.get("evidence_ref") or f"missing:{index}"),
            )
            deduped[key] = finding
        return list(deduped.values())

    def _refs_for(
        self, findings: list[dict[str, Any]], signal_types: set[str]
    ) -> list[str]:
        """Collect unique evidence references for a set of signal types."""
        refs: list[str] = []
        normalized = {signal.lower() for signal in signal_types}
        for finding in findings:
            if self._signal_type(finding) not in normalized:
                continue
            value = (
                finding.get("evidence_ref")
                or finding.get("evidenceRef")
                or finding.get("evidence_ref_id")
                or finding.get("evidenceRefId")
            )
            if value:
                refs.append(str(value))
        return sorted(set(refs))

    def _has_signal(
        self, findings: list[dict[str, Any]], signal_types: set[str]
    ) -> bool:
        """Return whether any normalized finding matches the requested signal set."""
        normalized = {signal.lower() for signal in signal_types}
        return any(self._signal_type(finding) in normalized for finding in findings)

    @staticmethod
    def _signal_type(finding: dict[str, Any]) -> str:
        """Normalize signal/finding/type aliases for deterministic rule matching."""
        return str(
            finding.get("signal_type")
            or finding.get("finding_type")
            or finding.get("type")
            or ""
        ).lower()

    def _path_resolved(self, findings: list[dict[str, Any]]) -> bool:
        """Decide whether static evidence sufficiently resolves output-to-action flow."""
        if self._has_signal(findings, {"UNSUPPORTED_DYNAMIC_FLOW"}):
            return False
        if any(bool(finding.get("has_dynamic_call")) for finding in findings):
            return False
        explicit = [
            finding.get("path_resolved")
            if "path_resolved" in finding
            else finding.get("pathResolved")
            for finding in findings
            if "path_resolved" in finding or "pathResolved" in finding
        ]
        if explicit:
            return any(bool(value) for value in explicit)
        return self._has_signal(
            findings,
            {
                "AI_MODEL_INVOCATION",
                "AI_OUTPUT_SIGNAL",
                *DOWNSTREAM_ACTION_SIGNALS,
            },
        )

    def _coverage_limitations(
        self,
        technical_profile: dict[str, Any],
        evidence_report: dict[str, Any],
    ) -> list[str]:
        """Merge unique coverage limitations from profile and evidence artifacts."""
        limitations = self._list_field(technical_profile, "coverage_limitations")
        limitations.extend(self._list_field(technical_profile, "coverage_notes"))
        payload = (
            evidence_report.get("evidence_payload")
            or evidence_report.get("evidencePayload")
            or {}
        )
        if isinstance(payload, dict):
            limitations.extend(
                str(note) for note in payload.get("coverage_notes", []) if note
            )
        return sorted(set(limitations))

    def _output_categories(
        self,
        technical_profile: dict[str, Any],
        findings: list[dict[str, Any]],
    ) -> list[str]:
        """Merge output categories declared by profile and individual findings."""
        categories = set(self._list_field(technical_profile, "output_categories"))
        for finding in findings:
            category = finding.get("output_category") or finding.get("outputCategory")
            if category:
                categories.add(str(category))
        return sorted(categories)

    @staticmethod
    def _claim_by_category(
        claims: list[AIUsageFlowClaim], category: str
    ) -> AIUsageFlowClaim | None:
        """Return the first claim in a requested category."""
        return next((claim for claim in claims if claim.claim_category == category), None)

    @staticmethod
    def _claim_value(
        claims: list[AIUsageFlowClaim],
        category: str,
        key: str,
        default: Any,
    ) -> Any:
        """Read one value from a category claim or return the supplied default."""
        claim = next(
            (claim for claim in claims if claim.claim_category == category), None
        )
        if claim and isinstance(claim.claim_value, dict):
            return claim.claim_value.get(key, default)
        return default

    def _flow_id(self, technical_profile: dict[str, Any]) -> str:
        """Derive a stable AIUsageFlow ID from the technical profile identifier."""
        return f"aiuf-{self._technical_profile_id(technical_profile) or 'unknown'}"

    def _technical_profile_id(self, technical_profile: dict[str, Any]) -> str:
        """Resolve technical profile ID from explicit or generic artifact ID fields."""
        return self._str_field(
            technical_profile, "technical_profile_id"
        ) or self._str_field(technical_profile, "id")

    def _evidence_report_id(
        self,
        technical_profile: dict[str, Any],
        evidence_report: dict[str, Any],
    ) -> str | None:
        """Resolve the originating technical evidence report identifier."""
        return (
            self._str_field(technical_profile, "evidence_report_id")
            or self._str_field(evidence_report, "id")
            or None
        )

    def _str_field(self, payload: dict[str, Any], key: str) -> str:
        """Read a scalar field using snake_case or camelCase aliases."""
        value = payload.get(key) or payload.get(self._to_camel_case(key))
        return str(value) if value else ""

    def _list_field(self, payload: dict[str, Any], key: str) -> list[str]:
        """Normalize a list field, projecting dictionary entries to stable IDs when possible."""
        value = payload.get(key) or payload.get(self._to_camel_case(key))
        if not isinstance(value, list):
            return []
        normalized: list[str] = []
        for item in value:
            if isinstance(item, dict):
                ref = (
                    item.get("evidence_ref_id")
                    or item.get("evidenceRefId")
                    or item.get("id")
                )
                if ref:
                    normalized.append(str(ref))
                continue
            normalized.append(str(item))
        return normalized

    @staticmethod
    def _to_camel_case(key: str) -> str:
        """Convert an internal snake_case field name to its API camelCase alias."""
        parts = key.split("_")
        return parts[0] + "".join(part.title() for part in parts[1:])
