"""Consume legal-corpus recovery commands and delegate the validated recovery pipeline."""

from __future__ import annotations

from typing import Any

from tools.legal.sources.recovery.legal_corpus_recovery_driver import (
    LEGAL_CORPUS_RECOVERY_COMMAND,
    LEGAL_CORPUS_RECOVERY_BOUNDARY_SOURCE,
    LegalCorpusRecoveryDriver,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.managed.boundary import AgentBoundaryBase


class LegalCorpusRecoveryBoundary(AgentBoundaryBase):
    """Bridge system recovery events to the legal corpus recovery driver."""

    boundary_source = LEGAL_CORPUS_RECOVERY_BOUNDARY_SOURCE
    source_event = LEGAL_CORPUS_RECOVERY_COMMAND
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        driver: LegalCorpusRecoveryDriver | None = None,
    ) -> None:
        """Create the boundary with injectable API client and recovery driver.

        Args:
            config: Managed Agent runtime configuration.
            pbac_client: Optional base-boundary PBAC dependency; unused for system events.
            api_client: Optional internal API client override.
            driver: Optional corpus recovery driver override.
        """
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._driver = driver or LegalCorpusRecoveryDriver(
            api_client=self._api_client
        )

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        """Run the idempotent corpus recovery pipeline for one system command.

        Args:
            message: Recovery command containing the required idempotency key and
                optional resume limits.
            correlationId: End-to-end trace identifier for the delivery.
        """
        self._driver.run(message, correlationId)
