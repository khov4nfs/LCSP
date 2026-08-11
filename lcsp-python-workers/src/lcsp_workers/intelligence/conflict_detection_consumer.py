from __future__ import annotations

from typing import Any

from structlog import get_logger

from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.callback_schemas import ConflictDetectionCallbackPayload
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .conflict_detector import ConflictDetector


logger = get_logger(__name__)


class ConflictDetectionConsumer(ConsumerBase):
    queue_name = "intelligence.ai-usage-flow-ready"
    routing_key = "event.ai-usage-flow.ready.v1"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        detector: ConflictDetector | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._detector = detector or ConflictDetector()

    def handle(self, message: dict, correlation_id: str) -> None:
        ai_usage_flow_id = self._required_message_id(message, "aiUsageFlowId")
        ai_usage_flow = self._api_client.get_accepted_ai_usage_flow(ai_usage_flow_id)
        assessment_id = (
            message.get("assessmentId")
            or message.get("assessment_id")
            or ai_usage_flow.get("assessment_id")
            or ai_usage_flow.get("assessmentId")
        )
        if not assessment_id:
            raise ValueError("missing assessmentId")
        wizard_profile = self._api_client.get_wizard_profile_for_assessment(
            str(assessment_id)
        )
        callback_data = self._detector.to_callback_payload(
            ai_usage_flow=ai_usage_flow,
            wizard_profile=wizard_profile,
        )
        callback_payload = ConflictDetectionCallbackPayload(**callback_data)
        if callback_payload.privacy_flags.get("containsSourceCode") is not False:
            raise ValueError("Conflict detection callback privacy flag is unsafe")
        self._api_client.post_reconciliation_conflict_callback(callback_payload)
        logger.info(
            "CONFLICT_DETECTION_CALLBACK_SUBMITTED",
            ai_usage_flow_id=callback_payload.ai_usage_flow_id,
            assessment_id=callback_payload.assessment_id,
            conflict_count=len(callback_payload.conflicts),
            correlation_id=correlation_id,
        )

    def _required_message_id(self, message: dict[str, Any], key: str) -> str:
        snake_key = key[0].lower() + "".join(
            f"_{char.lower()}" if char.isupper() else char for char in key[1:]
        )
        value = message.get(key) or message.get(snake_key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)
