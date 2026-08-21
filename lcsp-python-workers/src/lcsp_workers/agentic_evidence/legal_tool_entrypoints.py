"""Canonical same-name execution entrypoints for AO-6 legal corpus tools.

These adapters keep the canonical tool name searchable while preserving the
existing legal-source builders, validators, protected API authority, and worker
implementations. Legal modules are imported lazily to avoid broad package-load
coupling and to keep this routing layer free of orchestration policy.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


@dataclass(frozen=True)
class LegalToolExecutionContext:
    """Trusted dependencies and storage boundary for AO-6 execution adapters."""

    api_client: Any
    storage_root: Path | None
    snapshot_fetcher: Any | None = None
    text_extractor: Any | None = None
    ocr_tool: Any | None = None
    chroma_path: str | None = None


LegalToolInput = Mapping[str, Any]


def _required(request: LegalToolInput, name: str) -> Any:
    if name not in request:
        raise ValueError(f"legal tool input missing required field: {name}")
    return request[name]


def _required_str(request: LegalToolInput, name: str) -> str:
    value = _required(request, name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"legal tool input field must be a non-empty string: {name}")
    return value.strip()


def _optional_str(request: LegalToolInput, name: str) -> str | None:
    value = request.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"legal tool input field must be a non-empty string: {name}")
    return value.strip()


def _path(request: LegalToolInput, name: str) -> Path:
    value = _required(request, name)
    return value if isinstance(value, Path) else Path(str(value))


def _storage_root(context: LegalToolExecutionContext) -> Path:
    if context.storage_root is None:
        raise ValueError("legal tool execution requires a storage_root")
    return context.storage_root.resolve()


def fetch_official_source_snapshot(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Fetch one catalog-authorized immutable official-source snapshot."""
    from lcsp_workers.legal.official_source_snapshot import (
        OfficialSourceSnapshotFetcher,
        OfficialSourceSnapshotRequest,
    )

    fetcher = context.snapshot_fetcher or OfficialSourceSnapshotFetcher()
    output_dir = request.get("output_dir")
    if output_dir is None:
        output_dir = _storage_root(context) / "official-source-snapshots"
    output_path = output_dir if isinstance(output_dir, Path) else Path(str(output_dir))
    max_bytes = _required(request, "max_bytes")
    if not isinstance(max_bytes, int) or max_bytes < 1:
        raise ValueError("legal tool input max_bytes must be a positive integer")

    return fetcher.fetch(
        OfficialSourceSnapshotRequest(
            document_id=_required_str(request, "document_id"),
            catalog_source_ref=_required_str(request, "catalog_source_ref"),
            source_url=_required_str(request, "source_url"),
            output_dir=output_path,
            max_bytes=max_bytes,
            gateway_document_id=_optional_str(request, "gateway_document_id"),
            source_effect_status=_optional_str(request, "source_effect_status"),
            expected_document_number=_optional_str(
                request, "expected_document_number"
            ),
        )
    )


def extract_official_text(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Extract deterministic canonical text from one immutable source snapshot.

    Runtime consumers normally provide only the registered ``snapshot_ref`` and
    let this canonical boundary resolve/verify storage metadata. ``source_manifest_path``
    remains supported for deterministic script/tests that already hold a pinned
    manifest path.
    """
    from lcsp_workers.legal.official_text_extraction import (
        OfficialSourceSnapshotResolver,
        OfficialTextExtractionRequest,
        OfficialTextExtractor,
    )

    max_pages = _required(request, "max_pages")
    if not isinstance(max_pages, int) or max_pages < 1:
        raise ValueError("legal tool input max_pages must be a positive integer")

    extractor = context.text_extractor or OfficialTextExtractor()
    source_manifest_path = request.get("source_manifest_path")
    if source_manifest_path is not None:
        return extractor.extract(
            OfficialTextExtractionRequest(
                snapshot_ref=_required_str(request, "snapshot_ref"),
                extractor_profile=_required_str(request, "extractor_profile"),
                max_pages=max_pages,
                source_manifest_path=_path(request, "source_manifest_path"),
                output_dir=_path(request, "output_dir"),
            )
        )

    root = _storage_root(context)
    snapshot_ref = _required_str(request, "snapshot_ref")
    resolved = OfficialSourceSnapshotResolver(
        api_client=context.api_client,
        storage_root=root,
    ).resolve(snapshot_ref=snapshot_ref)
    output_dir = request.get("output_dir")
    if output_dir is None:
        output_dir = (
            root
            / "official-text-extractions"
            / resolved.snapshot_ref.removeprefix("snapshot:").replace(":", "_")
        )
    output_path = output_dir if isinstance(output_dir, Path) else Path(str(output_dir))
    return extractor.extract_from_resolved_snapshot(
        resolved_snapshot=resolved,
        extractor_profile=_required_str(request, "extractor_profile"),
        max_pages=max_pages,
        output_dir=output_path,
    )


def run_ocr_fallback(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Run bounded OCR only for pages authorized by a fallback proof."""
    from lcsp_workers.legal.official_text_extraction import OfficialSourceSnapshotResolver
    from lcsp_workers.legal.official_text_extraction_repository import (
        OfficialTextExtractionRepository,
    )
    from lcsp_workers.legal.ocr_fallback import OcrFallbackRequest, OcrFallbackTool

    root = _storage_root(context)
    tool = context.ocr_tool or OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=context.api_client,
            storage_root=root,
        ),
        extraction_repository=OfficialTextExtractionRepository(storage_root=root),
    )
    page_numbers = _required(request, "page_numbers")
    if not isinstance(page_numbers, list) or not page_numbers:
        raise ValueError("legal tool input page_numbers must be a non-empty list")
    if any(not isinstance(page, int) or page < 1 for page in page_numbers):
        raise ValueError("legal tool input page_numbers must contain positive integers")
    output_dir = request.get("output_dir")
    if output_dir is None:
        output_dir = root / "official-ocr-fallbacks"
    output_path = output_dir if isinstance(output_dir, Path) else Path(str(output_dir))

    return tool.run(
        OcrFallbackRequest(
            snapshot_ref=_required_str(request, "snapshot_ref"),
            fallback_proof_ref=_required_str(request, "fallback_proof_ref"),
            page_numbers=list(page_numbers),
            ocr_profile=_required_str(request, "ocr_profile"),
            output_dir=output_path,
        )
    )


