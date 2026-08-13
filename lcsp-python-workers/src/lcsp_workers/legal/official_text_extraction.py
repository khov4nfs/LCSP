from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Any, Protocol
from xml.etree import ElementTree

WORDPROCESSINGML_NAMESPACE = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

OFFICIAL_TEXT_EXTRACTION_TOOL = {
    "name": "extract_official_text",
    "version": "1.0.0",
    "config_hash": "sha256:official-text-extraction-v1",
}

EXTRACTION_PROFILES = {
    "html_official_v1": "HTML_OFFICIAL_V1",
    "docx_official_v1": "DOCX_OFFICIAL_V1",
}

AGENTIC_TOOL_STATUSES = {
    "ready": "READY",
    "needs_input": "NEEDS_INPUT",
    "blocked": "BLOCKED",
    "failed": "FAILED",
}

AGENTIC_TOOL_COVERAGE_STATES = {
    "sufficient": "SUFFICIENT",
    "partial": "PARTIAL",
    "unavailable": "UNAVAILABLE",
}

OFFICIAL_TEXT_EXTRACTION_LIMITATION_CODES = {
    "malformed_snapshot": "MALFORMED_SNAPSHOT",
    "unsupported_profile": "UNSUPPORTED_PROFILE",
    "identity_missing": "IDENTITY_MISSING",
    "extraction_unavailable": "EXTRACTION_UNAVAILABLE",
}

