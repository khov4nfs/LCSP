import json
from pathlib import Path

from tools.legal.sources.extraction.official_text_extraction import (
    OfficialTextExtractionRequest,
    OfficialTextExtractor,
)
from tools.legal.sources.extraction.official_text_extraction_repository import (
    OfficialTextExtractionRepository,
)


def test_repository_saves_and_loads_by_extraction_and_provenance_ref(tmp_path: Path):
    html_path = tmp_path / "LAW-REPO.source.html"
    html_path.write_text(
        "<html><body><h1>Điều 1. Phạm vi điều chỉnh</h1></body></html>",
        encoding="utf-8",
    )
    manifest_path = tmp_path / "LAW-REPO.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-REPO",
                "documentNumber": "10/2026/NĐ-CP",
                "sourceEffectStatus": "Còn hiệu lực",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )

    result = OfficialTextExtractor().extract(
        OfficialTextExtractionRequest(
            snapshot_ref="snapshot:LAW-REPO:abcd1234ef56",
            extractor_profile="HTML_OFFICIAL_V1",
            max_pages=10,
            source_manifest_path=manifest_path,
            output_dir=tmp_path / "out",
        )
    )
    repository = OfficialTextExtractionRepository(storage_root=tmp_path / "storage")

    saved = repository.save(result)
    by_extraction = repository.get_by_extraction_ref(result.extraction_ref)
    by_provenance = repository.get_by_provenance_ref(result.provenance_ref)

    assert saved.extraction_ref == result.extraction_ref
    assert by_extraction is not None
    assert by_extraction.snapshot_ref == result.snapshot_ref
    assert by_provenance is not None
    assert by_provenance.provenance_ref == result.provenance_ref
    assert by_provenance.canonical_extraction_available is True


def test_repository_persists_blocked_unavailable_result(tmp_path: Path):
    html_path = tmp_path / "LAW-EMPTY-REPO.source.html"
    html_path.write_text("<html><body></body></html>", encoding="utf-8")
    manifest_path = tmp_path / "LAW-EMPTY-REPO.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-EMPTY-REPO",
                "documentNumber": "11/2026/NĐ-CP",
                "sourceEffectStatus": "Còn hiệu lực",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )

    result = OfficialTextExtractor().extract(
        OfficialTextExtractionRequest(
            snapshot_ref="snapshot:LAW-EMPTY-REPO:abcd1234ef56",
            extractor_profile="HTML_OFFICIAL_V1",
            max_pages=10,
            source_manifest_path=manifest_path,
            output_dir=tmp_path / "out",
        )
    )
    repository = OfficialTextExtractionRepository(storage_root=tmp_path / "storage")

    repository.save(result)
    loaded = repository.get_by_provenance_ref(result.provenance_ref)

    assert loaded is not None
    assert loaded.status == "BLOCKED"
    assert loaded.canonical_extraction_available is False
    assert loaded.limitations[0]["code"] == "EXTRACTION_UNAVAILABLE"


def test_repository_lists_records_by_snapshot_ref(tmp_path: Path):
    repository = OfficialTextExtractionRepository(storage_root=tmp_path / "storage")

    def _write_result(document_id: str, snapshot_ref: str) -> None:
        html_path = tmp_path / f"{document_id}.source.html"
        html_path.write_text(
            "<html><body><h1>Điều 1. Phạm vi điều chỉnh</h1></body></html>",
            encoding="utf-8",
        )
        manifest_path = tmp_path / f"{document_id}.source.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "documentId": document_id,
                    "documentNumber": "10/2026/NĐ-CP",
                    "sourceEffectStatus": "Còn hiệu lực",
                    "htmlFile": html_path.name,
                }
            ),
            encoding="utf-8",
        )
        result = OfficialTextExtractor().extract(
            OfficialTextExtractionRequest(
                snapshot_ref=snapshot_ref,
                extractor_profile="HTML_OFFICIAL_V1",
                max_pages=10,
                source_manifest_path=manifest_path,
                output_dir=tmp_path / f"out-{document_id}",
            )
        )
        repository.save(result)

    _write_result("LAW-S1", "snapshot:LAW-SHARED:abcd1234ef56")
    _write_result("LAW-S2", "snapshot:LAW-SHARED:abcd1234ef56")
    _write_result("LAW-S3", "snapshot:LAW-OTHER:abcd1234ef56")

    records = repository.list_by_snapshot_ref("snapshot:LAW-SHARED:abcd1234ef56")

    assert len(records) == 2
    assert {record.document_id for record in records} == {"LAW-S1", "LAW-S2"}
