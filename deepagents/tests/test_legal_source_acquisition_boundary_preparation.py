from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.legal.sources.ingest.legal_source_ingest_boundary import (
    LegalSourceIngestBoundary,
)
from tools.legal.sources.ingest.official_source_payload import (
    build_official_source_payload,
)
from tools.legal.sources.ingest.official_source_snapshot import (
    OfficialSourceSnapshotFetcher,
    OfficialSourceSnapshotRequest,
)


DOCUMENT_ID = "LAW-71-2025-QH15"
CATALOG_SOURCE_REF = "catalog-source:vbpl.vn:law:71-2025-qh15"
SOURCE_URL = "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989"
DOCUMENT_NUMBER = "71/2025/QH15"
HTML = (
    "<h2>Chương I</h2><h3>QUY ĐỊNH CHUNG</h3>"
    "<h1>Điều 1. Phạm vi</h1><p>1. Áp dụng luật.</p>"
    "<p>a) Trong nước.</p><h1>Điều 2. Ngoại lệ</h1>"
    "<p>Điều kiện riêng.</p>"
)
GATEWAY_DATA = {
    "docNum": DOCUMENT_NUMBER,
    "title": "Luật mẫu",
    "effFrom": "2026-01-01",
    "effStatus": {"name": "Còn hiệu lực"},
    "documentContent": {"content": HTML},
}


def _sha256(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


class _Response:
    headers = {"Content-Type": "application/json; charset=utf-8"}

    def __init__(self, payload: dict[str, object]):
        self._content = json.dumps(payload, ensure_ascii=False).encode()

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int):
        yield self._content


class _VbplSession:
    def __init__(self, data: dict[str, object] | None = None):
        self.data = data or GATEWAY_DATA

    def get(self, url: str, **kwargs):
        assert url.endswith("/123")
        assert kwargs["allow_redirects"] is False
        return _Response({"data": self.data})


class _RecordingApiClient:
    def __init__(self):
        self.payloads: list[dict[str, object]] = []

    def register_official_source_snapshot(self, payload: dict[str, object]):
        self.payloads.append(payload)
        return {"snapshotRef": payload["snapshotRef"]}


def _fetch_request(output_dir: Path, storage_root: Path | None = None):
    return OfficialSourceSnapshotRequest(
        document_id=DOCUMENT_ID,
        catalog_source_ref=CATALOG_SOURCE_REF,
        source_url=SOURCE_URL,
        output_dir=output_dir,
        storage_root=storage_root,
        gateway_document_id="123",
        max_bytes=1024 * 1024,
        expected_document_number=DOCUMENT_NUMBER,
    )


def test_ingest_adapter_preserves_source_identity_hash_and_provenance(tmp_path: Path):
    storage_root = tmp_path / ".corpus"
    api_client = _RecordingApiClient()
    boundary = LegalSourceIngestBoundary(
        SimpleNamespace(legal_source_storage_root=str(storage_root)),
        api_client=api_client,
        snapshot_fetcher=OfficialSourceSnapshotFetcher(vbpl_session=_VbplSession()),
    )

    boundary.handle(
        {
            "documentId": DOCUMENT_ID,
            "catalogSourceRef": CATALOG_SOURCE_REF,
            "adminCatalogVersion": "catalog_v2026_08",
            "corpusVersionId": "corpus_draft_01",
            "idempotencyKey": "legal-source-ingest:LAW-71-2025-QH15:01",
            "actorRef": "actor:internal-legal-operator:demo",
            "sourceUrl": SOURCE_URL,
            "maxBytes": 1024 * 1024,
            "expectedIdentity": {"documentNumber": DOCUMENT_NUMBER},
            "gatewayDocumentId": "123",
        },
        correlationId="corr-source-boundary",
    )

    assert len(api_client.payloads) == 1
    registered = api_client.payloads[0]
    html_sha = _sha256(HTML.encode())
    source_sha = _sha256(
        json.dumps(GATEWAY_DATA, ensure_ascii=False, sort_keys=True).encode()
    )
    snapshot_suffix = html_sha.removeprefix("sha256:")[:12]
    assert registered["snapshotRef"] == f"snapshot:{DOCUMENT_ID}:{snapshot_suffix}"
    assert registered["provenanceRef"] == f"prov:fetch:{DOCUMENT_ID}:{snapshot_suffix}"
    assert registered["documentId"] == DOCUMENT_ID
    assert registered["documentNumber"] == DOCUMENT_NUMBER
    assert registered["sourceUrl"] == SOURCE_URL
    assert registered["finalUrl"] == SOURCE_URL
    assert registered["contentSha256"] == html_sha
    assert registered["byteLength"] == len(HTML.encode())
    assert registered["documentIdentityVerified"] is True

    manifest_dir = storage_root / "source-crawl" / "corpus_draft_01" / DOCUMENT_ID
    manifest_path = manifest_dir / f"{DOCUMENT_ID}.source.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["documentNumber"] == DOCUMENT_NUMBER
    assert manifest["sourceSha256"] == source_sha
    assert manifest["htmlSha256"] == html_sha
    assert manifest["sourceEffectStatus"] == "Còn hiệu lực"
    assert (
        storage_root / str(registered["snapshotObjectKey"])
    ).read_bytes() == HTML.encode()


