"""Fetch immutable legal-source snapshots only from catalog-authorized official hosts."""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Protocol
from urllib.parse import urlparse

VBPL_CATALOG_HOST = "vbpl.vn"
CONGBAO_CATALOG_HOST = "vanban.chinhphu.vn"
CONGBAO_SOURCE_HOST = "congbao.chinhphu.vn"
CATALOG_SOURCE_IDS = {
    VBPL_CATALOG_HOST: "catalog_vbpl_vn",
    CONGBAO_CATALOG_HOST: "catalog_vanban_chinhphu_vn",
}

OFFICIAL_SOURCE_SNAPSHOT_TOOL = {
    "name": "fetch_official_source_snapshot",
    "version": "1.0.0",
    "config_hash": "sha256:fetch-v1",
}

AGENTIC_TOOL_STATUSES = {
    "ready": "READY",
}

AGENTIC_TOOL_COVERAGE_STATES = {
    "sufficient": "SUFFICIENT",
}


class OfficialSourceSnapshotRegistry(Protocol):
    """Minimal API contract required to register a validated source snapshot."""

    def register_official_source_snapshot(self, payload: dict) -> dict:
        """Persist snapshot provenance and immutable object metadata."""
        ...


@dataclass(frozen=True)
class OfficialSourceSnapshotRequest:
    """Bounded request describing one catalog-authorized official legal source."""

    document_id: str
    catalog_source_ref: str
    source_url: str
    output_dir: Path
    max_bytes: int
    storage_root: Path | None = None
    gateway_document_id: str | None = None
    source_effect_status: str | None = None
    expected_document_number: str | None = None


@dataclass(frozen=True)
class OfficialSourceSnapshotResult:
    """Immutable snapshot artifact and provenance metadata returned by a crawler."""

    manifest_path: Path
    snapshot_path: Path
    snapshot_object_key: str
    snapshot_ref: str
    provenance_ref: str
    content_sha256: str
    content_type: str
    byte_length: int
    retrieved_at: str
    source_url: str
    final_url: str | None
    document_number: str | None
    effective_from: str | None
    source_effect_status: str | None
    normalization_source: str | None
    metadata: dict[str, object]

    def to_tool_response(
        self,
        *,
        correlationId: str,
        admin_catalog_version: str,
        catalog_source_ref: str,
        expected_document_number: str | None,
    ) -> dict[str, object]:
        """Project the snapshot into the bounded agentic-tool response contract."""
        return {
            "status": AGENTIC_TOOL_STATUSES["ready"],
            "toolName": OFFICIAL_SOURCE_SNAPSHOT_TOOL["name"],
            "toolVersion": OFFICIAL_SOURCE_SNAPSHOT_TOOL["version"],
            "configHash": OFFICIAL_SOURCE_SNAPSHOT_TOOL["config_hash"],
            "correlationId": correlationId,
            "artifactVersions": {
                "adminCatalogVersion": admin_catalog_version,
                "snapshotId": self.snapshot_ref.removeprefix("snapshot:"),
            },
            "provenanceRef": self.provenance_ref,
            "coverageState": AGENTIC_TOOL_COVERAGE_STATES["sufficient"],
            "evidenceRefs": [self.snapshot_ref, catalog_source_ref],
            "limitations": [],
            "result": {
                "snapshotRef": self.snapshot_ref,
                "snapshotObjectKey": self.snapshot_object_key,
                "contentSha256": self.content_sha256,
                "contentType": self.content_type,
                "byteLength": self.byte_length,
                "retrievedAt": self.retrieved_at,
                "documentIdentityVerified": document_number_matches(
                    expected_document_number,
                    self.document_number,
                ),
            },
        }

    def to_registry_payload(
        self,
        *,
        admin_catalog_version: str,
        catalog_source_ref: str,
        expected_document_number: str | None,
    ) -> dict[str, object]:
        """Build the server-side snapshot registry payload with identity verification."""
        return {
            "snapshotRef": self.snapshot_ref,
            "catalogSourceRef": catalog_source_ref,
            "adminCatalogVersion": admin_catalog_version,
            "documentId": str(self.metadata["documentId"]),
            "documentNumber": self.document_number,
            "sourceUrl": self.source_url,
            "finalUrl": self.final_url,
            "contentType": self.content_type,
            "byteLength": self.byte_length,
            "contentSha256": self.content_sha256,
            "snapshotObjectKey": self.snapshot_object_key,
            "provenanceRef": self.provenance_ref,
            "retrievedAt": self.retrieved_at,
            "sourceEffectStatus": self.source_effect_status,
            "normalizationSource": self.normalization_source,
            "documentIdentityVerified": document_number_matches(
                expected_document_number,
                self.document_number,
            ),
        }

    def register_with_api(
        self,
        *,
        api_client: OfficialSourceSnapshotRegistry,
        admin_catalog_version: str,
        catalog_source_ref: str,
        expected_document_number: str | None,
    ) -> dict:
        """Register the validated snapshot through the internal registry contract."""
        payload = self.to_registry_payload(
            admin_catalog_version=admin_catalog_version,
            catalog_source_ref=catalog_source_ref,
            expected_document_number=expected_document_number,
        )
        return api_client.register_official_source_snapshot(payload)


