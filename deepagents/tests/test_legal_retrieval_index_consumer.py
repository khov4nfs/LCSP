from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from tools.legal.retrieval.index.legal_retrieval_index_boundary import (
    LEGAL_RETRIEVAL_INDEX_COMMAND,
    LEGAL_RETRIEVAL_INDEX_BOUNDARY_SOURCE,
    LegalRetrievalIndexBoundary,
)
from tools.legal.retrieval.index.legal_retrieval_index_repository import (
    LegalRetrievalIndexRecord,
    LegalRetrievalIndexRepository,
)
from tools.common.capabilities.managed.boundary import NonRetryableAgentBoundaryError


def test_consumer_persists_legal_retrieval_index(tmp_path: Path):
    storage_root = tmp_path / "storage"
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
    boundary = LegalRetrievalIndexBoundary(config)
    chunk_set_ref = "chunk-set:test"
    integrity_ref = "integrity-manifest:test"
    persisted = LegalRetrievalIndexRecord(
        index_ref="legal-index:test",
        provenance_ref="prov:legal-index:test",
        chunk_set_ref=chunk_set_ref,
        integrity_manifest_ref=integrity_ref,
        index_profile="CHROMA_STRUCTURE_V1",
        status="READY",
        coverage_state="SUFFICIENT",
        collection_name="legal-index-test",
        index_checksum="sha256:test",
        indexed_chunk_count=2,
        evidence_refs=[chunk_set_ref, integrity_ref],
        limitations=[],
        manifest_path=str(storage_root / "legal-indexes" / "test" / "manifest.json"),
        records_path=str(storage_root / "legal-indexes" / "test" / "records.json"),
    )
    result = SimpleNamespace(
        index_ref=persisted.index_ref,
        to_record=lambda: persisted,
    )

    with patch(
        "tools.legal.retrieval.index.legal_retrieval_index_boundary.LegalToolDispatcher.dispatch",
        return_value=result,
    ) as dispatch:
        boundary.handle(
            {
                "chunkSetRef": chunk_set_ref,
                "integrityManifestRef": integrity_ref,
                "indexProfile": "CHROMA_STRUCTURE_V1",
            },
            correlationId="corr-index",
        )

    dispatch.assert_called_once_with(
        "build_legal_retrieval_index",
        chunk_set_ref=chunk_set_ref,
        integrity_manifest_ref=integrity_ref,
        index_profile="CHROMA_STRUCTURE_V1",
    )
    record = LegalRetrievalIndexRepository(storage_root=storage_root).get_by_provenance_ref(
        persisted.provenance_ref
    )
    assert record is not None
    assert record.status == "READY"
    assert record.indexed_chunk_count == 2


def test_consumer_declares_authoritative_queue_binding():
    assert LegalRetrievalIndexBoundary.boundary_source == LEGAL_RETRIEVAL_INDEX_BOUNDARY_SOURCE
    assert LegalRetrievalIndexBoundary.source_event == LEGAL_RETRIEVAL_INDEX_COMMAND


def test_consumer_rejects_missing_required_field(tmp_path: Path):
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(tmp_path / "storage"),
    )
    boundary = LegalRetrievalIndexBoundary(config)

    with pytest.raises(
        NonRetryableAgentBoundaryError, match="missing required field: integrityManifestRef"
    ):
        boundary.handle(
            {
                "chunkSetRef": "chunk-set:test",
                "indexProfile": "CHROMA_STRUCTURE_V1",
            },
            correlationId="corr-missing",
        )
