from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from lcsp_workers.agentic_evidence.dispatcher import LegalToolDispatcher
from lcsp_workers.agentic_evidence.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from lcsp_workers.legal.vbpl_effected_chunk_set_consumer import (
    VBPL_EFFECTED_CHUNK_SET_COMMAND,
    VBPL_EFFECTED_CHUNK_SET_QUEUE,
    VbplEffectedChunkSetConsumer,
)
from lcsp_workers.platform.queue_consumer import NonRetryableWorkerError


def test_dispatcher_exposes_vbpl_effected_chunk_set_tool() -> None:
    dispatcher = LegalToolDispatcher(
        LegalToolExecutionContext(api_client=None, storage_root=Path("storage"))
    )

    assert "build_vbpl_effected_chunk_set" in dispatcher.names()


def test_consumer_exports_effected_chunk_set(tmp_path: Path) -> None:
    storage_root = tmp_path / "storage"
    source_manifest_path, normalized_payload_path = _write_vbpl_inputs(tmp_path)
    consumer = VbplEffectedChunkSetConsumer(_config(storage_root))

    consumer.handle(
        {
            "sourceManifestPath": str(source_manifest_path),
            "normalizedPayloadPath": str(normalized_payload_path),
            "documentIdentityRef": "catalog-source:vbpl.vn:law:law-test",
            "reviewedInputRef": "reviewed-input:vbpl-effect-test",
            "chunkSetRef": "chunk-set:vbpl-effect-test",
            "relationshipManifestRef": "relationship-manifest:vbpl-effect-test",
            "runId": "law-test",
        },
        correlationId="corr-vbpl-effect",
    )

    chunk_registry = (
        storage_root
        / "legal-chunk-sets"
        / "registry"
        / "chunk-sets"
        / "chunk-set__vbpl-effect-test.json"
    )
    relationship_registry = (
        storage_root
        / "relationship-manifests"
        / "registry"
        / "relationship-manifests"
        / "relationship-manifest__vbpl-effect-test.json"
    )
    assert chunk_registry.is_file()
    assert relationship_registry.is_file()

    chunk_record = json.loads(chunk_registry.read_text(encoding="utf-8"))
    chunks = json.loads(Path(chunk_record["chunksPath"]).read_text(encoding="utf-8"))
    chunks_by_locator = {chunk["locator"]: chunk for chunk in chunks}
    assert chunks_by_locator["art-1::cl-1"]["legalStatus"] == "AMENDED"
    assert chunks_by_locator["art-1::cl-2"]["legalStatus"] == "REPEALED"
    assert chunks_by_locator["art-1::cl-3"]["legalStatus"] == "ACTIVE"

    relationship_record = json.loads(relationship_registry.read_text(encoding="utf-8"))
    assert relationship_record["chunkSetRef"] == "chunk-set:vbpl-effect-test"
    assert len(relationship_record["materializedRelationships"]) == 3


def test_consumer_declares_authoritative_queue_binding() -> None:
    assert VbplEffectedChunkSetConsumer.queue_name == VBPL_EFFECTED_CHUNK_SET_QUEUE
    assert VbplEffectedChunkSetConsumer.routing_key == VBPL_EFFECTED_CHUNK_SET_COMMAND


def test_consumer_rejects_missing_required_field(tmp_path: Path) -> None:
    consumer = VbplEffectedChunkSetConsumer(_config(tmp_path / "storage"))

    with pytest.raises(
        NonRetryableWorkerError, match="missing required field: normalizedPayloadPath"
    ):
        consumer.handle(
            {
                "sourceManifestPath": str(tmp_path / "source.json"),
                "documentIdentityRef": "catalog-source:vbpl.vn:law:law-test",
                "reviewedInputRef": "reviewed-input:vbpl-effect-test",
            },
            correlationId="corr-missing",
        )


def _write_vbpl_inputs(tmp_path: Path) -> tuple[Path, Path]:
    html_path = tmp_path / "LAW-TEST.source.html"
    html_path.write_text(
        """
        <p class="prov-article" id="art">Điều 1. Test</p>
        <p class="prov-clause" id="cl1" type="10:ref-amended">1. Amended.</p>
        <p class="prov-clause" id="cl2" type="1:ref-repealed">2. Repealed.</p>
        <p class="prov-clause" id="cl3" type="13:ref-added">3. Added.</p>
        """,
        encoding="utf-8",
    )
    source_manifest_path = tmp_path / "LAW-TEST.source.json"
    source_manifest_path.write_text(
        json.dumps({"documentId": "LAW-TEST", "htmlFile": html_path.name}),
        encoding="utf-8",
    )
    normalized_payload_path = tmp_path / "LAW-TEST.normalized-preview.json"
    normalized_payload_path.write_text(
        json.dumps(
            {
                "sourceManifest": {
                    "sourceArtifacts": [{"documentNumber": "LAW-TEST"}],
                    "normalizationWarnings": [],
                },
                "documents": [
                    {
                        "documentId": "LAW-TEST",
                        "title": "Test Law",
                        "sourceUrl": "https://vbpl.vn/test",
                        "sourceSha256": "sha256:" + "c" * 64,
                        "sourceEffectStatus": "HET_HIEU_LUC_MOT_PHAN",
                        "effectiveDate": "2024-01-01T00:00:00",
                        "chunks": [
                            _chunk("art-1"),
                            _chunk("art-1::cl-1"),
                            _chunk("art-1::cl-2"),
                            _chunk("art-1::cl-3"),
                        ],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return source_manifest_path, normalized_payload_path


def _chunk(locator: str) -> dict[str, object]:
    return {
        "id": f"LAW-TEST::{locator}",
        "locator": locator,
        "content": locator,
        "contentSha256": "sha256:" + "a" * 64,
        "hierarchy": {},
        "legalStatus": "ACTIVE",
    }


def _config(storage_root: Path) -> SimpleNamespace:
    return SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
