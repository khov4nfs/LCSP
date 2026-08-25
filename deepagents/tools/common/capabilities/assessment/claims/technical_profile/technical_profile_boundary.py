"""Consume accepted technical evidence and persist a privacy-safe technical profile."""

from __future__ import annotations

import json

from typing import Any

from structlog import get_logger

from tools.common.capabilities.assessment.investigation.engineering_rule.pipeline import (
    EngineeringInvestigationPipeline,
    EngineeringInvestigationResult,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.callback_schemas import TechnicalProfileCallbackPayload
from tools.common.capabilities.managed.boundary import AgentBoundaryBase
from tools.common.capabilities.platform.wizard_clarification import (
    engineering_rule_source_clarification_summary,
)

from .technical_profile_builder import TechnicalProfileBuilder


logger = get_logger(__name__)
MAX_ENGINEERING_CLAIMS = 100
WAITING_ENGINEERING_INVESTIGATION_STATUSES = {"WAITING"}


class TechnicalProfileBoundary(AgentBoundaryBase):
    """Bridge accepted TechnicalEvidenceReport artifacts to technical profiles.

    The boundary is also the production lifecycle owner that runs cached
    EngineeringRule investigation against the persisted Program Evidence Graph
    before TechnicalProfile persistence. Nest supplies authoritative legal data;
    Python owns compilation/query/synthesis/validation.
    """

    boundary_source = "intelligence.evidence-accepted"
    source_event = "event.technical-evidence.accepted.v1"
    requires_pbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        profile_builder: TechnicalProfileBuilder | None = None,
        investigation_pipeline: EngineeringInvestigationPipeline | None = None,
    ) -> None:
        """Create the boundary and its deterministic/profile investigation dependencies."""
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._profile_builder = profile_builder or TechnicalProfileBuilder()
        self._investigation_pipeline = investigation_pipeline

    def handle(self, message: dict, correlationId: str) -> None:
        """Fetch accepted evidence, investigate it, build a profile, and callback the API."""
        evidence_report_id = self._evidence_report_id(message)
        evidence_report = self._api_client.get_accepted_technical_evidence_report(
            evidence_report_id
        )
        profile = self._profile_builder.build(evidence_report)
        investigation = self._engineering_investigation(
            message=message,
            evidence_report=evidence_report,
            evidence_report_id=evidence_report_id,
            correlation_id=correlationId,
        )
        if investigation.status in WAITING_ENGINEERING_INVESTIGATION_STATUSES:
            self._emit_investigation_waiting_runtime_event(
                scan_job_id=self._scan_job_id(evidence_report),
                investigation=investigation,
                correlation_id=correlationId,
            )
            raise RuntimeError(
                "engineering investigation is waiting for legal rule source rebuild"
            )
        profile_data = profile.to_profile_data()
        profile_data["engineering_investigation"] = investigation.to_profile_data()

        import os
        from tools.common.capabilities.platform.correlation import get_user_id, get_assessment_id
        from tools.common.capabilities.platform.logging_path import get_partitioned_graph_path
        user_id = get_user_id()
        assessment_id = profile.assessment_id or get_assessment_id()
        ref_path = get_partitioned_graph_path(user_id, assessment_id, f"lcsp-technical-profile-data-{profile.evidence_report_id}.json")
        os.makedirs(os.path.dirname(ref_path), exist_ok=True)
        self._write_profile_data_ref(ref_path, profile_data)
        minimized_profile_data = self._minimized_profile_data(
            profile_data=profile_data,
            profile_data_ref=ref_path,
        )

        callback_payload = TechnicalProfileCallbackPayload(
            evidence_report_id=profile.evidence_report_id,
            assessment_id=profile.assessment_id,
            schema_version=profile.schema_version,
            provider_version=profile.provider_version,
            profile_data=minimized_profile_data,
            privacy_flags=profile.privacy_flags,
            scan_job_id=self._scan_job_id(evidence_report),
        )
        if callback_payload.privacy_flags.get("containsSourceCode") is not False:
            raise ValueError("TechnicalProfile callback privacy flag is unsafe")
        self._api_client.post_technical_profile_callback(callback_payload)
        logger.info(
            "TECHNICAL_PROFILE_CALLBACK_SUBMITTED",
            evidence_report_id=profile.evidence_report_id,
            assessment_id=profile.assessment_id,
            evidence_quality=profile.evidence_quality,
            engineering_investigation_status=investigation.status,
            engineering_claim_count=len(investigation.claims),
            correlationId=correlationId,
        )

    def _write_profile_data_ref(
        self,
        ref_path: str,
        profile_data: dict[str, Any],
    ) -> None:
        try:
            with open(ref_path, "w", encoding="utf-8") as f:
                json.dump(profile_data, f, ensure_ascii=False)
        except Exception:
            logger.warning(
                "TECHNICAL_PROFILE_DATA_REF_WRITE_FAILED",
                profile_data_ref=ref_path,
            )

    def _minimized_profile_data(
        self,
        *,
        profile_data: dict[str, Any],
        profile_data_ref: str,
    ) -> dict[str, Any]:
        investigation = profile_data.get("engineering_investigation")
        if not isinstance(investigation, dict):
            investigation = {}
        investigation_claims = investigation.get("claims")
        claim_count = (
            len(investigation_claims) if isinstance(investigation_claims, list) else 0
        )

        return {
            "schema_version": profile_data.get("schema_version"),
            "provider_version": profile_data.get("provider_version"),
            "evidence_report_id": profile_data.get("evidence_report_id"),
            "assessment_id": profile_data.get("assessment_id"),
            "organization_id": profile_data.get("organization_id"),
            "evidence_quality": profile_data.get("evidence_quality"),
            "tool_coverage": profile_data.get("tool_coverage", {}),
            "ai_usage_signal_count": profile_data.get("ai_usage_signal_count", 0),
            "signal_types_detected": self._sample_strings(
                profile_data.get("signal_types_detected", []),
                limit=100,
            ),
            "dependency_ai_packages": self._sample_strings(
                profile_data.get("dependency_ai_packages", []),
                limit=100,
            ),
            "privacy_flags": profile_data.get("privacy_flags", {}),
            "ai_detected": profile_data.get("ai_detected"),
            "confidence": profile_data.get("confidence"),
            "evidence_refs": self._sample_strings(
                profile_data.get("evidence_refs", []),
                limit=100,
            ),
            "evidence_refs_count": len(profile_data.get("evidence_refs", []))
            if isinstance(profile_data.get("evidence_refs"), list)
            else 0,
            "program_graph_ref": profile_data.get("program_graph_ref", {}),
            "data_categories": self._sample_strings(
                profile_data.get("data_categories", []),
                limit=100,
            ),
            "human_control_evidence": profile_data.get("human_control_evidence", {}),
            "coverage_notes_count": len(profile_data.get("coverage_notes", []))
            if isinstance(profile_data.get("coverage_notes"), list)
            else 0,
            "unresolved_frontiers_count": len(
                profile_data.get("unresolved_frontiers", [])
            )
            if isinstance(profile_data.get("unresolved_frontiers"), list)
            else 0,
            "external_integrations": [],
            "business_actions": [],
            "dependency_licenses": [],
            "engineering_investigation": {
                "status": investigation.get("status", "NOT_RUN"),
                "legal_rule_catalog_version_id": investigation.get(
                    "legal_rule_catalog_version_id", ""
                ),
                "legal_corpus_version_id": investigation.get(
                    "legal_corpus_version_id", ""
                ),
                "rules_considered": investigation.get("rules_considered", 0),
                "engineering_rules_executed": investigation.get(
                    "engineering_rules_executed", 0
                ),
                "engineering_rule_cache_hits": investigation.get(
                    "engineering_rule_cache_hits", 0
                ),
                "limitations": self._sample_strings(
                    investigation.get("limitations", []),
                    limit=100,
                ),
                "claim_count": claim_count,
                "claims_truncated": claim_count > MAX_ENGINEERING_CLAIMS,
                "claims": self._sample_records(
                    investigation_claims,
                    limit=MAX_ENGINEERING_CLAIMS,
                ),
            },
            "profile_data_ref": profile_data_ref,
        }

    def _sample_strings(self, value: Any, *, limit: int) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value[:limit] if str(item)]

    def _sample_records(
        self,
        value: Any,
        *,
        limit: int,
    ) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        return [dict(item) for item in value[:limit] if isinstance(item, dict)]

    def _engineering_investigation(
        self,
        *,
        message: dict[str, Any],
        evidence_report: dict[str, Any],
        evidence_report_id: str,
        correlation_id: str,
    ) -> EngineeringInvestigationResult:
        if self._investigation_pipeline is None:
            return EngineeringInvestigationResult(
                status="NOT_RUN",
                legal_rule_catalog_version_id="",
                legal_corpus_version_id="",
                rules_considered=0,
                engineering_rules_executed=0,
                engineering_rule_cache_hits=0,
                limitations=("ENGINEERING_INVESTIGATION_LLM_RUNTIME_DISABLED",),
            )
        workflow_run_id = str(
            message.get("workflowRunId")
            or message.get("workflow_run_id")
            or self._scan_job_id(evidence_report)
            or evidence_report_id
        )
        return self._investigation_pipeline.run(
            evidence_report=evidence_report,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
        )

    def _emit_investigation_waiting_runtime_event(
        self,
        *,
        scan_job_id: str | None,
        investigation: EngineeringInvestigationResult,
        correlation_id: str,
    ) -> None:
        if not scan_job_id:
            return
        post_runtime_event = getattr(self._api_client, "post_scan_runtime_event", None)
        if post_runtime_event is None:
            return
        post_runtime_event(
            scan_job_id,
            {
                "event_type": "TOOL_WAITING_INPUT",
                "run_status": "WAITING",
                "stage": "SCAN",
                "tool_name": "engineering_rule_planner",
                "summary": (
                    "Engineering rule source catalog is empty; waiting for "
                    "corpus chunk triage and EngineeringRule rebuild"
                ),
                "waiting_reason": "NO_ENGINEERING_RULE_SOURCE_RULES",
                "output_summary": engineering_rule_source_clarification_summary(
                    base_summary={
                        "status": investigation.status,
                        "legalRuleCatalogVersionId": (
                            investigation.legal_rule_catalog_version_id
                        ),
                        "legalCorpusVersionId": investigation.legal_corpus_version_id,
                        "limitations": list(investigation.limitations),
                        "correlationId": correlation_id,
                    },
                ),
            },
        )

    def _evidence_report_id(self, message: dict[str, Any]) -> str:
        """Resolve and validate the evidence-report identifier from supported event aliases."""
        value = (
            message.get("evidenceReportId")
            or message.get("evidence_report_id")
            or message.get("technicalEvidenceReportId")
            or message.get("aggregateId")
        )
        if not value:
            raise ValueError("missing evidenceReportId")
        return str(value)

    def _scan_job_id(self, evidence_report: dict[str, Any]) -> str | None:
        """Read the optional originating scan-job identifier from an artifact."""
        value = evidence_report.get("scan_job_id") or evidence_report.get("scanJobId")
        return str(value) if value else None
