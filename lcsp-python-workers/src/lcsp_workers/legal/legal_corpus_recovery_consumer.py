from __future__ import annotations

from typing import Any

from lcsp_workers.legal.legal_corpus_recovery_driver import (
    LEGAL_CORPUS_RECOVERY_COMMAND,
    LEGAL_CORPUS_RECOVERY_QUEUE,
    LegalCorpusRecoveryDriver,
)
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.queue_consumer import ConsumerBase


class LegalCorpusRecoveryConsumer(ConsumerBase):
    queue_name = LEGAL_CORPUS_RECOVERY_QUEUE
    routing_key = LEGAL_CORPUS_RECOVERY_COMMAND
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        driver: LegalCorpusRecoveryDriver | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._driver = driver or LegalCorpusRecoveryDriver(
            api_client=self._api_client
        )

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        self._driver.run(message, correlationId)