def test_recovery_payload_keeps_exact_hierarchy_locators_and_artifact_lineage(
    tmp_path: Path,
):
    source_dir = tmp_path / "source-crawl" / "corpus_draft_01" / DOCUMENT_ID
    storage_root = tmp_path / ".corpus"
    result = OfficialSourceSnapshotFetcher(vbpl_session=_VbplSession()).fetch(
        _fetch_request(source_dir, storage_root)
    )

    payload = build_official_source_payload(
        [result.manifest_path],
        "VN-LEGAL-CORPUS-W2",
    )

    document = payload["documents"][0]
    chunks = document["chunks"]
    namespaced = "VN-LEGAL-CORPUS-W2::"
    assert document["documentId"] == DOCUMENT_ID
    assert document["sourceSha256"] == _sha256(HTML.encode())
    assert document["snapshotPath"] == f"{DOCUMENT_ID}.source.html"
    assert [chunk["locator"] for chunk in chunks] == [
        "art-1",
        "art-1::cl-1",
        "art-1::cl-1::pt-a",
        "art-2",
    ]
    assert [chunk["id"] for chunk in chunks] == [
        f"{namespaced}{DOCUMENT_ID}::{locator}"
        for locator in ("art-1", "art-1::cl-1", "art-1::cl-1::pt-a", "art-2")
    ]
    assert chunks[0]["hierarchy"] == {
        "articleNumber": "1",
        "articleTitle": "Phạm vi",
        "chapterNumber": "I",
        "chapterTitle": "QUY ĐỊNH CHUNG",
    }
    assert chunks[1]["hierarchy"] == {
        "articleNumber": "1",
        "articleTitle": "Phạm vi",
        "clauseNumber": "1",
        "parentChunkId": f"{namespaced}{DOCUMENT_ID}::art-1",
        "chapterNumber": "I",
        "chapterTitle": "QUY ĐỊNH CHUNG",
    }
    assert chunks[2]["hierarchy"]["parentChunkId"] == (
        f"{namespaced}{DOCUMENT_ID}::art-1::cl-1"
    )
    assert chunks[2]["hierarchy"]["pointCode"] == "a"

    source_artifact = payload["sourceManifest"]["sourceArtifacts"][0]
    manifest_bytes = result.manifest_path.read_bytes()
    text_path = result.manifest_path.parent / f"{DOCUMENT_ID}.source.txt"
    assert source_artifact == {
        "documentId": DOCUMENT_ID,
        "sourceManifest": str(result.manifest_path),
        "sourceManifestSha256": _sha256(manifest_bytes),
        "sourceArtifact": f"{DOCUMENT_ID}.source.html",
        "sourceArtifactSha256": _sha256(HTML.encode()),
        "textArtifact": str(text_path),
        "textArtifactSha256": _sha256(text_path.read_bytes()),
    }
    assert payload["sourceManifest"]["reviewRequired"] is False
    assert payload["sourceManifest"]["trustPolicy"] == "OFFICIAL_SOURCE_AUTO_TRUSTED"
    assert payload["sourceManifest"]["partialUpdateContexts"] == []


def test_identity_mismatch_is_explicit_and_invalid_fetch_has_no_fallback(tmp_path: Path):
    wrong_data = {**GATEWAY_DATA, "docNum": "99/2026/QH15"}
    fetcher = OfficialSourceSnapshotFetcher(vbpl_session=_VbplSession(wrong_data))
    result = fetcher.fetch(_fetch_request(tmp_path / "mismatch"))

    registry_payload = result.to_registry_payload(
        admin_catalog_version="catalog_v2026_08",
        catalog_source_ref=CATALOG_SOURCE_REF,
        expected_document_number=DOCUMENT_NUMBER,
    )
    assert result.document_number == "99/2026/QH15"
    assert registry_payload["documentIdentityVerified"] is False
    assert registry_payload["documentNumber"] == "99/2026/QH15"

    broken = OfficialSourceSnapshotFetcher(
        vbpl_session=_VbplSession({"docNum": DOCUMENT_NUMBER})
    )
    with pytest.raises(RuntimeError, match="no documentContent"):
        broken.fetch(_fetch_request(tmp_path / "broken"))
    assert not (tmp_path / "broken").exists()
