"""The two governed portfolio tools. Run identity and idempotency are server-bound."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from langchain_core.tools import tool

from tools.common.capabilities.platform.api_client import WorkerCallbackError

SUBMISSION_IDEMPOTENCY_PREFIX = "legal-preparation-submit-"


class PortfolioApi(Protocol):
    """The slice of the worker API client the agent tools use."""

    def validate_legal_portfolio(self, preparation_run_id: str, packet: dict) -> dict: ...

    def submit_legal_portfolio(
        self, preparation_run_id: str, idempotency_key: str, packet: dict
    ) -> dict: ...


@dataclass
class LegalPreparationContext:
    """Per-run state. The agent never supplies the run id or the idempotency key."""

    run_id: str
    api: PortfolioApi
    submission: dict[str, Any] | None = None
    validation_calls: int = 0
    last_validation: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)
    # Per-call record of the governed tools (no packet content): what was validated/submitted
    # and which mechanical failure codes came back. Lets a failed run be diagnosed.
    trace: list[dict[str, Any]] = field(default_factory=list)

    @property
    def idempotency_key(self) -> str:
        return f"{SUBMISSION_IDEMPOTENCY_PREFIX}{self.run_id}"


def _as_packet(packet: Any) -> dict:
    if isinstance(packet, str):
        packet = json.loads(packet)
    if not isinstance(packet, dict):
        raise ValueError("packet must be a JSON object with legalRules, engineeringRules and contextRelations")
    return packet


def build_portfolio_tools(context: LegalPreparationContext) -> list:
    """Return ``validate_legal_portfolio`` and ``submit_legal_portfolio`` bound to one run."""

    @tool
    def validate_legal_portfolio(packet: dict) -> str:
        """Dry-run the mechanical integrity validation of a COMPLETE portfolio packet.

        Nothing is persisted. Returns {"outcome": "PASSED"|"FAILED", "failures": [...]}; each
        failure has a code, the packet-local ref it concerns and a short detail. Fix every
        failure in the packet and validate again before the single submission.
        """
        context.validation_calls += 1
        try:
            result = context.api.validate_legal_portfolio(context.run_id, _as_packet(packet))
        except (ValueError, WorkerCallbackError) as error:
            context.errors.append(str(error))
            context.trace.append({"tool": "validate", "error": str(error)[:160]})
            return json.dumps({"error": str(error)})
        context.last_validation = result
        counts: dict[str, int] = {}
        for failure in result.get("failures") or ():
            counts[failure.get("code", "?")] = counts.get(failure.get("code", "?"), 0) + 1
        context.trace.append({"tool": "validate", "outcome": result.get("outcome"), "failureCodes": counts})
        return json.dumps(result, ensure_ascii=False)

    @tool
    def submit_legal_portfolio(packet: dict) -> str:
        """Submit the COMPLETE portfolio packet once. It is validated and, when mechanically
        valid, activated automatically in one atomic step. There is no review or approval.

        If the result is FAILED the attempted portfolio is NOT activated, the previous ACTIVE
        portfolio stays in place and this run is finished: do not call this tool again.
        """
        if context.submission is not None:
            return json.dumps({**context.submission, "alreadySubmitted": True}, ensure_ascii=False)
        try:
            result = context.api.submit_legal_portfolio(
                context.run_id, context.idempotency_key, _as_packet(packet)
            )
        except (ValueError, WorkerCallbackError) as error:
            context.errors.append(str(error))
            return json.dumps({"error": str(error)})
        context.submission = result
        context.trace.append({"tool": "submit", "outcome": (result.get("validation") or {}).get("outcome")})
        return json.dumps(result, ensure_ascii=False)

    return [validate_legal_portfolio, submit_legal_portfolio]
