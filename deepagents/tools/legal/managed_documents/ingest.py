"""One stored document in, one ingestion result out (the API contract's READY / FAILED shape)."""

from __future__ import annotations

from typing import Any

from tools.legal.managed_documents.chunker import (
    MAX_CHUNKS,
    UnknownStructureProfile,
    chunk_document,
    sha256_ref,
)
from tools.legal.managed_documents.extract import MEDIA_MARKDOWN, ExtractionError, extract_document

INGEST_TOOL = "managed-document-ingest"
INGEST_TOOL_VERSION = "1.1.0"  # 1.1: lossless chunk partition, table/footnote/numbering extraction, explicit extraction gaps

FAILURE_UNSUPPORTED = "UNSUPPORTED_MEDIA_TYPE"
FAILURE_EXTRACTION = "EXTRACTION_FAILED"
FAILURE_NO_CHUNKS = "NO_CHUNKS"


def failed(attempt: int, code: str) -> dict[str, Any]:
    """Business purpose: Build the stable FAILED result shape used to settle a document ingestion attempt.

    Business rules:
    - The API contract receives the original positive attempt number and a failure code chosen by the caller.
    - The helper does not infer a failure reason or change ingestion lifecycle state.

    Execution flow:
    1. Place the FAILED outcome, supplied attempt, and failure code into the ingestion result mapping.

    Failure cases:
    - No domain failure is raised; malformed runtime values are returned as supplied for API validation.

    Side effects:
    - None: the failure result is created in memory and is not posted by this helper.
    """
    return {"outcome": "FAILED", "attempt": attempt, "failureCode": code}


def ingest_document(*, data: bytes, media_type: str, structure_profile: str, attempt: int) -> dict[str, Any]:
    """Extract and chunk one document. Known document problems are returned as failure codes for API settlement.

    Business purpose: Turn one stored legal-source document into an evidence-preserving extraction manifest and addressable chunks.

    Business rules:
    - The caller-provided media type and structure profile determine the extraction and chunking path; Markdown marker handling is enabled only for Markdown input.
    - Extraction errors, unknown profiles, and zero or over-limit chunk results become FAILED outcomes rather than accepted partial documents.
    - Unexpected implementation or system errors may still propagate to the boundary, which records an extraction failure there.

    Execution flow:
    1. Extract the document into page text and recorded extraction gaps.
    2. Chunk the extracted pages using the requested profile, falling back only through the chunker's established AUTO/profile behavior.
    3. Convert typed extraction/profile failures or invalid chunk counts into a failure result.
    4. For a valid result, hash the joined text and return tool/version, profile, page, gap, front-matter, and chunk provenance.

    Failure cases:
    - ExtractionError preserves its code; UnknownStructureProfile maps to EXTRACTION_FAILED; empty or over-limit chunks map to NO_CHUNKS.
    - Other unexpected exceptions propagate and are not represented as a fabricated READY result.

    Side effects:
    - None: extraction and chunk records are computed in memory; this function does not call the API or persist ingestion state.
    """
    try:
        extracted = extract_document(media_type, data)
        result = chunk_document(
            extracted.pages, profile=structure_profile, markdown=media_type == MEDIA_MARKDOWN
        )
    except ExtractionError as error:
        return failed(attempt, error.code)
    except UnknownStructureProfile:
        return failed(attempt, FAILURE_EXTRACTION)
    if not result.chunks or len(result.chunks) > MAX_CHUNKS:
        return failed(attempt, FAILURE_NO_CHUNKS)

    text = "\n".join(extracted.pages)
    return {
        "outcome": "READY",
        "attempt": attempt,
        "extraction": {
            "tool": f"{INGEST_TOOL}:{extracted.tool}",
            "toolVersion": INGEST_TOOL_VERSION,
            "structureProfile": result.profile,
            "pageCount": extracted.page_count,
            "textSha256": sha256_ref(text),
            "characterCount": len(text),
            "frontMatterCharacters": result.front_matter_characters,
            "pages": extracted.pages,
            "gaps": extracted.gaps,
        },
        "chunks": result.chunks,
    }
