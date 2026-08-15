from __future__ import annotations

import json
import re
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

from .official_text_extraction import _sha256_bytes, _sha256_text
from .legal_chunk_repository import LegalChunkSetRecord
from .reviewed_corpus_input_repository import ReviewedCorpusInputRepository

ARTICLE = re.compile(r"^Điều\s+(\d+)\.(?:\s*(.*))?$", re.I)
CLAUSE = re.compile(r"^(\d+)\.\s*(.+)$")
POINT = re.compile(r"^([a-zđ])\)\s*(.+)$", re.I)
CHAPTER = re.compile(r"^Chương\s+([IVXLC]+)\b\s*(.*)$", re.I)

LEGAL_CHUNK_TOOL = {
    "name": "build_legal_chunks",
    "version": "1.0.0",
    "config_hash": "sha256:chunk-v1",
}

LEGAL_CHUNK_SCHEMA_VERSIONS = {
    "legal_chunk_v1": "LEGAL_CHUNK_V1",
}

LEGAL_CHUNK_STATUSES = {
    "ready": "READY",
    "needs_input": "NEEDS_INPUT",
    "conflict": "CONFLICT",
    "blocked": "BLOCKED",
}

LEGAL_CHUNK_COVERAGE_STATES = {
    "sufficient": "SUFFICIENT",
    "partial": "PARTIAL",
    "unavailable": "UNAVAILABLE",
}

LEGAL_CHUNK_LIMITATION_CODES = {
    "reviewed_input_missing": "REVIEWED_INPUT_MISSING",
    "reviewed_input_hash_mismatch": "REVIEWED_INPUT_HASH_MISMATCH",
    "duplicate_locator": "DUPLICATE_LOCATOR",
    "malformed_hierarchy": "MALFORMED_HIERARCHY",
    "missing_parent": "MISSING_PARENT",
}


@dataclass(frozen=True)
class BuildLegalChunksRequest:
    reviewed_input_ref: str
    document_identity_ref: str
    chunk_schema_version: str


@dataclass(frozen=True)
class LegalChunkSetResult:
    status: str
    chunk_set_ref: str
    chunk_set_id: str
    provenance_ref: str
    reviewed_input_ref: str
    document_identity_ref: str
    chunk_schema_version: str
    coverage_state: str
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]
    chunk_count: int
    chunk_manifest_sha256: str
    document_id: str
    chunks_path: Path
    manifest_path: Path
    sample: dict[str, Any]

    def to_tool_response(self, *, correlationId: str) -> dict[str, Any]:
        return {
            "status": self.status,
            "toolName": LEGAL_CHUNK_TOOL["name"],
            "toolVersion": LEGAL_CHUNK_TOOL["version"],
            "configHash": LEGAL_CHUNK_TOOL["config_hash"],
            "correlationId": correlationId,
            "artifactVersions": {
                "chunkSetId": self.chunk_set_id,
            },
            "provenanceRef": self.provenance_ref,
            "coverageState": self.coverage_state,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "result": {
                "chunkSetRef": self.chunk_set_ref,
                "chunkCount": self.chunk_count,
                "chunkManifestSha256": self.chunk_manifest_sha256,
                "schemaVersion": self.chunk_schema_version,
                "sample": self.sample,
            },
        }

    def to_record(self) -> LegalChunkSetRecord:
        return LegalChunkSetRecord(
            chunk_set_ref=self.chunk_set_ref,
            provenance_ref=self.provenance_ref,
            reviewed_input_ref=self.reviewed_input_ref,
            document_identity_ref=self.document_identity_ref,
            chunk_schema_version=self.chunk_schema_version,
            status=self.status,
            coverage_state=self.coverage_state,
            chunk_count=self.chunk_count,
            chunk_manifest_sha256=self.chunk_manifest_sha256,
            document_id=self.document_id,
            chunks_path=str(self.chunks_path),
            manifest_path=str(self.manifest_path),
            evidence_refs=self.evidence_refs,
            limitations=self.limitations,
        )


