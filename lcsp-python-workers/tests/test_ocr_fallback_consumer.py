import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from lcsp_workers.legal.ocr_fallback_consumer import (
    OCR_FALLBACK_COMMAND,
    OCR_FALLBACK_QUEUE,
    OcrFallbackConsumer,
)
from lcsp_workers.legal.ocr_fallback_repository import OcrFallbackRepository
from lcsp_workers.platform.queue_consumer import NonRetryableWorkerError


def _write_extraction_record(
    *,
    storage_root: Path,
    provenance_ref: str,
    snapshot_ref: str,
    canonical_extraction_available: bool,
) -> None:
    provenance_dir = (
        storage_root / "official-text-extractions" / "registry" / "provenance"
    )
    provenance_dir.mkdir(parents=True, exist_ok=True)
    (provenance_dir / f"{provenance_ref.replace(':', '__')}.json").write_text(
        json.dumps(
            {
                "extractionRef": "extraction:test",
                "provenanceRef": provenance_ref,
                "snapshotRef": snapshot_ref,
                "documentId": "LAW-OCR",
                "status": "BLOCKED" if not canonical_extraction_available else "READY",
                "coverageState": "UNAVAILABLE"
                if not canonical_extraction_available
                else "SUFFICIENT",
                "canonicalExtractionAvailable": canonical_extraction_available,
                "limitations": [],
                "format": "PDF",
                "pageCount": 0,
                "spanCount": 0,
                "spanManifestPath": "none",
                "spansPath": "none",
                "spanManifestSha256": "sha256:" + "0" * 64,
                "identityCandidate": {
                    "documentNumber": "10/2026/NĐ-CP",
                    "sourceEffectStatus": "CON_HIEU_LUC",
                },
            }
        ),
        encoding="utf-8",
    )


class RecordingApiClient:
    def __init__(self, *, artifact_sha: str):
        self.artifact_sha = artifact_sha

    def get_official_source_snapshot(
        self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
    ) -> dict:
        return {
            "snapshotRef": snapshot_ref,
            "documentId": "LAW-OCR",
            "contentSha256": self.artifact_sha,
            "contentType": "image/png",
            "snapshotObjectKey": "legal-source-snapshots/LAW-OCR.source.png",
        }


def test_consumer_runs_ocr_fallback_and_persists_record(tmp_path: Path, monkeypatch):
    storage_root = tmp_path / "storage"
    artifact_dir = storage_root / "legal-source-snapshots"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    image_path = artifact_dir / "LAW-OCR.source.png"
    image_path.write_bytes(b"png-binary")
    (artifact_dir / "LAW-OCR.source.json").write_text(
        json.dumps({"documentId": "LAW-OCR"}),
        encoding="utf-8",
    )
    _write_extraction_record(
        storage_root=storage_root,
        provenance_ref="prov:extract:blocked",
        snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
        canonical_extraction_available=False,
    )

    from lcsp_workers.legal.official_text_extraction import _sha256_bytes

    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/tool")

    def run_command(command, **_kwargs):
        if command[:2] == ["tesseract", str(image_path)] and "vie+eng" in command:
            if command[-1] == "vie+eng":
                return subprocess.CompletedProcess(command, 0, "Điều 1. Nội dung luật", "")
            return subprocess.CompletedProcess(
                command,
                0,
                "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t97\tĐiều\n",
                "",
            )
        raise AssertionError(command)

    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
    from lcsp_workers.legal.ocr_fallback import OcrFallbackTool
    from lcsp_workers.legal.official_text_extraction import OfficialSourceSnapshotResolver
    from lcsp_workers.legal.official_text_extraction_repository import (
        OfficialTextExtractionRepository,
    )

    tool = OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=RecordingApiClient(artifact_sha=_sha256_bytes(image_path.read_bytes())),
            storage_root=storage_root,
        ),
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        run_command=run_command,
    )
    consumer = OcrFallbackConsumer(
        config,
        api_client=RecordingApiClient(artifact_sha=_sha256_bytes(image_path.read_bytes())),
        tool=tool,
    )

    consumer.handle(
        {
            "snapshotRef": "snapshot:LAW-OCR:abcd1234ef56",
            "fallbackProofRef": "prov:extract:blocked",
            "pageNumbers": [1],
            "ocrProfile": "VI_OFFICIAL_V1",
        },
        correlation_id="corr-ocr",
    )

    repository = OcrFallbackRepository(storage_root=storage_root)
    provenance_records = list(
        (
            storage_root / "official-ocr-fallbacks" / "registry" / "provenance"
        ).glob("*.json")
    )
    assert len(provenance_records) == 1
    record = repository.get_by_provenance_ref(
        provenance_records[0].stem.replace("__", ":")
    )
    assert record is not None
    assert record.snapshot_ref == "snapshot:LAW-OCR:abcd1234ef56"
    assert record.status == "READY"


def test_consumer_declares_authoritative_queue_binding():
    assert OcrFallbackConsumer.queue_name == OCR_FALLBACK_QUEUE
    assert OcrFallbackConsumer.routing_key == OCR_FALLBACK_COMMAND


def test_consumer_rejects_invalid_page_numbers(tmp_path: Path):
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(tmp_path / "storage"),
    )
    consumer = OcrFallbackConsumer(config, api_client=RecordingApiClient(artifact_sha="sha256:" + "0" * 64))

    with pytest.raises(
        NonRetryableWorkerError, match="OCR fallback pageNumbers must be unique"
    ):
        consumer.handle(
            {
                "snapshotRef": "snapshot:LAW-OCR:abcd1234ef56",
                "fallbackProofRef": "prov:extract:blocked",
                "pageNumbers": [1, 1],
                "ocrProfile": "VI_OFFICIAL_V1",
            },
            correlation_id="corr-invalid",
        )
