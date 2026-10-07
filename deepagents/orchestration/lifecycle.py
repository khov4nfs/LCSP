"""Root orchestration lifecycle hooks for LCSP specialist dispatch.

The root supervisor owns workflow transitions for every specialist. Legal authoring is not
dispatched here: the Legal Preparation Deep Agent (``legal_preparation/``) is the only legal
authority and runs outside the assessment root.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RootSubagentReservation:
    """Root-owned dispatch state for one specialist invocation."""

    subagent_type: str
    status: str
    execution_id: str | None = None
    trigger: str | None = None


class RootOrchestrationLifecycle:
    """Own specialist begin/fail/complete transitions for the LCSP root supervisor."""

    def reserve_subagent(
        self,
        *,
        subagent_type: str,
        affected_rule_ids: list[str] | None = None,
        idempotency_key: str | None = None,
        trigger: str | None = None,
    ) -> RootSubagentReservation:
        """Every specialist starts immediately; there is no legal singleton to claim."""
        _ = affected_rule_ids, idempotency_key
        return RootSubagentReservation(
            subagent_type=str(subagent_type or "").strip(),
            status="READY",
            trigger=trigger,
        )

    @staticmethod
    def owner_instruction(reservation: RootSubagentReservation) -> str:
        """No specialist receives root-owned execution instructions."""
        _ = reservation
        return ""

    def fail_subagent(self, reservation: RootSubagentReservation) -> None:
        """No specialist holds runtime ownership that must be released."""
        _ = reservation

    def complete_subagent(self, reservation: RootSubagentReservation) -> dict[str, Any]:
        """Report a successfully returned specialist."""
        return {"status": "COMPLETE", "subagentType": reservation.subagent_type}