class LegalChunkBuilder:
    def __init__(
        self,
        *,
        storage_root: Path,
        reviewed_input_repository: ReviewedCorpusInputRepository,
    ) -> None:
        self._storage_root = storage_root
        self._reviewed_input_repository = reviewed_input_repository

    def build(self, request: BuildLegalChunksRequest) -> LegalChunkSetResult:
        chunk_set_id = _chunk_set_id(
            reviewed_input_ref=request.reviewed_input_ref,
            document_identity_ref=request.document_identity_ref,
            chunk_schema_version=request.chunk_schema_version,
        )
        chunk_set_ref = f"chunk-set:{chunk_set_id}"
        provenance_ref = f"prov:chunks:{chunk_set_id}"

        if request.chunk_schema_version != LEGAL_CHUNK_SCHEMA_VERSIONS["legal_chunk_v1"]:
            raise ValueError("unsupported chunk schema version")

        reviewed_input = self._reviewed_input_repository.get_by_reviewed_input_ref(
            request.reviewed_input_ref
        )
        if reviewed_input is None:
            return self._needs_input(
                chunk_set_id=chunk_set_id,
                chunk_set_ref=chunk_set_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_CHUNK_LIMITATION_CODES["reviewed_input_missing"],
                reason="reviewed input record was not found",
            )

        text_path = Path(reviewed_input.normalized_text_path)
        if not text_path.is_file():
            return self._needs_input(
                chunk_set_id=chunk_set_id,
                chunk_set_ref=chunk_set_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_CHUNK_LIMITATION_CODES["reviewed_input_missing"],
                reason="reviewed input text artifact is missing from storage",
            )

        text = text_path.read_text(encoding="utf-8").rstrip("\n")
        if _sha256_text(text) != reviewed_input.content_sha256:
            return self._conflict(
                chunk_set_id=chunk_set_id,
                chunk_set_ref=chunk_set_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_CHUNK_LIMITATION_CODES["reviewed_input_hash_mismatch"],
                reason="reviewed input text hash does not match persisted metadata",
            )

        identity_token = _identity_token(request.document_identity_ref)
        try:
            chunks = parse_legal_chunks(identity_token=identity_token, text=text)
        except RuntimeError as exc:
            message = str(exc)
            if "duplicate legal locator" in message or "missing parent chunk" in message:
                return self._conflict(
                    chunk_set_id=chunk_set_id,
                    chunk_set_ref=chunk_set_ref,
                    provenance_ref=provenance_ref,
                    request=request,
                    code=LEGAL_CHUNK_LIMITATION_CODES["duplicate_locator"]
                    if "duplicate legal locator" in message
                    else LEGAL_CHUNK_LIMITATION_CODES["missing_parent"],
                    reason=message,
                )
            return self._needs_input(
                chunk_set_id=chunk_set_id,
                chunk_set_ref=chunk_set_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_CHUNK_LIMITATION_CODES["malformed_hierarchy"],
                reason=message,
            )
        chunks_payload = [chunk for chunk in chunks]
        chunks_json = json.dumps(chunks_payload, ensure_ascii=False, indent=2) + "\n"
        chunk_manifest_sha256 = _sha256_bytes(chunks_json.encode("utf-8"))
        output_dir = self._storage_root / "legal-chunk-sets" / chunk_set_id
        output_dir.mkdir(parents=True, exist_ok=True)
        chunks_path = output_dir / f"{reviewed_input.document_id}.legal-chunks.json"
        chunks_path.write_text(chunks_json, encoding="utf-8")
        manifest = {
            "chunkSetRef": chunk_set_ref,
            "provenanceRef": provenance_ref,
            "reviewedInputRef": request.reviewed_input_ref,
            "documentIdentityRef": request.document_identity_ref,
            "chunkSchemaVersion": request.chunk_schema_version,
            "chunkCount": len(chunks_payload),
            "chunkManifestSha256": chunk_manifest_sha256,
            "documentId": reviewed_input.document_id,
            "chunksFile": chunks_path.name,
            "sourceKind": reviewed_input.source_kind,
            "snapshotRef": reviewed_input.snapshot_ref,
        }
        manifest_path = output_dir / f"{reviewed_input.document_id}.chunk-manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        sample_chunk = chunks_payload[0]
        return LegalChunkSetResult(
            status=LEGAL_CHUNK_STATUSES["ready"],
            chunk_set_ref=chunk_set_ref,
            chunk_set_id=chunk_set_id,
            provenance_ref=provenance_ref,
            reviewed_input_ref=request.reviewed_input_ref,
            document_identity_ref=request.document_identity_ref,
            chunk_schema_version=request.chunk_schema_version,
            coverage_state=LEGAL_CHUNK_COVERAGE_STATES["sufficient"],
            evidence_refs=[sample_chunk["chunkRef"]],
            limitations=[],
            chunk_count=len(chunks_payload),
            chunk_manifest_sha256=chunk_manifest_sha256,
            document_id=reviewed_input.document_id,
            chunks_path=chunks_path,
            manifest_path=manifest_path,
            sample={
                "chunkId": sample_chunk["id"],
                "locator": sample_chunk["locator"],
                "parentChunkId": sample_chunk["hierarchy"].get("parentChunkId"),
                "legalStatus": sample_chunk["legalStatus"],
            },
        )

    def _needs_input(
        self,
        *,
        chunk_set_id: str,
        chunk_set_ref: str,
        provenance_ref: str,
        request: BuildLegalChunksRequest,
        code: str,
        reason: str,
    ) -> LegalChunkSetResult:
        return _problem_result(
            status=LEGAL_CHUNK_STATUSES["needs_input"],
            coverage_state=LEGAL_CHUNK_COVERAGE_STATES["partial"],
            chunk_set_id=chunk_set_id,
            chunk_set_ref=chunk_set_ref,
            provenance_ref=provenance_ref,
            request=request,
            code=code,
            reason=reason,
        )

    def _conflict(
        self,
        *,
        chunk_set_id: str,
        chunk_set_ref: str,
        provenance_ref: str,
        request: BuildLegalChunksRequest,
        code: str,
        reason: str,
    ) -> LegalChunkSetResult:
        return _problem_result(
            status=LEGAL_CHUNK_STATUSES["conflict"],
            coverage_state=LEGAL_CHUNK_COVERAGE_STATES["unavailable"],
            chunk_set_id=chunk_set_id,
            chunk_set_ref=chunk_set_ref,
            provenance_ref=provenance_ref,
            request=request,
            code=code,
            reason=reason,
        )


