"""Build deterministic ingest payloads from official-source crawl artifacts."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any

OFFICIAL_SOURCE_AUTO_TRUSTED_POLICY = "OFFICIAL_SOURCE_AUTO_TRUSTED"


def build_official_source_payload(
    manifests: list[Path],
    version: str,
    *,
    partial_update_contexts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build an ingest payload directly from official crawler artifacts."""
    builder = _load_script_module("build_reviewed_legal_corpus.py")
    documents: list[dict[str, Any]] = []
    source_artifacts: list[dict[str, Any]] = []
    document_ids: set[str] = set()
    for manifest_path in manifests:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        document_id = required_manifest_string(
            manifest,
            "documentId",
            source=str(manifest_path),
        )
        if document_id in document_ids:
            raise RuntimeError(f"duplicate source crawl document {document_id}")
        document_ids.add(document_id)
        text_path = _source_text_path(manifest_path, manifest)
        text = text_path.read_text(encoding="utf-8")
        source_artifact_ref, source_artifact_sha = _source_artifact(
            manifest_path,
            manifest,
        )
        chunks = [
            chunk
            for chunk in builder.parse_chunks(document_id, text, None)
            if chunk.get("content")
        ]
        chunks = _namespace_chunks(chunks, version)
        if not chunks:
            raise RuntimeError(f"{document_id}: source crawl produced no chunks")
        source_effect_status = builder.normalize_source_effect_status(
            document_id,
            required_manifest_string(
                manifest,
                "sourceEffectStatus",
                source=str(manifest_path),
            ),
        )
        documents.append(
            {
                "documentId": document_id,
                "title": required_manifest_string(
                    manifest,
                    "title",
                    source=str(manifest_path),
                ),
                "sourceUrl": required_manifest_string(
                    manifest,
                    "sourceUrl",
                    source=str(manifest_path),
                ),
                "sourceSha256": source_artifact_sha,
                "sourceEffectStatus": source_effect_status,
                "effectiveDate": manifest.get("effectiveFrom")
                or manifest.get("effectiveDate"),
                "snapshotPath": source_artifact_ref,
                "chunks": chunks,
            }
        )
        source_artifacts.append(
            {
                "documentId": document_id,
                "sourceManifest": str(manifest_path),
                "sourceManifestSha256": _sha256_bytes(manifest_path.read_bytes()),
                "sourceArtifact": source_artifact_ref,
                "sourceArtifactSha256": source_artifact_sha,
                "textArtifact": str(text_path),
                "textArtifactSha256": _sha256_bytes(text_path.read_bytes()),
            }
        )

    return {
        "version": version,
        "sourceManifest": {
            "reviewRequired": False,
            "trustPolicy": OFFICIAL_SOURCE_AUTO_TRUSTED_POLICY,
            "normalizationWarnings": [],
            "materializedRelationships": [],
            "sourceArtifacts": source_artifacts,
            "partialUpdateContexts": partial_update_contexts or [],
        },
        "documents": documents,
    }


def required_manifest_string(values: dict[str, Any], key: str, source: str) -> str:
    """Read a required non-empty string from a local crawl manifest."""
    value = values.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"{source} is missing {key}")
    return value.strip()


def _source_text_path(manifest_path: Path, manifest: dict[str, Any]) -> Path:
    """Resolve the canonical text file produced by the official crawler."""
    text_file = required_manifest_string(
        manifest,
        "textFile",
        source=str(manifest_path),
    )
    text_path = manifest_path.parent / text_file
    if not text_path.is_file():
        raise RuntimeError(f"{manifest_path}: textFile does not exist: {text_file}")
    return text_path


def _source_artifact(
    manifest_path: Path,
    manifest: dict[str, Any],
) -> tuple[str, str]:
    """Resolve the official source artifact and its declared hash."""
    for file_key, hash_key in (
        ("sourceFile", "sourceSha256"),
        ("htmlFile", "htmlSha256"),
        ("textFile", "textSha256"),
    ):
        value = manifest.get(file_key)
        digest = manifest.get(hash_key)
        if not isinstance(value, str) or not value.strip():
            continue
        path = manifest_path.parent / value
        if not path.is_file():
            continue
        if isinstance(digest, str) and digest.strip():
            return value, digest.strip()
        return value, _sha256_bytes(path.read_bytes())
    raise RuntimeError(f"{manifest_path}: no source artifact is available")


def _sha256_bytes(value: bytes) -> str:
    """Return a tagged SHA-256 digest for source artifact bytes."""
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _safe_ref(value: str) -> str:
    """Normalize a bounded identifier for source and recovery references."""
    return "".join(ch if ch.isalnum() or ch in "._:-" else "-" for ch in value)[:128]


def _namespace_chunks(chunks: list[dict[str, Any]], version: str) -> list[dict[str, Any]]:
    """Make deterministic chunk IDs unique across corpus versions."""
    prefix = _safe_ref(version)
    mapping = {str(c["id"]): f"{prefix}::{c['id']}" for c in chunks if c.get("id")}
    result: list[dict[str, Any]] = []
    for chunk in chunks:
        item = dict(chunk)
        item["id"] = mapping.get(str(chunk.get("id") or ""), chunk.get("id"))
        hierarchy = item.get("hierarchy")
        if isinstance(hierarchy, dict) and hierarchy.get("parentChunkId") in mapping:
            item["hierarchy"] = {**hierarchy, "parentChunkId": mapping[hierarchy["parentChunkId"]]}
        result.append(item)
    return result


def _load_script_module(filename: str):
    """Load an AO-6 corpus build/orchestration script from the legal source tools."""
    path = Path(__file__).resolve().parents[1] / "scripts" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load AO-6 script: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
