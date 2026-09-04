"""Consume AIUsageFlow events and persist customer_context/evidence conflict records."""

from __future__ import annotations

from typing import Any

from structlog import get_logger

from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.callback_schemas import ConflictDetectionCallbackPayload
from tools.common.capabilities.managed.boundary import AgentBoundaryBase

from .conflict_detector import ConflictDetector


logger = get_logger(__name__)


class ConflictDetectionBoundary(AgentBoundaryBase):
    """Compare accepted AI usage flow facts with the assessment customer_context."""

    boundary_source = "intelligence.ai-usage-flow-ready"
    source_event = "event.ai-usage-flow.ready.v1"
    requires_rbac = False

    def __init__(
        self,
        config,
        rbac_client=None,
        api_client: WorkerApiClient | None = None,
        detector: ConflictDetector | None = None,
    ) -> None:
        """Create the boundary with injectable API and conflict-detector adapters."""
        super().__init__(config, rbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._detector = detector or ConflictDetector()

    def handle(self, message: dict, correlationId: str) -> None:
        """Fetch canonical artifacts, detect conflicts, and submit the callback.

        Args:
            message: AI-usage-flow-ready event containing the flow identifier.
            correlationId: End-to-end trace identifier for the delivery.

        Raises:
            ValueError: If required identifiers are missing or the callback's
                privacy assertion permits source code.
        """
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
        callback_data = self._detector.to_callback_payload(
            ai_usage_flow=ai_usage_flow,
            confirmed_customer_context=None,
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
            correlationId=correlationId,
        )

    def _required_message_id(self, message: dict[str, Any], key: str) -> str:
        """Resolve a required camelCase event ID from camel/snake-case variants."""
        snake_key = key[0].lower() + "".join(
            f"_{char.lower()}" if char.isupper() else char for char in key[1:]
        )
        value = message.get(key) or message.get(snake_key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)