def _problem_result(
    *,
    status: str,
    coverage_state: str,
    chunk_set_id: str,
    chunk_set_ref: str,
    provenance_ref: str,
    request: BuildLegalChunksRequest,
    code: str,
    reason: str,
) -> LegalChunkSetResult:
    return LegalChunkSetResult(
        status=status,
        chunk_set_ref=chunk_set_ref,
        chunk_set_id=chunk_set_id,
        provenance_ref=provenance_ref,
        reviewed_input_ref=request.reviewed_input_ref,
        document_identity_ref=request.document_identity_ref,
        chunk_schema_version=request.chunk_schema_version,
        coverage_state=coverage_state,
        evidence_refs=[],
        limitations=[
            {
                "code": code,
                "affectedScopeRef": request.reviewed_input_ref,
                "reason": reason,
                "retryable": False,
            }
        ],
        chunk_count=0,
        chunk_manifest_sha256=_sha256_text(""),
        document_id="UNKNOWN",
        chunks_path=Path("missing"),
        manifest_path=Path("missing"),
        sample={
            "chunkId": "UNKNOWN",
            "locator": "UNKNOWN",
            "parentChunkId": None,
            "legalStatus": "ACTIVE",
        },
    )


def parse_legal_chunks(*, identity_token: str, text: str) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    locators: set[str] = set()
    chapter: dict[str, str] | None = None
    awaiting_chapter_title = False
    article_chunk: dict[str, Any] | None = None
    clause_chunk: dict[str, Any] | None = None
    point_chunk: dict[str, Any] | None = None

    def add(item: dict[str, Any]) -> dict[str, Any]:
        locator = str(item["locator"])
        if locator in locators:
            raise RuntimeError(f"duplicate legal locator {locator}")
        locators.add(locator)
        chunks.append(item)
        return item

    for raw_line in text.splitlines():
        line = " ".join(raw_line.split())
        if not line:
            continue

        chapter_match = CHAPTER.match(line)
        if chapter_match:
            number, inline_title = chapter_match.groups()
            chapter = {
                "chapterNumber": number.upper(),
                "chapterTitle": inline_title.strip(),
            }
            awaiting_chapter_title = not bool(inline_title.strip())
            article_chunk = clause_chunk = point_chunk = None
            continue

        article_match = ARTICLE.match(line)
        if article_match:
            awaiting_chapter_title = False
            number, title = article_match.groups()
            hierarchy = {
                "articleNumber": number,
                "articleTitle": (title or "").strip(),
                **(chapter or {}),
            }
            locator = f"art-{number}"
            article_chunk = add(
                new_chunk(identity_token=identity_token, locator=locator, content=line, hierarchy=hierarchy)
            )
            clause_chunk = point_chunk = None
            continue

        if awaiting_chapter_title and article_chunk is None:
            if chapter is not None:
                chapter["chapterTitle"] = line
            awaiting_chapter_title = False
            continue

        clause_match = CLAUSE.match(line)
        if clause_match and article_chunk is not None:
            number, _ = clause_match.groups()
            locator = f"{article_chunk['locator']}::cl-{number}"
            article_hierarchy = article_chunk["hierarchy"]
            hierarchy = {
                "articleNumber": article_hierarchy["articleNumber"],
                "articleTitle": article_hierarchy.get("articleTitle", ""),
                "clauseNumber": number,
                "parentChunkId": article_chunk["id"],
                **{
                    key: article_hierarchy[key]
                    for key in ("chapterNumber", "chapterTitle")
                    if key in article_hierarchy
                },
            }
            clause_chunk = add(
                new_chunk(identity_token=identity_token, locator=locator, content=line, hierarchy=hierarchy)
            )
            point_chunk = None
            continue

        point_match = POINT.match(line)
        if point_match and clause_chunk is not None and article_chunk is not None:
            point, _ = point_match.groups()
            point = point.lower()
            locator = f"{clause_chunk['locator']}::pt-{point}"
            article_hierarchy = article_chunk["hierarchy"]
            hierarchy = {
                "articleNumber": article_hierarchy["articleNumber"],
                "articleTitle": article_hierarchy.get("articleTitle", ""),
                "clauseNumber": clause_chunk["hierarchy"]["clauseNumber"],
                "pointCode": point,
                "parentChunkId": clause_chunk["id"],
                **{
                    key: article_hierarchy[key]
                    for key in ("chapterNumber", "chapterTitle")
                    if key in article_hierarchy
                },
            }
            point_chunk = add(
                new_chunk(identity_token=identity_token, locator=locator, content=line, hierarchy=hierarchy)
            )
            append_content(clause_chunk, line)
            continue

        if point_chunk is not None:
            append_content(point_chunk, line)
            append_content(clause_chunk, line)
        elif clause_chunk is not None:
            append_content(clause_chunk, line)
        elif article_chunk is not None:
            append_content(article_chunk, line)
        else:
            raise RuntimeError("content appeared before any legal hierarchy anchor")

    if not chunks:
        raise RuntimeError("no reviewed legal hierarchy found")
    return chunks


