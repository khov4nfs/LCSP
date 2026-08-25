from pathlib import Path
from unittest.mock import MagicMock

import pytest

from tools.legal.sources.change_detection.legal_change_detector_boundary import (
    CheckUpdatesEnvelope,
    LegalChangeDetectorBoundary,
)
from tools.common.capabilities.managed.boundary import NonRetryableAgentBoundaryError


def test_change_detector_uses_corpus_store_for_cron_crawl_artifacts(
    tmp_path: Path,
) -> None:
    storage_root = tmp_path / ".corpus"
    boundary = LegalChangeDetectorBoundary(
        _config(storage_root),
        api_client=MagicMock(),
    )

    output_dir = boundary._source_output_dir(
        storage_root=storage_root,
        envelope=_envelope(document_id="LAW 71/2025/QH15"),
    )

    assert output_dir == storage_root / "source-crawl" / "cron" / "LAW-71-2025-QH15"


def test_change_detector_reads_base_snapshot_from_corpus_store(tmp_path: Path) -> None:
    storage_root = tmp_path / ".corpus"
    object_key = (
        "legal-source-snapshots/catalog_vbpl_vn/LAW-71-2025-QH15/"
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
        "LAW-71-2025-QH15.source.html"
    )
    object_path = storage_root / object_key
    object_path.parent.mkdir(parents=True)
    object_path.write_text("<html>old source</html>", encoding="utf-8")
    api_client = MagicMock()
    api_client.get_official_source_snapshot.return_value = {
        "snapshotObjectKey": object_key,
    }
    boundary = LegalChangeDetectorBoundary(
        _config(storage_root),
        api_client=api_client,
    )

    html = boundary._read_base_snapshot_html(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-71-2025-QH15:aaaaaaaa",
    )

    assert html == "<html>old source</html>"
    api_client.get_official_source_snapshot.assert_called_once_with(
        snapshot_ref="snapshot:LAW-71-2025-QH15:aaaaaaaa"
    )


def test_change_detector_rejects_base_snapshot_outside_corpus_store(
    tmp_path: Path,
) -> None:
    storage_root = tmp_path / ".corpus"
    api_client = MagicMock()
    api_client.get_official_source_snapshot.return_value = {
        "snapshotObjectKey": "../outside.html",
    }
    boundary = LegalChangeDetectorBoundary(
        _config(storage_root),
        api_client=api_client,
    )

    with pytest.raises(NonRetryableAgentBoundaryError, match="escapes storage root"):
        boundary._read_base_snapshot_html(
            storage_root=storage_root,
            snapshot_ref="snapshot:LAW-71-2025-QH15:aaaaaaaa",
        )


def _config(storage_root: Path) -> MagicMock:
    return MagicMock(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )


def _envelope(*, document_id: str) -> CheckUpdatesEnvelope:
    return CheckUpdatesEnvelope(
        document_id=document_id,
        catalog_source_ref="catalog-source:vbpl.vn:law:71-2025-qh15",
        source_url="https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
        base_snapshot_ref="snapshot:LAW-71-2025-QH15:aaaaaaaa",
        admin_catalog_version="catalog_v2026_08",
        idempotency_key="cron:law-71",
        actor_ref="actor:cron",
        expected_document_number="71/2025/QH15",
        gateway_document_id="123",
        max_bytes=1024,
    )
