"""Architecture regression tests for AO-6 canonical runtime execution."""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from lcsp_workers.legal.chunk_integrity_consumer import ChunkIntegrityConsumer
from lcsp_workers.legal.legal_chunk_consumer import LegalChunkConsumer
from lcsp_workers.legal.legal_corpus_recovery_driver import LegalCorpusRecoveryDriver
from lcsp_workers.legal.legal_retrieval_index_consumer import LegalRetrievalIndexConsumer
from lcsp_workers.legal.legal_source_ingest_consumer import LegalSourceIngestConsumer
from lcsp_workers.legal.ocr_fallback_consumer import OcrFallbackConsumer
from lcsp_workers.legal.ocr_quality_consumer import OcrQualityConsumer
from lcsp_workers.legal.official_text_extraction_consumer import (
    OfficialTextExtractionConsumer,
)
from lcsp_workers.legal.reviewed_corpus_input_consumer import (
    ReviewedCorpusInputConsumer,
)


@pytest.mark.parametrize(
    ("consumer", "tool_name", "forbidden_direct_call"),
    [
        (
            LegalSourceIngestConsumer,
            "fetch_official_source_snapshot",
            "_snapshot_fetcher.fetch(",
        ),
        (
            OfficialTextExtractionConsumer,
            "extract_official_text",
            "extract_from_resolved_snapshot(",
        ),
        (OcrFallbackConsumer, "run_ocr_fallback", ".run("),
        (OcrQualityConsumer, "evaluate_ocr_quality", "validator.evaluate("),
        (
            ReviewedCorpusInputConsumer,
            "build_reviewed_corpus_input",
            "builder.build(",
        ),
        (LegalChunkConsumer, "build_legal_chunks", "builder.build("),
        (
            ChunkIntegrityConsumer,
            "validate_chunk_integrity",
            "validator.validate(",
        ),
        (
            LegalRetrievalIndexConsumer,
            "build_legal_retrieval_index",
            "builder.build(",
        ),
    ],
)
def test_ao6_consumer_executes_through_canonical_dispatcher(
    consumer,
    tool_name: str,
    forbidden_direct_call: str,
) -> None:
    """Every authoritative AO-6 queue consumer must cross LegalToolDispatcher."""
    source = inspect.getsource(consumer.handle)

    assert "LegalToolDispatcher(" in source
    assert "dispatcher.dispatch(" in source
    assert f'"{tool_name}"' in source
    assert forbidden_direct_call not in source


def test_source_fetch_runtime_failure_stays_retryable() -> None:
    """Dispatcher migration must not turn transient fetch failures into terminal DLQ errors."""
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
    )
    fetcher = MagicMock()
    fetcher.fetch.side_effect = RuntimeError("temporary source outage")
    consumer = LegalSourceIngestConsumer(
        config,
        api_client=MagicMock(),
        snapshot_fetcher=fetcher,
    )

    with pytest.raises(RuntimeError, match="temporary source outage"):
        consumer.handle(
            {
                "documentId": "LAW-TEST",
                "catalogSourceRef": "catalog-source:test",
                "adminCatalogVersion": "catalog-v1",
                "corpusVersionId": "corpus-v1",
                "idempotencyKey": "legal-source-ingest:test:01",
                "actorRef": "actor:test",
                "sourceUrl": "https://example.test/legal",
                "maxBytes": 1024,
                "expectedIdentity": {"documentNumber": "01/2026/TEST"},
            },
            correlationId="corr-retry",
        )


def test_recovery_validation_crosses_canonical_dispatcher() -> None:
    """Recovery index validation may not own a private Chroma implementation."""
    source = inspect.getsource(LegalCorpusRecoveryDriver._validate_retrieval_index)

    assert "dispatcher.dispatch(" in source or "_legal_dispatcher.dispatch(" in source
    assert '"validate_retrieval_index"' in source
    assert "ChromaDbCitationRetriever(" not in source
    assert ".index_corpus(" not in source


def test_recovery_activation_crosses_canonical_dispatcher() -> None:
    """Corpus activation must remain behind the canonical protected API entrypoint."""
    source = inspect.getsource(LegalCorpusRecoveryDriver.run)

    assert "_legal_dispatcher.dispatch(" in source
    assert '"activate_validated_corpus_version"' in source
    assert "_api_client.activate_validated_corpus_version(" not in source
