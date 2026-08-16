"""Bridge resolved reconciliation state into the canonical verified-profile command."""

from __future__ import annotations

from uuid import NAMESPACE_URL, uuid5
from typing import Any

from structlog import get_logger

from lcsp_workers.platform.api_client import WorkerApiClient, WorkerCallbackError
from lcsp_workers.platform.callback_schemas import VerifiedProfileCallbackPayload
from lcsp_workers.platform.queue_consumer import ConsumerBase


logger = get_logger(__name__)


class PendingConflictsExist(RuntimeError):
    """Signal ConsumerBase to requeue while reconciliation is still pending."""


class VerifiedProfileConsumer(ConsumerBase):
    """Submit pinned reconciliation inputs after all conflicts are resolved.

    This worker no longer computes or persists a second VerifiedProfile shape.
    ``ReconcileProfileToVerifiedProfileHandler`` is the single persistence owner
    and re-validates Wizard, TechnicalEvidenceReport, AIUsageFlow and decision refs.
    """

    queue_name = "intelligence.all-conflicts-resolved"
    routing_key = "event.reconciliation.all-conflicts-resolved.v1"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )

    def handle(self, message: dict, correlationId: str) -> None:
        """Resolve source IDs and invoke the canonical reconciliation persistence path."""
        assessment_id = self._required_message_id(message, "assessmentId")
        ai_usage_flow_id = self._optional_message_id(message, "aiUsageFlowId")
        context = self._api_client.get_verified_profile_reconciliation_context(
            assessment_id,
            ai_usage_flow_id,
        )
        ai_usage_flow = self._required_context_dict(context, "ai_usage_flow")
        conflict_records = self._conflict_records(context)
        if self._has_pending_conflicts(conflict_records):
            raise PendingConflictsExist("PENDING_CONFLICTS_EXIST")

        callback_payload = VerifiedProfileCallbackPayload(
            ai_usage_flow_id=self._flow_id(ai_usage_flow),
            assessment_id=assessment_id,
            wizard_profile_id=self._wizard_id(context),
            technical_evidence_report_id=self._required_context_id(
                context, "technical_evidence_report_id"
            ),
            reconciliation_decision_refs=self._decision_refs(conflict_records),
            idempotency_key=str(
                uuid5(
                    NAMESPACE_URL,
                    f"{assessment_id}:{self._flow_id(ai_usage_flow)}",
                )
            ),
            organization_id=self._required_context_id(
                ai_usage_flow, "organization_id"
            ),
        )
        try:
            self._api_client.post_verified_profile_callback(callback_payload)
        except WorkerCallbackError as error:
            if "PENDING_CONFLICTS_EXIST" in str(error):
                raise PendingConflictsExist("PENDING_CONFLICTS_EXIST") from error
            raise
        logger.info(
            "VERIFIED_PROFILE_RECONCILIATION_SUBMITTED",
            ai_usage_flow_id=callback_payload.ai_usage_flow_id,
            assessment_id=callback_payload.assessment_id,
            technical_evidence_report_id=(
                callback_payload.technical_evidence_report_id
            ),
            reconciliation_decision_ref_count=len(
                callback_payload.reconciliation_decision_refs
            ),
            correlationId=correlationId,
        )

    def _required_message_id(self, message: dict[str, Any], key: str) -> str:
        snake_key = key[0].lower() + "".join(
            f"_{char.lower()}" if char.isupper() else char for char in key[1:]
        )
        value = message.get(key) or message.get(snake_key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)

    def _optional_message_id(self, message: dict[str, Any], key: str) -> str | None:
        snake_key = key[0].lower() + "".join(
            f"_{char.lower()}" if char.isupper() else char for char in key[1:]
        )
        value = message.get(key) or message.get(snake_key)
        return str(value) if value else None

    def _required_context_dict(
        self, context: dict[str, Any], key: str
    ) -> dict[str, Any]:
        camel_key = "".join(
            part.capitalize() if index else part
            for index, part in enumerate(key.split("_"))
        )
        value = context.get(key) or context.get(camel_key)
        if not isinstance(value, dict):
            raise ValueError(f"missing {key}")
        return value

    def _optional_context_dict(
        self,
        context: dict[str, Any],
        key: str,
    ) -> dict[str, Any] | None:
        camel_key = "".join(
            part.capitalize() if index else part
            for index, part in enumerate(key.split("_"))
        )
        value = context.get(key) or context.get(camel_key)
        return value if isinstance(value, dict) else None

    def _conflict_records(self, context: dict[str, Any]) -> list[dict[str, Any]]:
        records = (
            context.get("conflicts")
            or context.get("conflict_records")
            or context.get("conflictRecords")
            or []
        )
        return [record for record in records if isinstance(record, dict)]

    def _has_pending_conflicts(self, records: list[dict[str, Any]]) -> bool:
        return any(
            str(record.get("status") or "").upper() == "PENDING"
            for record in records
        )

    def _flow_id(self, ai_usage_flow: dict[str, Any]) -> str:
        value = (
            ai_usage_flow.get("ai_usage_flow_id")
            or ai_usage_flow.get("aiUsageFlowId")
            or ai_usage_flow.get("id")
        )
        if not value:
            raise ValueError("missing ai_usage_flow_id")
        return str(value)

    def _wizard_id(self, context: dict[str, Any]) -> str:
        wizard = self._optional_context_dict(context, "wizard_profile")
        if not wizard:
            raise ValueError("missing wizard_profile")
        return self._required_context_id(wizard, "id")

    def _required_context_id(self, context: dict[str, Any], key: str) -> str:
        value = context.get(key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)

    def _decision_refs(self, records: list[dict[str, Any]]) -> list[str]:
        refs: list[str] = []
        for record in records:
            conflict_id = record.get("conflict_id") or record.get("conflictId") or record.get("id")
            if not conflict_id:
                raise ValueError("conflict record missing id")
            refs.append(f"reconciliation:{conflict_id}")
        return sorted(refs)