def evaluate_ocr_quality(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Evaluate deterministic OCR/canonical extraction quality."""
    from lcsp_workers.legal.official_text_extraction_repository import (
        OfficialTextExtractionRepository,
    )
    from lcsp_workers.legal.ocr_fallback_repository import OcrFallbackRepository
    from lcsp_workers.legal.ocr_quality_validator import (
        EvaluateOcrQualityRequest,
        OcrQualityValidator,
    )

    root = _storage_root(context)
    validator = OcrQualityValidator(
        storage_root=root,
        extraction_repository=OfficialTextExtractionRepository(storage_root=root),
        ocr_repository=OcrFallbackRepository(storage_root=root),
    )
    return validator.evaluate(
        EvaluateOcrQualityRequest(
            extraction_ref=_required_str(request, "extraction_ref"),
            expected_identity_ref=_required_str(request, "expected_identity_ref"),
            quality_profile=_required_str(request, "quality_profile"),
        )
    )


def build_reviewed_corpus_input(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Build one immutable reviewed corpus input from passing quality evidence."""
    from lcsp_workers.legal.official_text_extraction_repository import (
        OfficialTextExtractionRepository,
    )
    from lcsp_workers.legal.ocr_fallback_repository import OcrFallbackRepository
    from lcsp_workers.legal.ocr_quality_repository import OcrQualityRepository
    from lcsp_workers.legal.reviewed_corpus_input_builder import (
        BuildReviewedCorpusInputRequest,
        ReviewedCorpusInputBuilder,
    )

    root = _storage_root(context)
    builder = ReviewedCorpusInputBuilder(
        storage_root=root,
        extraction_repository=OfficialTextExtractionRepository(storage_root=root),
        ocr_repository=OcrFallbackRepository(storage_root=root),
        quality_repository=OcrQualityRepository(storage_root=root),
    )
    return builder.build(
        BuildReviewedCorpusInputRequest(
            extraction_ref=_required_str(request, "extraction_ref"),
            quality_manifest_ref=_required_str(request, "quality_manifest_ref"),
            correction_profile=_required_str(request, "correction_profile"),
        )
    )


def build_legal_chunks(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Build deterministic legal chunks from one reviewed-input artifact."""
    from lcsp_workers.legal.legal_chunk_builder import (
        BuildLegalChunksRequest,
        LegalChunkBuilder,
    )
    from lcsp_workers.legal.reviewed_corpus_input_repository import (
        ReviewedCorpusInputRepository,
    )

    root = _storage_root(context)
    builder = LegalChunkBuilder(
        storage_root=root,
        reviewed_input_repository=ReviewedCorpusInputRepository(storage_root=root),
    )
    return builder.build(
        BuildLegalChunksRequest(
            reviewed_input_ref=_required_str(request, "reviewed_input_ref"),
            document_identity_ref=_required_str(request, "document_identity_ref"),
            chunk_schema_version=_required_str(request, "chunk_schema_version"),
        )
    )


def build_vbpl_effected_chunk_set(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Detect VBPL effect markup and export an effect-aware legal chunk set."""
    from lcsp_workers.legal.vbpl_effect_applier import apply_effect_observations
    from lcsp_workers.legal.vbpl_effect_detector import detect_effects
    from lcsp_workers.legal.vbpl_effected_chunk_set_exporter import export_chunk_set

    root = _storage_root(context)
    output_dir = request.get("output_dir")
    if output_dir is None:
        output_dir = root / "vbpl-effect-runs"
    output_path = output_dir if isinstance(output_dir, Path) else Path(str(output_dir))
    output_path.mkdir(parents=True, exist_ok=True)

    source_manifest_path = _path(request, "source_manifest_path")
    normalized_payload_path = _path(request, "normalized_payload_path")
    run_id = _optional_str(request, "run_id") or source_manifest_path.stem.replace(
        ".source", ""
    )
    effect_observations_path = output_path / f"{run_id}.effect-observations.json"
    normalized_with_effects_path = output_path / f"{run_id}.normalized-with-effects.json"

    detect_effects(
        source_manifest_path=source_manifest_path,
        output_path=effect_observations_path,
    )
    apply_effect_observations(
        normalized_payload_path=normalized_payload_path,
        effect_observations_path=effect_observations_path,
        output_path=normalized_with_effects_path,
        propagate_repealed_descendants=not bool(
            request.get("no_propagate_repealed_descendants", False)
        ),
    )
    return export_chunk_set(
        normalized_payload_path=normalized_with_effects_path,
        storage_root=root,
        document_identity_ref=_required_str(request, "document_identity_ref"),
        reviewed_input_ref=_required_str(request, "reviewed_input_ref"),
        chunk_set_ref=_optional_str(request, "chunk_set_ref"),
        relationship_manifest_ref=_optional_str(request, "relationship_manifest_ref"),
    )


def validate_chunk_integrity(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Validate chunk-set integrity against the pinned relationship manifest."""
    from lcsp_workers.legal.chunk_integrity_validator import (
        ChunkIntegrityValidator,
        ValidateChunkIntegrityRequest,
    )
    from lcsp_workers.legal.legal_chunk_repository import LegalChunkRepository
    from lcsp_workers.legal.relationship_manifest_repository import (
        RelationshipManifestRepository,
    )

    root = _storage_root(context)
    validator = ChunkIntegrityValidator(
        storage_root=root,
        chunk_repository=LegalChunkRepository(storage_root=root),
        relationship_repository=RelationshipManifestRepository(storage_root=root),
    )
    return validator.validate(
        ValidateChunkIntegrityRequest(
            chunk_set_ref=_required_str(request, "chunk_set_ref"),
            relationship_manifest_ref=_required_str(
                request, "relationship_manifest_ref"
            ),
            validation_profile=_required_str(request, "validation_profile"),
        )
    )


def build_legal_retrieval_index(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Build the deterministic structure-first legal retrieval index."""
    from lcsp_workers.legal.chunk_integrity_repository import ChunkIntegrityRepository
    from lcsp_workers.legal.legal_chunk_repository import LegalChunkRepository
    from lcsp_workers.legal.legal_retrieval_index_builder import (
        BuildLegalRetrievalIndexRequest,
        LegalRetrievalIndexBuilder,
    )

    root = _storage_root(context)
    builder = LegalRetrievalIndexBuilder(
        storage_root=root,
        chunk_repository=LegalChunkRepository(storage_root=root),
        integrity_repository=ChunkIntegrityRepository(storage_root=root),
    )
    return builder.build(
        BuildLegalRetrievalIndexRequest(
            chunk_set_ref=_required_str(request, "chunk_set_ref"),
            integrity_manifest_ref=_required_str(request, "integrity_manifest_ref"),
            index_profile=_required_str(request, "index_profile"),
        )
    )


def validate_retrieval_index(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
) -> dict[str, str]:
    """Require every corpus chunk to round-trip as an exact PRIMARY_MATCH."""
    from lcsp_workers.legal.chromadb_citation_retriever import ChromaDbCitationRetriever

    payload = _required(request, "payload")
    if not isinstance(payload, dict):
        raise ValueError("legal tool input payload must be an object")
    corpus_version_id = _required_str(request, "corpus_version_id")
    chunks = [
        chunk
        for document in payload.get("documents") or []
        if isinstance(document, dict)
        for chunk in document.get("chunks") or []
        if isinstance(chunk, dict)
    ]
    if not chunks:
        raise RuntimeError("Corpus payload has no chunks to index")

    retriever = ChromaDbCitationRetriever(context.chroma_path)
    retriever.index_corpus(corpus_version_id, chunks)
    expected_ids = {str(chunk.get("id") or "") for chunk in chunks}
    if "" in expected_ids:
        raise RuntimeError("Corpus payload contains a chunk without stable ID")
    retrieved = retriever.retrieve_exact(corpus_version_id, list(expected_ids))
    primary_ids = {chunk.id for chunk in retrieved if chunk.role == "PRIMARY_MATCH"}
    if primary_ids != expected_ids:
        missing = sorted(expected_ids - primary_ids)
        raise RuntimeError(
            f"Retrieval index validation failed; missing chunk IDs: {missing}"
        )
    return {
        "status": "READY",
        "corpus_version_id": corpus_version_id,
    }


def activate_validated_corpus_version(
    request: LegalToolInput,
    context: LegalToolExecutionContext,
):
    """Cross the protected API boundary to activate one fully validated corpus."""
    corpus_version_id = _required_str(request, "corpus_version_id")
    payload = _required(request, "payload")
    if not isinstance(payload, dict):
        raise ValueError("legal tool input payload must be an object")
    idempotency_key = payload.get("idempotencyKey")
    if not isinstance(idempotency_key, str) or not idempotency_key.strip():
        raise ValueError("activate_validated_corpus_version requires idempotencyKey")
    return context.api_client.activate_validated_corpus_version(
        corpus_version_id,
        payload,
    )
