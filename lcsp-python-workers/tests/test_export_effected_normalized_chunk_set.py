from __future__ import annotations

import json
from pathlib import Path

from lcsp_workers.legal.vbpl_effected_chunk_set_exporter import export_chunk_set


def test_exports_chunk_set_and_relationship_manifest_registries(tmp_path: Path) -> None:
    payload_path = tmp_path / "normalized-with-effects.json"
    payload_path.write_text(
        json.dumps(
            {
                "sourceManifest": {
                    "sourceArtifacts": [
                        {
                            "documentNumber": "22/2023/QH15",
                        }
                    ],
                    "effectObservationFile": "effects.json",
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
                            chunk("art-1", "ACTIVE"),
                            chunk(
                                "art-1::cl-1",
                                "REPEALED",
                                observations=[
                                    {
                                        "locator": "art-1::cl-1",
                                        "effectKind": "REPEALED",
                                        "legalStatusCandidate": "REPEALED",
                                        "htmlId": "html-1",
                                        "htmlParagraphIndex": 2,
                                        "type": {
                                            "typeCode": "1",
                                            "typeRef": "ref",
                                            "effectKind": "REPEALED",
                                        },
                                        "newType": None,
                                        "textSha256": "sha256:" + "d" * 64,
                                        "reviewRequired": True,
                                    }
                                ],
                            ),
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = export_chunk_set(
        normalized_payload_path=payload_path,
        storage_root=tmp_path / "storage",
        document_identity_ref="catalog-source:vbpl.vn:law:22-2023-qh15",
        reviewed_input_ref="reviewed-input:vbpl-effect-preview-22-2023-qh15",
    )

    chunk_registry = (
        tmp_path
        / "storage"
        / "legal-chunk-sets"
        / "registry"
        / "chunk-sets"
        / f"{result['chunkSetRef'].replace(':', '__')}.json"
    )
    relationship_registry = (
        tmp_path
        / "storage"
        / "relationship-manifests"
        / "registry"
        / "relationship-manifests"
        / f"{result['relationshipManifestRef'].replace(':', '__')}.json"
    )
    assert chunk_registry.is_file()
    assert relationship_registry.is_file()

    chunk_record = json.loads(chunk_registry.read_text(encoding="utf-8"))
    relationship_record = json.loads(relationship_registry.read_text(encoding="utf-8"))
    chunks = json.loads(Path(chunk_record["chunksPath"]).read_text(encoding="utf-8"))
    assert chunks[0]["schemaVersion"] == "LEGAL_CHUNK_V1"
    assert chunks[0]["hierarchy"]["sourceEffectStatus"] == "HET_HIEU_LUC_MOT_PHAN"
    assert relationship_record["chunkSetRef"] == result["chunkSetRef"]
    assert relationship_record["materializedRelationships"][0]["effectKind"] == "REPEALED"


def chunk(
    locator: str,
    legal_status: str,
    *,
    observations: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    hierarchy: dict[str, object] = {}
    if observations is not None:
        hierarchy["legalEffectObservations"] = observations
    return {
        "id": f"LAW-TEST::{locator}",
        "locator": locator,
        "content": locator,
        "contentSha256": "sha256:" + "a" * 64,
        "hierarchy": hierarchy,
        "legalStatus": legal_status,
    }
