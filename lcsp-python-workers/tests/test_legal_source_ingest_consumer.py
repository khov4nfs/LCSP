from unittest.mock import MagicMock

import pytest

from lcsp_workers.legal.legal_source_ingest_consumer import (
    LEGAL_SOURCE_INGEST_COMMAND,
    LEGAL_SOURCE_INGEST_QUEUE,
    LegalSourceIngestConsumer,
)
from lcsp_workers.platform.queue_consumer import NonRetryableWorkerError


@pytest.fixture
def config():
    return MagicMock(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
    )


def test_consumer_fetches_and_registers_official_snapshot(config):
    api_client = MagicMock()
    result = MagicMock()
    result.register_with_api.return_value = {
        "snapshotRef": "snapshot:LAW-71-2025-QH15:abcd1234ef56"
    }
    snapshot_fetcher = MagicMock()
    snapshot_fetcher.fetch.return_value = result
    consumer = LegalSourceIngestConsumer(
        config,
        api_client=api_client,
        snapshot_fetcher=snapshot_fetcher,
    )

    consumer.handle(
        {
            "documentId": "LAW-71-2025-QH15",
            "catalogSourceRef": "catalog-source:vbpl.vn:law:71-2025-qh15",
            "adminCatalogVersion": "catalog_v2026_08",
            "corpusVersionId": "corpus_draft_01",
            "idempotencyKey": "legal-source-ingest:LAW-71-2025-QH15:01",
            "actorRef": "actor:internal-legal-operator:demo",
            "sourceUrl": "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
            "maxBytes": 1024 * 1024,
            "expectedIdentity": {
                "documentNumber": "71/2025/QH15",
                "issueDate": "2025-06-27",
            },
            "gatewayDocumentId": "123",
        },
        correlationId="corr-1",
    )

    fetch_request = snapshot_fetcher.fetch.call_args.args[0]
    assert fetch_request.document_id == "LAW-71-2025-QH15"
    assert fetch_request.catalog_source_ref == "catalog-source:vbpl.vn:law:71-2025-qh15"
    assert fetch_request.expected_document_number == "71/2025/QH15"
    result.register_with_api.assert_called_once_with(
        api_client=api_client,
        admin_catalog_version="catalog_v2026_08",
        catalog_source_ref="catalog-source:vbpl.vn:law:71-2025-qh15",
        expected_document_number="71/2025/QH15",
    )


def test_consumer_rejects_invalid_expected_identity(config):
    consumer = LegalSourceIngestConsumer(
        config,
        api_client=MagicMock(),
        snapshot_fetcher=MagicMock(),
    )

    with pytest.raises(
        NonRetryableWorkerError, match="expectedIdentity is invalid"
    ):
        consumer.handle(
            {
                "documentId": "LAW-71-2025-QH15",
                "catalogSourceRef": "catalog-source:vbpl.vn:law:71-2025-qh15",
                "adminCatalogVersion": "catalog_v2026_08",
                "corpusVersionId": "corpus_draft_01",
                "idempotencyKey": "legal-source-ingest:LAW-71-2025-QH15:01",
                "actorRef": "actor:internal-legal-operator:demo",
                "sourceUrl": "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
                "maxBytes": 1024 * 1024,
            },
            correlationId="corr-1",
        )


def test_consumer_declares_authoritative_queue_binding():
    assert LegalSourceIngestConsumer.queue_name == LEGAL_SOURCE_INGEST_QUEUE
    assert LegalSourceIngestConsumer.routing_key == LEGAL_SOURCE_INGEST_COMMAND
