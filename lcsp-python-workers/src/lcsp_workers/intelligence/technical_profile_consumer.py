from __future__ import annotations

from typing import Any

from structlog import get_logger

from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.callback_schemas import TechnicalProfileCallbackPayload
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .technical_profile_builder import TechnicalProfileBuilder


logger = get_logger(__name__)


class TechnicalProfileConsumer(ConsumerBase):
    queue_name = "intelligence.evidence-accepted"
    routing_key = "event.technical-evidence.accepted.v1"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        profile_builder: TechnicalProfileBuilder | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._profile_builder = profile_builder or TechnicalProfileBuilder()

    def handle(self, message: dict, correlationId: str) -> None:
        evidence_report_id = self._evidence_report_id(message)
        evidence_report = self._api_client.get_accepted_technical_evidence_report(
            evidence_report_id
        )
        profile = self._profile_builder.build(evidence_report)
        callback_payload = TechnicalProfileCallbackPayload(
            evidence_report_id=profile.evidence_report_id,
            assessment_id=profile.assessment_id,
            schema_version=profile.schema_version,
            provider_version=profile.provider_version,
            profile_data=profile.to_profile_data(),
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
            correlationId=correlationId,
        )

    def _evidence_report_id(self, message: dict[str, Any]) -> str:
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
        value = evidence_report.get("scan_job_id") or evidence_report.get("scanJobId")
        return str(value) if value else None
