"""Finalize verified profiles only after the reconciliation conflict gate closes."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5
from typing import Any

from structlog import get_logger

from lcsp_workers.platform.api_client import WorkerApiClient, WorkerCallbackError
from lcsp_workers.platform.callback_schemas import VerifiedProfileCallbackPayload
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .verified_profile_builder import (
    DEFAULT_PROVIDER_VERSION,
    SCHEMA_VERSION,
    VerifiedProfileBuilder,
)


logger = get_logger(__name__)


class PendingConflictsExist(RuntimeError):
    """Signal ConsumerBase to requeue while reconciliation is still pending."""


class VerifiedProfileConsumer(ConsumerBase):
    """Build and persist a verified profile after all conflicts are resolved."""

    queue_name = "intelligence.all-conflicts-resolved"
    routing_key = "event.reconciliation.all-conflicts-resolved.v1"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        builder: VerifiedProfileBuilder | None = None,
    ) -> None:
        """Create the consumer with injectable API and profile-builder adapters."""
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._builder = builder or VerifiedProfileBuilder()

    def handle(self, message: dict, correlationId: str) -> None:
        """Load reconciliation context, enforce the gate, and submit the profile.

        Args:
            message: All-conflicts-resolved event for an assessment/AIUsageFlow.
            correlationId: End-to-end trace identifier for the delivery.

        Raises:
            PendingConflictsExist: When the canonical reconciliation context still
                contains a PENDING conflict, causing the message to be requeued.
            ValueError: If required context identifiers/artifacts are missing.
        """
        assessment_id = self._required_message_id(message, "assessmentId")
        ai_usage_flow_id = self._optional_message_id(message, "aiUsageFlowId")
        conflicts_resolved_at = self._event_timestamp(message)
        context = self._api_client.get_verified_profile_reconciliation_context(
            assessment_id,
            ai_usage_flow_id,
        )
        ai_usage_flow = self._required_context_dict(context, "ai_usage_flow")
        conflict_records = self._conflict_records(context)
        if self._has_pending_conflicts(conflict_records):
            raise PendingConflictsExist("PENDING_CONFLICTS_EXIST")

        profile = self._builder.build(
            ai_usage_flow=ai_usage_flow,
            conflict_records=conflict_records,
            wizard_profile=self._optional_context_dict(context, "wizard_profile"),
            conflicts_resolved_at=conflicts_resolved_at,
        )
        callback_payload = VerifiedProfileCallbackPayload(
            ai_usage_flow_id=self._flow_id(ai_usage_flow),
            assessment_id=assessment_id,
            schema_version=SCHEMA_VERSION,
            provider_version=DEFAULT_PROVIDER_VERSION,
            profile_data=profile.to_dict(),
            gates_passed_at=profile.gates_passed_at,
            wizard_profile_id=self._wizard_id(context),
            technical_evidence_report_id=self._required_context_id(
                context, "technical_evidence_report_id"
            ),
            reconciliation_decision_refs=self._decision_refs(conflict_records),
            idempotency_key=str(uuid5(NAMESPACE_URL, f"{assessment_id}:{self._flow_id(ai_usage_flow)}")),
            organization_id=self._required_context_id(ai_usage_flow, "organization_id"),
        )
        try:
            self._api_client.post_verified_profile_callback(callback_payload)
        except WorkerCallbackError as error:
            if "PENDING_CONFLICTS_EXIST" in str(error):
                raise PendingConflictsExist("PENDING_CONFLICTS_EXIST") from error
            raise
        logger.info(
            "VERIFIED_PROFILE_CALLBACK_SUBMITTED",
            ai_usage_flow_id=callback_payload.ai_usage_flow_id,
            assessment_id=callback_payload.assessment_id,
            evidence_chain_integrity=profile.evidence_chain_integrity,
            correlationId=correlationId,
        )

    def _required_message_id(self, message: dict[str, Any], key: str) -> str:
        """Resolve a required event identifier from camel/snake-case aliases."""
        snake_key = key[0].lower() + "".join(
            f"_{char.lower()}" if char.isupper() else char for char in key[1:]
        )
        value = message.get(key) or message.get(snake_key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)

    def _optional_message_id(self, message: dict[str, Any], key: str) -> str | None:
        """Resolve an optional event identifier from camel/snake-case aliases."""
        snake_key = key[0].lower() + "".join(
            f"_{char.lower()}" if char.isupper() else char for char in key[1:]
        )
        value = message.get(key) or message.get(snake_key)
        return str(value) if value else None

    def _event_timestamp(self, message: dict[str, Any]) -> str:
        """Read the conflict-resolution timestamp or generate a UTC gate time."""
        value = (
            message.get("conflictsResolvedAt")
            or message.get("conflicts_resolved_at")
            or message.get("occurredAt")
            or message.get("occurred_at")
            or message.get("eventTime")
            or message.get("event_time")
        )
        if value:
            return str(value)
        # Current outbox payloads only guarantee assessmentId, so preserve
        # forward progress with a worker-side UTC gate timestamp when needed.
        return datetime.now(timezone.utc).isoformat()

    def _required_context_dict(self, context: dict[str, Any], key: str) -> dict[str, Any]:
        """Read a required dictionary artifact from snake/camel-case context."""
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
        """Read an optional dictionary artifact from snake/camel-case context."""
        camel_key = "".join(
            part.capitalize() if index else part
            for index, part in enumerate(key.split("_"))
        )
        value = context.get(key) or context.get(camel_key)
        return value if isinstance(value, dict) else None

    def _conflict_records(self, context: dict[str, Any]) -> list[dict[str, Any]]:
        """Normalize supported conflict-list aliases into structured records."""
        records = (
            context.get("conflicts")
            or context.get("conflict_records")
            or context.get("conflictRecords")
            or []
        )
        return [record for record in records if isinstance(record, dict)]

    def _has_pending_conflicts(self, records: list[dict[str, Any]]) -> bool:
        """Return whether any reconciliation conflict still has PENDING status."""
        return any(str(record.get("status") or "").upper() == "PENDING" for record in records)

    def _flow_id(self, ai_usage_flow: dict[str, Any]) -> str:
        """Resolve the canonical AIUsageFlow identifier from supported aliases."""
        return str(
            ai_usage_flow.get("ai_usage_flow_id")
            or ai_usage_flow.get("aiUsageFlowId")
            or ai_usage_flow.get("id")
            or "ai-usage-flow"
        )

    def _wizard_id(self, context: dict[str, Any]) -> str:
        """Return the required wizard profile ID from reconciliation context."""
        wizard = self._optional_context_dict(context, "wizard_profile")
        if not wizard:
            raise ValueError("missing wizard_profile")
        return self._required_context_id(wizard, "id")

    def _required_context_id(self, context: dict[str, Any], key: str) -> str:
        """Read and stringify a required identifier from an artifact/context."""
        value = context.get(key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)

    def _decision_refs(self, records: list[dict[str, Any]]) -> list[str]:
        """Build stable reconciliation decision references for the callback."""
        return sorted(f"reconciliation:{record['conflict_id']}" for record in records)