class OfficialSourceSnapshotFetcher:
    """Dispatch official-source crawlers after strict catalog-host validation."""

    def __init__(self, *, vbpl_session=None, congbao_session=None) -> None:
        """Create the fetcher with optional injected HTTP sessions for each source."""
        self._vbpl_session = vbpl_session
        self._congbao_session = congbao_session

    def fetch(self, request: OfficialSourceSnapshotRequest) -> OfficialSourceSnapshotResult:
        """Fetch one bounded official snapshot and derive immutable provenance refs.

        The source URL must use HTTPS and exactly match the host authorized by
        ``catalog_source_ref``. Source-specific required identity/status fields
        are checked before invoking the crawler, and the resulting manifest is
        normalized into a content-addressed object key.

        Args:
            request: Validated snapshot request from the legal ingest boundary.

        Returns:
            Immutable snapshot metadata and local artifact paths.

        Raises:
            ValueError: If size, host, source-specific fields, or catalog source are invalid.
            RuntimeError: If crawler output does not contain complete artifact metadata.
        """
        if request.max_bytes < 1:
            raise ValueError("max_bytes must be positive")

        catalog_host = catalog_host_from_ref(request.catalog_source_ref)
        source_host = resolved_source_host(catalog_host)
        parsed = urlparse(request.source_url)
        if parsed.scheme != "https" or parsed.hostname != source_host:
            raise ValueError("source_url host does not match the catalog-authorized official source")

        if catalog_host == VBPL_CATALOG_HOST:
            if not request.gateway_document_id:
                raise ValueError("gateway_document_id is required for VBPL sources")
            manifest_path = self._fetch_vbpl(request)
        elif catalog_host == CONGBAO_CATALOG_HOST:
            if not request.source_effect_status:
                raise ValueError("source_effect_status is required for Chính phủ sources")
            manifest_path = self._fetch_congbao(request)
        else:
            raise ValueError("unsupported catalog source")

        metadata = json.loads(manifest_path.read_text(encoding="utf-8"))
        snapshot_path, content_type, content_sha256 = snapshot_artifact(
            manifest_path.parent, metadata
        )
        document_id = str(metadata["documentId"])
        source_id = source_id_for_catalog_host(catalog_host)
        object_key = snapshot_object_key(
            source_id=source_id,
            document_id=document_id,
            content_sha256=content_sha256,
            original_file_name=snapshot_path.name,
        )
        object_root = request.storage_root or request.output_dir
        object_path = (object_root / object_key).resolve()
        if snapshot_path.resolve() != object_path:
            object_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(snapshot_path, object_path)
        return OfficialSourceSnapshotResult(
            manifest_path=manifest_path,
            snapshot_path=object_path,
            snapshot_object_key=object_key,
            snapshot_ref=snapshot_ref(document_id, content_sha256),
            provenance_ref=provenance_ref(document_id, content_sha256),
            content_sha256=content_sha256,
            content_type=content_type,
            byte_length=snapshot_path.stat().st_size,
            retrieved_at=str(metadata["retrievedAt"]),
            source_url=str(metadata["sourceUrl"]),
            final_url=optional_string(metadata.get("finalUrl") or metadata.get("downloadUrl")),
            document_number=optional_string(metadata.get("documentNumber")),
            effective_from=optional_string(
                metadata.get("effectiveFrom") or metadata.get("effectiveDate")
            ),
            source_effect_status=optional_string(metadata.get("sourceEffectStatus")),
            normalization_source=optional_string(metadata.get("normalizationSource")),
            metadata=metadata,
        )

    def _fetch_vbpl(self, request: OfficialSourceSnapshotRequest) -> Path:
        """Invoke the VBPL crawler under the request-specific response-byte limit."""
        module = load_script_module("crawl_vbpl_document.py")
        crawler = module.VbplDocumentCrawler(self._vbpl_session)
        with temporary_response_limit(module, request.max_bytes):
            return crawler.create_snapshot(
                document_id=request.document_id,
                gateway_document_id=request.gateway_document_id,
                source_url=request.source_url,
                output_dir=request.output_dir,
            )

    def _fetch_congbao(self, request: OfficialSourceSnapshotRequest) -> Path:
        """Invoke the Công Báo crawler under the request-specific response-byte limit."""
        module = load_script_module("crawl_congbao_docx.py")
        crawler = module.CongBaoDocxCrawler(self._congbao_session)
        with temporary_response_limit(module, request.max_bytes):
            return crawler.create_snapshot(
                document_id=request.document_id,
                source_url=request.source_url,
                source_effect_status=request.source_effect_status,
                output_dir=request.output_dir,
            )