SUPPORTED_CONTENT_TYPES = {
    EXTRACTION_PROFILES["html_official_v1"]: {"text/html"},
    EXTRACTION_PROFILES["docx_official_v1"]: {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
}

SOURCE_EFFECT_STATUS = {
    "Còn hiệu lực": "CON_HIEU_LUC",
    "Hết hiệu lực một phần": "HET_HIEU_LUC_MOT_PHAN",
    "Chưa có hiệu lực": "CHUA_CO_HIEU_LUC",
    "Ngưng hiệu lực": "NGUNG_HIEU_LUC",
    "Hết hiệu lực toàn bộ": "HET_HIEU_LUC_TOAN_BO",
    "Không còn phù hợp": "KHONG_CON_PHU_HOP",
    "CON_HIEU_LUC": "CON_HIEU_LUC",
    "HET_HIEU_LUC_MOT_PHAN": "HET_HIEU_LUC_MOT_PHAN",
    "CHUA_CO_HIEU_LUC": "CHUA_CO_HIEU_LUC",
    "NGUNG_HIEU_LUC": "NGUNG_HIEU_LUC",
    "HET_HIEU_LUC_TOAN_BO": "HET_HIEU_LUC_TOAN_BO",
    "KHONG_CON_PHU_HOP": "KHONG_CON_PHU_HOP",
}


@dataclass(frozen=True)
class OfficialTextExtractionRequest:
    snapshot_ref: str
    extractor_profile: str
    max_pages: int
    source_manifest_path: Path
    output_dir: Path


class SnapshotRegistryClient(Protocol):
    def get_official_source_snapshot(
        self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
    ) -> dict: ...


@dataclass(frozen=True)
class ResolvedOfficialSnapshot:
    snapshot_ref: str
    document_id: str
    source_manifest_path: Path
    artifact_path: Path
    content_sha256: str
    content_type: str


@dataclass(frozen=True)
class OfficialTextExtractionSpan:
    span_ref: str
    page_number: int
    sequence: int
    locator: str
    content_sha256: str
    text: str

    def to_json(self) -> dict[str, Any]:
        return {
            "spanRef": self.span_ref,
            "pageNumber": self.page_number,
            "sequence": self.sequence,
            "locator": self.locator,
            "contentSha256": self.content_sha256,
            "text": self.text,
        }


@dataclass(frozen=True)
class OfficialTextExtractionResult:
    status: str
    extraction_ref: str
    extraction_id: str
    snapshot_ref: str
    document_id: str
    format: str
    page_count: int
    span_count: int
    identity_candidate: dict[str, str | None]
    span_manifest_sha256: str
    canonical_extraction_available: bool
    span_manifest_path: Path
    spans_path: Path
    evidence_refs: list[str]
    provenance_ref: str
    coverage_state: str
    limitations: list[dict[str, Any]]

    def to_tool_response(self, *, correlationId: str) -> dict[str, Any]:
        return {
            "status": self.status,
            "toolName": OFFICIAL_TEXT_EXTRACTION_TOOL["name"],
            "toolVersion": OFFICIAL_TEXT_EXTRACTION_TOOL["version"],
            "configHash": OFFICIAL_TEXT_EXTRACTION_TOOL["config_hash"],
            "correlationId": correlationId,
            "artifactVersions": {
                "snapshotId": self.snapshot_ref.removeprefix("snapshot:"),
                "extractionId": self.extraction_id,
            },
            "provenanceRef": self.provenance_ref,
            "coverageState": self.coverage_state,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "result": {
                "extractionRef": self.extraction_ref,
                "format": self.format,
                "pageCount": self.page_count,
                "spanCount": self.span_count,
                "identityCandidate": self.identity_candidate,
                "spanManifestSha256": self.span_manifest_sha256,
                "canonicalExtractionAvailable": self.canonical_extraction_available,
            },
        }

    @classmethod
    def blocked_unavailable(
        cls,
        *,
        snapshot_ref: str,
        document_id: str,
        extraction_id: str,
        extraction_ref: str,
        extraction_format: str,
        span_manifest_path: Path,
        spans_path: Path,
        reason: str,
    ) -> "OfficialTextExtractionResult":
        return cls(
            status=AGENTIC_TOOL_STATUSES["blocked"],
            extraction_ref=extraction_ref,
            extraction_id=extraction_id,
            snapshot_ref=snapshot_ref,
            document_id=document_id,
            format=extraction_format,
            page_count=0,
            span_count=0,
            identity_candidate={
                "documentNumber": None,
                "sourceEffectStatus": None,
                "effectiveFrom": None,
            },
            span_manifest_sha256=_sha256_text("[]"),
            canonical_extraction_available=False,
            span_manifest_path=span_manifest_path,
            spans_path=spans_path,
            evidence_refs=[],
            provenance_ref=f"prov:extract:{extraction_id}",
            coverage_state=AGENTIC_TOOL_COVERAGE_STATES["unavailable"],
            limitations=[
                {
                    "code": OFFICIAL_TEXT_EXTRACTION_LIMITATION_CODES[
                        "extraction_unavailable"
                    ],
                    "affectedScopeRef": snapshot_ref,
                    "reason": reason,
                    "retryable": False,
                }
            ],
        )


class _HtmlBlockParser(HTMLParser):
    _BLOCK_ELEMENTS = {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self) -> None:
        super().__init__()
        self._current_tag: str | None = None
        self._parts: list[str] = []
        self.blocks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in self._BLOCK_ELEMENTS:
            self._flush()
            self._current_tag = tag.lower()
            self._parts = []

    def handle_endtag(self, tag: str) -> None:
        if self._current_tag == tag.lower():
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._current_tag:
            self._parts.append(data)

    def _flush(self) -> None:
        if not self._current_tag:
            return
        text = " ".join("".join(self._parts).split())
        if text:
            self.blocks.append(text)
        self._current_tag = None
        self._parts = []


class OfficialTextExtractor:
    def extract(
        self, request: OfficialTextExtractionRequest
    ) -> OfficialTextExtractionResult:
        if request.max_pages < 1:
            raise ValueError("max_pages must be positive")

        manifest = json.loads(request.source_manifest_path.read_text(encoding="utf-8"))
        document_id = _required_string(manifest, "documentId")
        profile = _normalize_profile(request.extractor_profile)

        if profile == EXTRACTION_PROFILES["html_official_v1"]:
            source_path = request.source_manifest_path.parent / _required_string(
                manifest, "htmlFile"
            )
            source_texts = _extract_html_blocks(source_path.read_text(encoding="utf-8"))
            extraction_format = "HTML"
        elif profile == EXTRACTION_PROFILES["docx_official_v1"]:
            source_path = request.source_manifest_path.parent / _required_string(
                manifest, "sourceFile"
            )
            source_texts = _extract_docx_paragraphs(source_path.read_bytes())
            extraction_format = "DOCX"
        else:
            raise ValueError("unsupported extractor profile")

        extraction_id = _extraction_id(
            document_id=document_id,
            snapshot_ref=request.snapshot_ref,
            extractor_profile=profile,
        )
        extraction_ref = f"extraction:{extraction_id}"
        request.output_dir.mkdir(parents=True, exist_ok=True)
        spans_path = request.output_dir / f"{document_id}.extraction.spans.json"
        span_manifest_path = request.output_dir / f"{document_id}.extraction.manifest.json"

        if not source_texts:
            spans_path.write_text("[]\n", encoding="utf-8")
            span_manifest_path.write_text(
                json.dumps(
                    {
                        "extractionRef": extraction_ref,
                        "snapshotRef": request.snapshot_ref,
                        "documentId": document_id,
                        "extractorProfile": profile,
                        "format": extraction_format,
                        "pageCount": 0,
                        "spanCount": 0,
                        "spanManifestSha256": _sha256_text("[]"),
                        "spansFile": spans_path.name,
                        "identityCandidate": {
                            "documentNumber": None,
                            "sourceEffectStatus": None,
                            "effectiveFrom": None,
                        },
                        "canonicalExtractionAvailable": False,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            return OfficialTextExtractionResult.blocked_unavailable(
                snapshot_ref=request.snapshot_ref,
                document_id=document_id,
                extraction_id=extraction_id,
                extraction_ref=extraction_ref,
                extraction_format=extraction_format,
                span_manifest_path=span_manifest_path,
                spans_path=spans_path,
                reason="official snapshot contains no extractable canonical text; OCR fallback may be required",
            )

        page_count = 1
        if page_count > request.max_pages:
            raise RuntimeError("official snapshot exceeds the page limit")

        spans = _build_spans(
            extraction_id=extraction_id,
            document_id=document_id,
            blocks=source_texts,
        )
        spans_payload = [span.to_json() for span in spans]
        spans_json = json.dumps(spans_payload, ensure_ascii=False, indent=2) + "\n"
        spans_path.write_text(spans_json, encoding="utf-8")
        span_manifest_sha = _sha256_bytes(spans_json.encode("utf-8"))
        evidence_refs = [span.span_ref for span in spans[:10]]
        identity_candidate = {
            "documentNumber": _optional_string(manifest.get("documentNumber")),
            "sourceEffectStatus": SOURCE_EFFECT_STATUS.get(
                _optional_string(manifest.get("sourceEffectStatus")) or "",
                _optional_string(manifest.get("sourceEffectStatus")),
            ),
            "effectiveFrom": _optional_string(
                manifest.get("effectiveFrom") or manifest.get("effectiveDate")
            ),
        }
        missing_identity_fields = [
            field_name
            for field_name in ("documentNumber", "sourceEffectStatus")
            if not identity_candidate.get(field_name)
        ]
        if missing_identity_fields:
            status = AGENTIC_TOOL_STATUSES["needs_input"]
            coverage_state = AGENTIC_TOOL_COVERAGE_STATES["partial"]
            limitations = [
                {
                    "code": OFFICIAL_TEXT_EXTRACTION_LIMITATION_CODES["identity_missing"],
                    "affectedScopeRef": request.snapshot_ref,
                    "reason": "official snapshot is missing required identity fields: "
                    + ", ".join(missing_identity_fields),
                    "retryable": False,
                }
            ]
        else:
            status = AGENTIC_TOOL_STATUSES["ready"]
            coverage_state = AGENTIC_TOOL_COVERAGE_STATES["sufficient"]
            limitations = []
        span_manifest = {
            "extractionRef": extraction_ref,
            "snapshotRef": request.snapshot_ref,
            "documentId": document_id,
            "extractorProfile": profile,
            "format": extraction_format,
            "pageCount": page_count,
            "spanCount": len(spans),
            "spanManifestSha256": span_manifest_sha,
            "spansFile": spans_path.name,
            "identityCandidate": identity_candidate,
            "canonicalExtractionAvailable": True,
        }
        span_manifest_path.write_text(
            json.dumps(span_manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        return OfficialTextExtractionResult(
            status=status,
            extraction_ref=extraction_ref,
            extraction_id=extraction_id,
            snapshot_ref=request.snapshot_ref,
            document_id=document_id,
            format=extraction_format,
            page_count=page_count,
            span_count=len(spans),
            identity_candidate=identity_candidate,
            span_manifest_sha256=span_manifest_sha,
            canonical_extraction_available=True,
            span_manifest_path=span_manifest_path,
            spans_path=spans_path,
            evidence_refs=evidence_refs,
            provenance_ref=f"prov:extract:{extraction_id}",
            coverage_state=coverage_state,
            limitations=limitations,
        )

    def extract_from_resolved_snapshot(
        self,
        *,
        resolved_snapshot: ResolvedOfficialSnapshot,
        extractor_profile: str,
        max_pages: int,
        output_dir: Path,
    ) -> OfficialTextExtractionResult:
        self._validate_resolved_snapshot(
            resolved_snapshot=resolved_snapshot,
            extractor_profile=extractor_profile,
        )
        return self.extract(
            OfficialTextExtractionRequest(
                snapshot_ref=resolved_snapshot.snapshot_ref,
                extractor_profile=extractor_profile,
                max_pages=max_pages,
                source_manifest_path=resolved_snapshot.source_manifest_path,
                output_dir=output_dir,
            )
        )

    def _validate_resolved_snapshot(
        self,
        *,
        resolved_snapshot: ResolvedOfficialSnapshot,
        extractor_profile: str,
    ) -> None:
        profile = _normalize_profile(extractor_profile)
        supported_types = SUPPORTED_CONTENT_TYPES.get(profile, set())
        if resolved_snapshot.content_type not in supported_types:
            raise ValueError(
                "resolved snapshot content type does not match extractor profile"
            )


class OfficialSourceSnapshotResolver:
    def __init__(self, *, api_client: SnapshotRegistryClient, storage_root: Path) -> None:
        self._api_client = api_client
        self._storage_root = storage_root

    def resolve(self, *, snapshot_ref: str) -> ResolvedOfficialSnapshot:
        record = self._api_client.get_official_source_snapshot(snapshot_ref=snapshot_ref)
        if not isinstance(record, dict):
            raise RuntimeError("official source snapshot record is invalid")
        object_key = _required_string(record, "snapshotObjectKey")
        artifact_path = (self._storage_root / object_key).resolve()
        if not artifact_path.is_file():
            raise RuntimeError("official snapshot artifact is unavailable in storage")
        expected_sha = _required_string(record, "contentSha256")
        if _sha256_bytes(artifact_path.read_bytes()) != expected_sha:
            raise RuntimeError("official snapshot artifact hash does not match registry")
        manifest_path = artifact_path.with_name(
            _derive_manifest_file_name(artifact_path.name)
        )
        if not manifest_path.is_file():
            raise RuntimeError("official snapshot manifest is unavailable in storage")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        document_id = _required_string(record, "documentId")
        if _required_string(manifest, "documentId") != document_id:
            raise RuntimeError("official snapshot manifest document does not match registry")
        return ResolvedOfficialSnapshot(
            snapshot_ref=_required_string(record, "snapshotRef"),
            document_id=document_id,
            source_manifest_path=manifest_path,
            artifact_path=artifact_path,
            content_sha256=expected_sha,
            content_type=_required_string(record, "contentType"),
        )


def _normalize_profile(value: str) -> str:
    normalized = value.strip().upper()
    if normalized in EXTRACTION_PROFILES.values():
        return normalized
    raise ValueError("unsupported extractor profile")


def _extract_html_blocks(html: str) -> list[str]:
    parser = _HtmlBlockParser()
    parser.feed(html)
    return parser.blocks


def _extract_docx_paragraphs(docx_bytes: bytes) -> list[str]:
    with zipfile.ZipFile(BytesIO(docx_bytes)) as archive:
        document = archive.read("word/document.xml")
    root = ElementTree.fromstring(document)
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{WORDPROCESSINGML_NAMESPACE}p"):
        text = "".join(
            node.text or "" for node in paragraph.iter(f"{WORDPROCESSINGML_NAMESPACE}t")
        )
        normalized = " ".join(text.split())
        if normalized:
            paragraphs.append(normalized)
    return paragraphs


def _build_spans(
    *, extraction_id: str, document_id: str, blocks: list[str]
) -> list[OfficialTextExtractionSpan]:
    spans: list[OfficialTextExtractionSpan] = []
    for sequence, text in enumerate(blocks, start=1):
        locator = f"{document_id}::p1:s{sequence:02d}"
        span_ref = f"span:{extraction_id}:p1:s{sequence:02d}"
        spans.append(
            OfficialTextExtractionSpan(
                span_ref=span_ref,
                page_number=1,
                sequence=sequence,
                locator=locator,
                content_sha256=_sha256_text(text),
                text=text,
            )
        )
    return spans


def _extraction_id(
    *, document_id: str, snapshot_ref: str, extractor_profile: str
) -> str:
    suffix = _sha256_text(f"{snapshot_ref}:{extractor_profile}")[:19].removeprefix("sha256:")
    safe_document_id = re.sub(r"[^A-Za-z0-9_-]+", "-", document_id).strip("-")
    return f"{safe_document_id}:{suffix}"


def _derive_manifest_file_name(artifact_name: str) -> str:
    if ".source." not in artifact_name:
        raise RuntimeError("official snapshot artifact name is unsupported")
    prefix, _, _ = artifact_name.partition(".source.")
    return f"{prefix}.source.json"


def _required_string(values: dict[str, Any], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"source manifest is missing {key}")
    return value.strip()


def _optional_string(value: Any) -> str | None:
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    return None


def _sha256_text(value: str) -> str:
    return _sha256_bytes(value.encode("utf-8"))


def _sha256_bytes(value: bytes) -> str:
    return f"sha256:{sha256(value).hexdigest()}"
