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
INGEST_TOOL_VERSION = "1.0.0"

FAILURE_UNSUPPORTED = "UNSUPPORTED_MEDIA_TYPE"
FAILURE_EXTRACTION = "EXTRACTION_FAILED"
FAILURE_NO_CHUNKS = "NO_CHUNKS"


def failed(attempt: int, code: str) -> dict[str, Any]:
    return {"outcome": "FAILED", "attempt": attempt, "failureCode": code}


def ingest_document(*, data: bytes, media_type: str, structure_profile: str, attempt: int) -> dict[str, Any]:
    """Extract and chunk one document. Never raises for a document problem: it reports a failure code."""
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
        },
        "chunks": result.chunks,
    }