def catalog_host_from_ref(catalog_source_ref: str) -> str:
    """Extract the official catalog host from a ``catalog-source:<host>:...`` ref."""
    parts = catalog_source_ref.split(":")
    if len(parts) < 3 or parts[0] != "catalog-source":
        raise ValueError("catalog_source_ref is invalid")
    return parts[1]


def resolved_source_host(catalog_host: str) -> str:
    """Resolve the only download host authorized for a supported catalog host."""
    if catalog_host == VBPL_CATALOG_HOST:
        return VBPL_CATALOG_HOST
    if catalog_host == CONGBAO_CATALOG_HOST:
        return CONGBAO_SOURCE_HOST
    raise ValueError("catalog_source_ref host is unsupported")


def snapshot_artifact(
    output_dir: Path, metadata: dict[str, object]
) -> tuple[Path, str, str]:
    """Resolve crawler manifest metadata to artifact path, MIME type, and SHA-256."""
    if isinstance(metadata.get("htmlFile"), str) and isinstance(metadata.get("htmlSha256"), str):
        return output_dir / str(metadata["htmlFile"]), "text/html", str(metadata["htmlSha256"])
    if isinstance(metadata.get("sourceFile"), str):
        return (
            output_dir / str(metadata["sourceFile"]),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            str(metadata["sourceSha256"]),
        )
    if isinstance(metadata.get("snapshotFile"), str) and isinstance(
        metadata.get("sourceSha256"), str
    ):
        return (
            output_dir / str(metadata["snapshotFile"]),
            "application/json",
            str(metadata["sourceSha256"]),
        )
    raise RuntimeError("snapshot artifact metadata is incomplete")


def snapshot_ref(document_id: str, content_sha256: str) -> str:
    """Derive a stable short snapshot reference from document ID and content hash."""
    suffix = content_sha256.removeprefix("sha256:")[:12]
    return f"snapshot:{document_id}:{suffix}"


def provenance_ref(document_id: str, content_sha256: str) -> str:
    """Derive the fetch-provenance reference associated with a snapshot hash."""
    suffix = content_sha256.removeprefix("sha256:")[:12]
    return f"prov:fetch:{document_id}:{suffix}"


def optional_string(value: object) -> str | None:
    """Normalize a non-empty string value while preserving absence."""
    if isinstance(value, str) and value.strip():
        return value
    return None


def document_number_matches(
    expected_document_number: str | None,
    actual_document_number: str | None,
) -> bool:
    """Compare expected/actual legal document numbers after punctuation normalization."""
    if not expected_document_number or not actual_document_number:
        return False
    return normalize_document_number(expected_document_number) == normalize_document_number(
        actual_document_number
    )


def normalize_document_number(value: str) -> str:
    """Normalize a legal document number to uppercase alphanumeric characters."""
    return "".join(ch for ch in value.upper() if ch.isalnum())


def source_id_for_catalog_host(catalog_host: str) -> str:
    """Map an authorized official catalog host to its storage source identifier."""
    source_id = CATALOG_SOURCE_IDS.get(catalog_host)
    if not source_id:
        raise ValueError("catalog_source_ref host is unsupported")
    return source_id


def snapshot_object_key(
    *,
    source_id: str,
    document_id: str,
    content_sha256: str,
    original_file_name: str,
) -> str:
    """Build the content-addressed object-storage key for an official snapshot."""
    return "/".join(
        [
            "legal-source-snapshots",
            source_id,
            document_id,
            content_sha256.removeprefix("sha256:"),
            original_file_name,
        ]
    )


@contextmanager
def temporary_response_limit(module: ModuleType, max_bytes: int):
    """Temporarily override a crawler module's maximum response size."""
    previous = getattr(module, "MAX_RESPONSE_BYTES", None)
    setattr(module, "MAX_RESPONSE_BYTES", max_bytes)
    try:
        yield
    finally:
        if previous is not None:
            setattr(module, "MAX_RESPONSE_BYTES", previous)


@lru_cache(maxsize=4)
def load_script_module(script_name: str) -> ModuleType:
    """Load and cache an approved crawler script from the legal runtime."""
    script_path = Path(__file__).resolve().parents[2] / "scripts" / script_name
    module_name = script_name.replace(".py", "")
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load script module: {script_name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module
