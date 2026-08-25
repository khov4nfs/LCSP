"""Managed Deep Agents boundary base classes.

Legacy asynchronous handlers now run as explicit Managed Agent invocation
boundaries. The boundary base owns no broker connection, health endpoint, retry
lane, or runtime HTTP bridge; Managed Deep Agents scheduling/invocation owns
process lifecycle and human approval.
"""

from __future__ import annotations

from typing import Any


class NonRetryableAgentBoundaryError(RuntimeError):
    """Signals a terminal boundary failure already represented in domain state."""


class AgentBoundaryBase:
    """Base class for one LCSP Managed Agent invocation boundary."""

    boundary_source: str = ""
    source_event: str = ""
    requires_pbac: bool = True
    retry_delays_seconds: tuple[int, ...] = ()

    def __init__(self, config: Any, pbac_client: Any | None = None) -> None:
        self._config = config
        self._pbac = pbac_client

    @property
    def boundary_name(self) -> str:
        """Return the stable boundary name used in logs and invocation manifests."""
        return self.__class__.__name__

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        """Process one Managed Agent invocation payload."""
        raise NotImplementedError
