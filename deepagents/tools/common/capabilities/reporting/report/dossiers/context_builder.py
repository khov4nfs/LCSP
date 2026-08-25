"""Build dossier inputs from immutable document-generation artifacts."""
from __future__ import annotations

from typing import Any

from .engine import DossierEngine
from .models import Dossier, DossierSourceArtifacts


class ClassificationDossierBuilder:
    """Project persisted LCSP artifacts into an AI risk-classification dossier.

    This builder does not infer missing business/legal facts. Missing sections are
    intentionally left empty so ``DossierEngine`` marks the dossier INCOMPLETE.
    """

    def __init__(self, engine: DossierEngine | None = None) -> None:
        self._engine = engine or DossierEngine()

    def build(self, generation_context: dict[str, Any]) -> Dossier:
        request = self._record(generation_context, "document_request")
        assessment = self._record(generation_context, "assessment")
        classification = self._record(generation_context, "classification_result")
        verified = self._record(generation_context, "verified_profile")
        technical = self._record(generation_context, "technical_profile")
        evidence_report = self._record(generation_context, "technical_evidence_report")
        snapshot = self._record(generation_context, "repository_snapshot")
        legal_match = self._record(generation_context, "legal_rule_match")
        ai_usage_flow = self._record(generation_context, "ai_usage_flow")
        wizard = generation_context.get("wizard_profile")
        wizard = wizard if isinstance(wizard, dict) else {}

        technical_data = self._json_record(technical.get("profile_data"))
        verified_data = self._json_record(verified.get("profile_data"))
        merged = self._json_record(verified_data.get("merged_profile"))
        answers = self._json_record(wizard.get("answers"))
        classification_data = self._json_record(classification.get("classification_data"))
        evidence_payload = self._json_record(evidence_report.get("evidence_payload"))
        graph = self._json_record(
            evidence_payload.get("evidence_graph")
            or evidence_payload.get("program_evidence_graph")
        )

        source_artifacts = DossierSourceArtifacts(
            repository_snapshot_id=self._required(snapshot, "id"),
            program_evidence_graph_id=self._required_program_graph_id(graph, technical_data),
            technical_evidence_report_id=self._required(evidence_report, "id"),
            wizard_profile_id=str(wizard.get("id") or "TECHNICAL_ONLY"),
            verified_profile_id=self._required(verified, "id"),
            legal_corpus_version_id=self._required(legal_match, "corpus_version_id"),
            legal_rule_catalog_version_id=self._required(
                legal_match, "legal_rule_catalog_version_id"
            ),
            classification_result_id=self._required(classification, "id"),
            gap_matrix_ref=str(generation_context.get("matrix_ref") or ""),
        )

        context = {
            "systemIdentity": {
                "assessmentId": self._required(assessment, "id"),
                "name": assessment.get("name"),
                "description": assessment.get("description"),
                "repositorySnapshotId": source_artifacts.repository_snapshot_id,
                "commitSha": snapshot.get("commit_sha"),
            },
            "intendedUse": self._first_non_empty(
                answers.get("intendedUse"),
                answers.get("intended_use"),
                merged.get("intendedUse"),
                merged.get("intended_use"),
                answers.get("aiPurpose"),
                merged.get("aiPurpose"),
            ),
            "technicalAiProfile": technical_data,
            "dataProcessing": {
                "dataCategories": technical_data.get("data_categories") or [],
                "externalIntegrations": technical_data.get("external_integrations") or [],
            },
            "affectedSubjects": self._first_non_empty(
                merged.get("affectedSubjects"),
                merged.get("affected_subjects"),
                answers.get("affectedSubjects"),
                answers.get("affected_subjects"),
            ),
            "decisionImpact": self._select(
                merged,
                "decisionImpact",
                "decision_impact",
                "automationLevel",
                "automation_level",
                "businessActions",
            ),
            "humanOversight": self._first_non_empty(
                merged.get("humanOversight"),
                merged.get("human_oversight"),
                technical_data.get("human_control_evidence"),
            ),
            "externalProviders": technical_data.get("external_integrations") or [],
            "riskIndicators": {
                "aiDetected": technical_data.get("ai_detected"),
                "signalTypes": technical_data.get("signal_types_detected") or [],
                "unresolvedFrontiers": technical_data.get("unresolved_frontiers") or [],
            },
            "riskClassification": classification_data.get("risk_level"),
            "classificationRationale": classification_data.get("rationale"),
            "applicableProvisions": legal_match.get("matches") or [],
            "conflicts": generation_context.get("conflicts") or [],
            "unresolvedEvidence": self._unresolved_evidence(
                technical_data,
                ai_usage_flow,
                classification_data,
            ),
            # Gap/remediation are separate governed artifacts. Do not silently
            # re-implement their business rules from classification data here.
            "gaps": generation_context.get("gap_matrix") or [],
            "remediation": generation_context.get("remediation") or [],
        }
        return self._engine.build_classification_dossier(
            assessment_id=self._required(request, "assessment_id"),
            organization_id=self._required(request, "organization_id"),
            version=max(1, int(verified.get("version") or 1)),
            source_artifacts=source_artifacts,
            context=context,
            evidence_appendix=self._evidence_appendix(graph),
        )

    @staticmethod
    def _record(payload: dict[str, Any], key: str) -> dict[str, Any]:
        value = payload.get(key)
        if not isinstance(value, dict):
            raise ValueError(f"missing dossier source artifact: {key}")
        return value

    @staticmethod
    def _json_record(value: object) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _required(payload: dict[str, Any], key: str) -> str:
        value = payload.get(key)
        if not value:
            raise ValueError(f"missing dossier source identifier: {key}")
        return str(value)

    @staticmethod
    def _required_program_graph_id(
        graph: dict[str, Any], technical_data: dict[str, Any]
    ) -> str:
        graph_ref = technical_data.get("program_graph_ref")
        graph_ref = graph_ref if isinstance(graph_ref, dict) else {}
        value = graph.get("graph_id") or graph.get("graphId") or graph_ref.get("graphId")
        if not value:
            raise ValueError("missing dossier source identifier: program evidence graph")
        return str(value)

    @staticmethod
    def _first_non_empty(*values: object) -> object:
        for value in values:
            if value not in (None, "", [], {}):
                return value
        return None

    @staticmethod
    def _select(payload: dict[str, Any], *keys: str) -> dict[str, Any] | None:
        result = {key: payload[key] for key in keys if payload.get(key) not in (None, "", [], {})}
        return result or None

    @staticmethod
    def _unresolved_evidence(
        technical_data: dict[str, Any],
        ai_usage_flow: dict[str, Any],
        classification_data: dict[str, Any],
    ) -> list[object]:
        values: list[object] = []
        values.extend(technical_data.get("unresolved_frontiers") or [])
        values.extend(ai_usage_flow.get("unknown_usages") or [])
        if classification_data.get("guardrail_reason"):
            values.append(classification_data["guardrail_reason"])
        return values

    @staticmethod
    def _evidence_appendix(graph: dict[str, Any]) -> list[dict[str, Any]]:
        anchors = graph.get("source_anchors") or graph.get("sourceAnchors") or []
        return [dict(anchor) for anchor in anchors if isinstance(anchor, dict)]
