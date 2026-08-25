"""Architecture regression tests for AO-6 canonical runtime execution."""

from __future__ import annotations

import inspect
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from tools.legal.corpus.chunk_integrity.chunk_integrity_boundary import ChunkIntegrityBoundary
from tools.legal.corpus.legal_chunks.legal_chunk_boundary import LegalChunkBoundary
from tools.legal.sources.recovery.legal_corpus_recovery_driver import LegalCorpusRecoveryDriver
from tools.legal.retrieval.index.legal_retrieval_index_boundary import LegalRetrievalIndexBoundary
from tools.legal.sources.ingest.legal_source_ingest_boundary import LegalSourceIngestBoundary
from tools.legal.sources.ocr_fallback.ocr_fallback_boundary import OcrFallbackBoundary
from tools.legal.sources.ocr_quality.ocr_quality_boundary import OcrQualityBoundary
from tools.legal.sources.extraction.official_text_extraction_boundary import (
    OfficialTextExtractionBoundary,
)
from tools.legal.corpus.reviewed_input.reviewed_corpus_input_boundary import (
    ReviewedCorpusInputBoundary,
)
from tools.legal.sources.vbpl_effects.vbpl_effected_chunk_set_boundary import (
    VbplEffectedChunkSetBoundary,
)


@pytest.mark.parametrize(
    ("boundary", "tool_name", "forbidden_direct_call"),
    [
        (
            LegalSourceIngestBoundary,
            "fetch_official_source_snapshot",
            "_snapshot_fetcher.fetch(",
        ),
        (
            OfficialTextExtractionBoundary,
            "extract_official_text",
            "extract_from_resolved_snapshot(",
        ),
        (OcrFallbackBoundary, "run_ocr_fallback", ".run("),
        (OcrQualityBoundary, "evaluate_ocr_quality", "validator.evaluate("),
        (
            ReviewedCorpusInputBoundary,
            "build_reviewed_corpus_input",
            "builder.build(",
        ),
        (LegalChunkBoundary, "build_legal_chunks", "builder.build("),
        (
            VbplEffectedChunkSetBoundary,
            "build_vbpl_effected_chunk_set",
            "export_chunk_set(",
        ),
        (
            ChunkIntegrityBoundary,
            "validate_chunk_integrity",
            "validator.validate(",
        ),
        (
            LegalRetrievalIndexBoundary,
            "build_legal_retrieval_index",
            "builder.build(",
        ),
    ],
)
def test_legal_corpus_consumer_executes_through_canonical_dispatcher(
    boundary,
    tool_name: str,
    forbidden_direct_call: str,
) -> None:
    """Every authoritative AO-6 queue boundary must cross LegalToolDispatcher."""
    source = inspect.getsource(boundary.handle)

    assert "LegalToolDispatcher(" in source
    assert "dispatcher.dispatch(" in source
    assert f'"{tool_name}"' in source
    assert forbidden_direct_call not in source


def test_source_fetch_runtime_failure_stays_retryable(tmp_path: Path) -> None:
    """Dispatcher migration must not turn transient fetch failures into terminal DLQ errors."""
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(tmp_path),
    )
    fetcher = MagicMock()
    fetcher.fetch.side_effect = RuntimeError("temporary source outage")
    boundary = LegalSourceIngestBoundary(
        config,
        api_client=MagicMock(),
        snapshot_fetcher=fetcher,
    )

    with pytest.raises(RuntimeError, match="temporary source outage"):
        boundary.handle(
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
    source = inspect.getsource(LegalCorpusRecoveryDriver._run_locked)

    assert "_legal_dispatcher.dispatch(" in source
    assert '"activate_validated_corpus_version"' in source
    assert "_api_client.activate_validated_corpus_version(" not in source
