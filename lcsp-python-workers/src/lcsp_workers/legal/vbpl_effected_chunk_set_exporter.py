from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


CHUNK_SCHEMA_VERSION = "LEGAL_CHUNK_V1"


def export_chunk_set(
    *,
    normalized_payload_path: Path,
    storage_root: Path,
    document_identity_ref: str,
    reviewed_input_ref: str,
    chunk_set_ref: str | None = None,
    relationship_manifest_ref: str | None = None,
) -> dict[str, Any]:
    payload = json.loads(normalized_payload_path.read_text(encoding="utf-8"))
    documents = payload.get("documents")
    if not isinstance(documents, list) or len(documents) != 1:
        raise ValueError("Expected exactly one document in normalized payload")
    document = documents[0]
    if not isinstance(document, dict):
        raise ValueError("Normalized document must be an object")

    document_id = required(document, "documentId")
    chunks = document.get("chunks")
    if not isinstance(chunks, list) or not chunks:
        raise ValueError("Normalized document has no chunks")

    chunk_set_id = stable_id(
        normalized_payload_path.read_bytes(),
        document_identity_ref.encode("utf-8"),
        reviewed_input_ref.encode("utf-8"),
    )
    chunk_set_ref = chunk_set_ref or f"chunk-set:vbpl-effect-preview-{chunk_set_id}"
    provenance_ref = f"prov:chunks:vbpl-effect-preview-{chunk_set_id}"
    relationship_manifest_ref = (
        relationship_manifest_ref
        or f"relationship-manifest:vbpl-effect-preview-{chunk_set_id}"
    )
    relationship_provenance_ref = f"prov:relationship:vbpl-effect-preview-{chunk_set_id}"

    source_manifest = payload.get("sourceManifest", {})
    source_artifact = first_source_artifact(source_manifest)
    normalized_chunks = normalize_chunks(
        chunks,
        document=document,
        source_artifact=source_artifact,
        chunk_set_ref=chunk_set_ref,
    )
    chunks_json = json.dumps(normalized_chunks, ensure_ascii=False, indent=2) + "\n"
    chunk_manifest_sha256 = sha256_bytes(chunks_json.encode("utf-8"))
    output_dir = storage_root / "legal-chunk-sets" / chunk_set_id
    output_dir.mkdir(parents=True, exist_ok=True)
    chunks_path = output_dir / f"{document_id}.legal-chunks.json"
    manifest_path = output_dir / f"{document_id}.chunk-manifest.json"
    chunks_path.write_text(chunks_json, encoding="utf-8")
    manifest = {
        "chunkSetRef": chunk_set_ref,
        "provenanceRef": provenance_ref,
        "reviewedInputRef": reviewed_input_ref,
        "documentIdentityRef": document_identity_ref,
        "chunkSchemaVersion": CHUNK_SCHEMA_VERSION,
        "chunkCount": len(normalized_chunks),
        "chunkManifestSha256": chunk_manifest_sha256,
        "documentId": document_id,
        "chunksFile": chunks_path.name,
        "sourceKind": "VBPL_NORMALIZED_EFFECT_PREVIEW",
        "snapshotRef": str(normalized_payload_path),
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_chunk_registry(
        storage_root=storage_root,
        chunk_set_ref=chunk_set_ref,
        provenance_ref=provenance_ref,
        reviewed_input_ref=reviewed_input_ref,
        document_identity_ref=document_identity_ref,
        document_id=document_id,
        chunk_count=len(normalized_chunks),
        chunk_manifest_sha256=chunk_manifest_sha256,
        chunks_path=chunks_path,
        manifest_path=manifest_path,
        evidence_refs=[
            str(normalized_payload_path),
            str(source_manifest.get("effectObservationFile") or ""),
        ],
    )

    relationships = materialized_relationships(
        document_id=document_id,
        chunks=normalized_chunks,
    )
    relationship_manifest_path = write_relationship_manifest(
        storage_root=storage_root,
        relationship_manifest_ref=relationship_manifest_ref,
        provenance_ref=relationship_provenance_ref,
        chunk_set_ref=chunk_set_ref,
        target_document_id=document_id,
        source_effect_status=str(document.get("sourceEffectStatus") or "UNKNOWN"),
        relationships=relationships,
        evidence_refs=[
            str(normalized_payload_path),
            str(source_manifest.get("effectObservationFile") or ""),
        ],
    )
    return {
        "chunkSetRef": chunk_set_ref,
        "relationshipManifestRef": relationship_manifest_ref,
        "chunkCount": len(normalized_chunks),
        "relationshipCount": len(relationships),
        "chunksPath": str(chunks_path),
        "chunkManifestPath": str(manifest_path),
        "relationshipManifestPath": str(relationship_manifest_path),
    }


def normalize_chunks(
    chunks: list[Any],
    *,
    document: dict[str, Any],
    source_artifact: dict[str, Any],
    chunk_set_ref: str,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        item = dict(chunk)
        chunk_id = required(item, "id")
        content = required(item, "content")
        hierarchy = item.setdefault("hierarchy", {})
        if not isinstance(hierarchy, dict):
            hierarchy = {}
            item["hierarchy"] = hierarchy
        item.setdefault("chunkRef", f"legal-chunk:{chunk_id}")
        item.setdefault("schemaVersion", CHUNK_SCHEMA_VERSION)
        item["contentSha256"] = sha256_text(content)
        hierarchy.setdefault("documentNumber", source_artifact.get("documentNumber", ""))
        hierarchy.setdefault("documentTitle", document.get("title", ""))
        hierarchy.setdefault("effectiveFrom", document.get("effectiveDate", ""))
        hierarchy.setdefault("sourceEffectStatus", document.get("sourceEffectStatus", ""))
        hierarchy.setdefault("sourceUrl", document.get("sourceUrl", ""))
        hierarchy.setdefault("sourceChecksum", document.get("sourceSha256", ""))
        hierarchy.setdefault("chunkSetRef", chunk_set_ref)
        normalized.append(item)
    return normalized


def materialized_relationships(
    *, document_id: str, chunks: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    relationships: list[dict[str, Any]] = []
    for chunk in chunks:
        hierarchy = chunk.get("hierarchy", {})
        if not isinstance(hierarchy, dict):
            continue
        observations = hierarchy.get("legalEffectObservations")
        if not isinstance(observations, list) or not observations:
            continue
        for observation in observations:
            if not isinstance(observation, dict):
                continue
            relationships.append(
                {
                    "type": "VBPL_EFFECT_MARKUP",
                    "effectKind": observation.get("effectKind"),
                    "targetDocumentId": document_id,
                    "targetLocator": chunk.get("locator"),
                    "declaredLocators": [observation.get("locator")],
                    "materializedChunkIds": [chunk.get("id")],
                    "htmlId": observation.get("htmlId"),
                    "htmlParagraphIndex": observation.get("htmlParagraphIndex"),
                    "typeMarker": observation.get("type"),
                    "newTypeMarker": observation.get("newType"),
                    "textSha256": observation.get("textSha256"),
                    "reviewRequired": observation.get("reviewRequired", True),
                    **(
                        {"inheritedFromLocator": observation["inheritedFromLocator"]}
                        if observation.get("inheritedFromLocator")
                        else {}
                    ),
                }
            )
    return relationships


def write_chunk_registry(
    *,
    storage_root: Path,
    chunk_set_ref: str,
    provenance_ref: str,
    reviewed_input_ref: str,
    document_identity_ref: str,
    document_id: str,
    chunk_count: int,
    chunk_manifest_sha256: str,
    chunks_path: Path,
    manifest_path: Path,
    evidence_refs: list[str],
) -> None:
    record = {
        "chunkSetRef": chunk_set_ref,
        "provenanceRef": provenance_ref,
        "reviewedInputRef": reviewed_input_ref,
        "documentIdentityRef": document_identity_ref,
        "chunkSchemaVersion": CHUNK_SCHEMA_VERSION,
        "status": "READY",
        "coverageState": "SUFFICIENT",
        "chunkCount": chunk_count,
        "chunkManifestSha256": chunk_manifest_sha256,
        "documentId": document_id,
        "chunksPath": str(chunks_path),
        "manifestPath": str(manifest_path),
        "evidenceRefs": [ref for ref in evidence_refs if ref],
        "limitations": [],
    }
    write_registry_record(
        storage_root / "legal-chunk-sets" / "registry" / "chunk-sets",
        chunk_set_ref,
        record,
    )
    write_registry_record(
        storage_root / "legal-chunk-sets" / "registry" / "provenance",
        provenance_ref,
        record,
    )


def write_relationship_manifest(
    *,
    storage_root: Path,
    relationship_manifest_ref: str,
    provenance_ref: str,
    chunk_set_ref: str,
    target_document_id: str,
    source_effect_status: str,
    relationships: list[dict[str, Any]],
    evidence_refs: list[str],
) -> Path:
    manifest_id = stable_id(
        relationship_manifest_ref.encode("utf-8"),
        chunk_set_ref.encode("utf-8"),
    )
    output_dir = storage_root / "relationship-manifests" / manifest_id
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    manifest_record = {
        "relationshipManifestRef": relationship_manifest_ref,
        "provenanceRef": provenance_ref,
        "chunkSetRef": chunk_set_ref,
        "targetDocumentId": target_document_id,
        "sourceEffectStatus": source_effect_status,
        "materializedRelationships": relationships,
        "evidenceRefs": [ref for ref in evidence_refs if ref],
        "limitations": [],
        "manifestPath": str(manifest_path),
    }
    manifest_path.write_text(
        json.dumps(manifest_record, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_registry_record(
        storage_root / "relationship-manifests" / "registry" / "relationship-manifests",
        relationship_manifest_ref,
        manifest_record,
    )
    write_registry_record(
        storage_root / "relationship-manifests" / "registry" / "provenance",
        provenance_ref,
        manifest_record,
    )
    return manifest_path


def write_registry_record(directory: Path, ref: str, payload: dict[str, Any]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{safe_ref(ref)}.json"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def first_source_artifact(source_manifest: Any) -> dict[str, Any]:
    if not isinstance(source_manifest, dict):
        return {}
    artifacts = source_manifest.get("sourceArtifacts")
    if isinstance(artifacts, list) and artifacts and isinstance(artifacts[0], dict):
        return artifacts[0]
    return {}


def stable_id(*values: bytes) -> str:
    digest = hashlib.sha256()
    for value in values:
        digest.update(value)
        digest.update(b"\0")
    return digest.hexdigest()[:24]


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def safe_ref(value: str) -> str:
    return value.replace(":", "__")


def required(values: dict[str, Any], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Missing required field {key}")
    return value
