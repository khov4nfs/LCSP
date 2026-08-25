from pathlib import Path
from types import SimpleNamespace

import json
import io
import pytest
import zipfile

from tools.legal.sources.extraction.official_text_extraction_boundary import (
    OFFICIAL_TEXT_EXTRACTION_COMMAND,
    OFFICIAL_TEXT_EXTRACTION_BOUNDARY_SOURCE,
    OfficialTextExtractionBoundary,
)
from tools.legal.sources.extraction.official_text_extraction_repository import (
    OfficialTextExtractionRepository,
)
from tools.common.capabilities.managed.boundary import NonRetryableAgentBoundaryError


def _docx_fixture() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "word/document.xml",
            """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
            <w:p><w:r><w:t>Điều 1. Phạm vi</w:t></w:r></w:p>
            </w:body></w:document>""",
        )
    return output.getvalue()


class RecordingApiClient:
    def __init__(self, *, storage_root: Path, artifact_sha: str):
        self.storage_root = storage_root
        self.artifact_sha = artifact_sha

    def get_official_source_snapshot(
        self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
    ) -> dict:
        return {
            "snapshotRef": snapshot_ref,
            "documentId": "LAW-TEST",
            "contentSha256": self.artifact_sha,
            "contentType": "text/html",
            "snapshotObjectKey": "legal-source-snapshots/catalog_vbpl_vn/LAW-TEST/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/LAW-TEST.source.html",
        }


def test_consumer_extracts_from_snapshot_ref(tmp_path: Path):
    storage_root = tmp_path / "storage"
    artifact_dir = (
        storage_root
        / "legal-source-snapshots"
        / "catalog_vbpl_vn"
        / "LAW-TEST"
        / "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )
    artifact_dir.mkdir(parents=True, exist_ok=True)
    html_path = artifact_dir / "LAW-TEST.source.html"
    html_path.write_text(
        "<html><body><h1>Điều 1. Phạm vi điều chỉnh</h1><p>1. Nội dung.</p></body></html>",
        encoding="utf-8",
    )
    manifest_path = artifact_dir / "LAW-TEST.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-TEST",
                "documentNumber": "13/2023/NĐ-CP",
                "sourceEffectStatus": "Còn hiệu lực",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )

    from tools.legal.sources.extraction.official_text_extraction import _sha256_bytes

    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
    boundary = OfficialTextExtractionBoundary(
        config,
        api_client=RecordingApiClient(
            storage_root=storage_root,
            artifact_sha=_sha256_bytes(html_path.read_bytes()),
        ),
    )

    boundary.handle(
        {
            "snapshotRef": "snapshot:LAW-TEST:abcd1234ef56",
            "extractorProfile": "HTML_OFFICIAL_V1",
            "maxPages": 10,
        },
        correlationId="corr-1",
    )

    output_dir = storage_root / "official-text-extractions" / "LAW-TEST_abcd1234ef56"
    assert (output_dir / "LAW-TEST.extraction.manifest.json").is_file()
    assert (output_dir / "LAW-TEST.extraction.spans.json").is_file()
    repository = OfficialTextExtractionRepository(storage_root=storage_root)
    provenance_records = list(
        (
            storage_root / "official-text-extractions" / "registry" / "provenance"
        ).glob("*.json")
    )
    assert len(provenance_records) == 1
    record = repository.get_by_provenance_ref(
        provenance_records[0].stem.replace("__", ":")
    )
    assert record is not None
    assert record.snapshot_ref == "snapshot:LAW-TEST:abcd1234ef56"


def test_consumer_declares_authoritative_queue_binding():
    assert OfficialTextExtractionBoundary.boundary_source == OFFICIAL_TEXT_EXTRACTION_BOUNDARY_SOURCE
    assert OfficialTextExtractionBoundary.source_event == OFFICIAL_TEXT_EXTRACTION_COMMAND


def test_consumer_treats_profile_content_mismatch_as_terminal(tmp_path: Path):
    storage_root = tmp_path / "storage"
    artifact_dir = (
        storage_root
        / "legal-source-snapshots"
        / "catalog_cong_bao"
        / "LAW-MISMATCH"
        / "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    )
    artifact_dir.mkdir(parents=True, exist_ok=True)
    docx_path = artifact_dir / "LAW-MISMATCH.source.docx"
    docx_path.write_bytes(_docx_fixture())
    manifest_path = artifact_dir / "LAW-MISMATCH.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-MISMATCH",
                "documentNumber": "77/2026/NĐ-CP",
                "sourceEffectStatus": "Còn hiệu lực",
                "sourceFile": docx_path.name,
            }
        ),
        encoding="utf-8",
    )

    from tools.legal.sources.extraction.official_text_extraction import _sha256_bytes

    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )

    class MismatchClient:
        def get_official_source_snapshot(
            self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
        ) -> dict:
            return {
                "snapshotRef": snapshot_ref,
                "documentId": "LAW-MISMATCH",
                "contentSha256": _sha256_bytes(docx_path.read_bytes()),
                "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "snapshotObjectKey": "legal-source-snapshots/catalog_cong_bao/LAW-MISMATCH/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/LAW-MISMATCH.source.docx",
            }

    boundary = OfficialTextExtractionBoundary(
        config,
        api_client=MismatchClient(),
    )

    with pytest.raises(
        NonRetryableAgentBoundaryError,
        match="resolved snapshot content type does not match extractor profile",
    ):
        boundary.handle(
            {
                "snapshotRef": "snapshot:LAW-MISMATCH:abcd1234ef56",
                "extractorProfile": "HTML_OFFICIAL_V1",
                "maxPages": 10,
            },
            correlationId="corr-mismatch",
        )