def new_chunk(
    *, identity_token: str, locator: str, content: str, hierarchy: dict[str, Any]
) -> dict[str, Any]:
    chunk_id = f"{identity_token}:{locator}"
    return {
        "id": chunk_id,
        "chunkRef": f"legal-chunk:{chunk_id}",
        "locator": locator,
        "content": content,
        "contentSha256": _sha256_text(content),
        "hierarchy": hierarchy,
        "legalStatus": "ACTIVE",
        "schemaVersion": LEGAL_CHUNK_SCHEMA_VERSIONS["legal_chunk_v1"],
    }


def append_content(item: dict[str, Any] | None, line: str) -> None:
    if item is None:
        raise RuntimeError("missing parent chunk for continuation line")
    item["content"] += "\n" + line
    item["contentSha256"] = _sha256_text(item["content"])


def _chunk_set_id(
    *, reviewed_input_ref: str, document_identity_ref: str, chunk_schema_version: str
) -> str:
    return sha256(
        f"{reviewed_input_ref}|{document_identity_ref}|{chunk_schema_version}".encode(
            "utf-8"
        )
    ).hexdigest()[:24]


def _identity_token(document_identity_ref: str) -> str:
    token = document_identity_ref.rsplit(":", 1)[-1].strip()
    if not token:
        raise RuntimeError("document identity ref cannot be normalized")
    normalized = re.sub(r"[^A-Za-z0-9]+", "-", token).strip("-").upper()
    if not normalized:
        raise RuntimeError("document identity ref cannot be normalized")
    return normalized[:128]
