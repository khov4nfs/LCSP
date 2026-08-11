#!/usr/bin/env python3
"""Build a fail-closed draft corpus from reviewed legal artefacts.

Raw OCR is intentionally not an input. Every document needs a reviewed text
file and an APPROVED hierarchy-review record before this utility emits a corpus
payload. Reviewed text is bound back to the exact source snapshot recorded by
the review artefact, and locator-level legal effects are materialized only after
both sides of the reviewed relationship agree.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


ARTICLE = re.compile(r"^Điều\s+(\d+)\.(?:\s*(.*))?$", re.I)
CLAUSE = re.compile(r"^(\d+)\.\s*(.+)$")
POINT = re.compile(r"^([a-zđ])\)\s*(.+)$", re.I)
CHAPTER = re.compile(r"^Chương\s+([IVXLC]+)\b\s*(.*)$", re.I)
REPEALED = "REPEALED"
ACTIVE = "ACTIVE"
LAW_134 = "LAW-134-2025-QH15"
LAW_71 = "LAW-71-2025-QH15"
ARTICLE_33_REPEALS = (
    "art-3::cl-9",
    "art-4::cl-7",
    "art-12::cl-6",
    "art-34::cl-2::pt-đ",
    "art-41..art-45",
)
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


def sha256(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()}"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def resolve_snapshot_path(review_path: Path, snapshot_ref: str) -> Path:
    raw = Path(snapshot_ref)
    if raw.is_absolute():
        candidates = [raw]
    else:
        candidates = [review_path.parent / raw]
        candidates.extend(parent / raw for parent in review_path.parents)
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError(
        f"{review_path.name}: reviewed source snapshot does not exist: {snapshot_ref}"
    )


def resolve_review_artifact(
    manifest_path: Path,
    manifest: dict[str, Any],
    *,
    manifest_key: str,
    suffix: str,
    reviewed_dir: Path | None,
) -> Path:
    declared = manifest.get(manifest_key)
    if isinstance(declared, str) and declared.strip():
        return manifest_path.parent / declared
    if reviewed_dir is not None:
        document_id = required(manifest, "documentId")
        return reviewed_dir / f"{document_id}.{suffix}"
    raise RuntimeError(
        f"{manifest_path.name}: missing {manifest_key}; pass --reviewed-dir or declare the reviewed artefact"
    )


def load_reviewed_document(
    manifest_path: Path,
    *,
    reviewed_dir: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    document_id = required(manifest, "documentId")
    reviewed_text_path = resolve_review_artifact(
        manifest_path,
        manifest,
        manifest_key="reviewedTextFile",
        suffix="reviewed.txt",
        reviewed_dir=reviewed_dir,
    )
    review_path = resolve_review_artifact(
        manifest_path,
        manifest,
        manifest_key="hierarchyReviewFile",
        suffix="hierarchy-review.json",
        reviewed_dir=reviewed_dir,
    )
    review = json.loads(review_path.read_text(encoding="utf-8"))

    if review.get("documentId") != document_id or review.get("reviewState") != "APPROVED":
        raise RuntimeError(f"{document_id}: legal hierarchy review is not APPROVED")

    text = reviewed_text_path.read_text(encoding="utf-8")
    if review.get("reviewedTextSha256") != sha256(text):
        raise RuntimeError(f"{document_id}: reviewed text hash does not match review")

    reviewed_source_sha = required(review, "reviewedSourceSha256")
    source_review = review.get("sourceReview")
    if not isinstance(source_review, dict):
        raise RuntimeError(f"{document_id}: hierarchy review is missing sourceReview")
    snapshot_ref = required(source_review, "sourceSnapshotReviewed")
    snapshot_path = resolve_snapshot_path(review_path, snapshot_ref)
    if file_sha256(snapshot_path) != reviewed_source_sha:
        raise RuntimeError(
            f"{document_id}: reports source snapshot hash does not match reviewedSourceSha256"
        )

    return manifest, review, parse_chunks(document_id, text, review)


def chapter_index(
    review: dict[str, Any],
) -> tuple[dict[str, dict[str, str]], dict[int, dict[str, str]]]:
    by_number: dict[str, dict[str, str]] = {}
    by_article: dict[int, dict[str, str]] = {}
    for item in review.get("chapters", []):
        chapter_number = str(item.get("chapter", "")).upper()
        title = str(item.get("title", ""))
        articles = item.get("articles") or {}
        start = articles.get("from")
        end = articles.get("to")
        if not chapter_number or not isinstance(start, int) or not isinstance(end, int):
            continue
        metadata = {"chapterNumber": chapter_number, "chapterTitle": title}
        by_number[chapter_number] = metadata
        for article_number in range(start, end + 1):
            by_article[article_number] = metadata
    return by_number, by_article


def is_review_control_line(line: str) -> bool:
    return (
        line == "NOTE"
        or line == "END OF REVIEWED LCSP SCOPE"
        or (line.startswith("[") and line.endswith("]"))
    )


def append_content(item: dict[str, Any] | None, line: str) -> None:
    if item is None:
        return
    item["content"] += "\n" + line
    item["contentSha256"] = sha256(item["content"])


def parse_chunks(
    document_id: str,
    text: str,
    review: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    locators: set[str] = set()

    review_by_number, review_by_article = chapter_index(review or {})
    chapter: dict[str, str] | None = None
    awaiting_chapter_title = False
    article_chunk: dict[str, Any] | None = None
    clause_chunk: dict[str, Any] | None = None
    point_chunk: dict[str, Any] | None = None

    def add(item: dict[str, Any]) -> dict[str, Any]:
        locator = item["locator"]
        if locator in locators:
            raise RuntimeError(f"{document_id}: duplicate legal locator {locator}")
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
            number = number.upper()
            reviewed_chapter = review_by_number.get(number, {})
            chapter = {
                "chapterNumber": number,
                "chapterTitle": inline_title.strip()
                or reviewed_chapter.get("chapterTitle", ""),
            }
            awaiting_chapter_title = not bool(inline_title.strip())
            article_chunk = clause_chunk = point_chunk = None
            continue

        article_match = ARTICLE.match(line)
        if article_match:
            awaiting_chapter_title = False
            number, title = article_match.groups()
            article_number = int(number)
            resolved_chapter = chapter or review_by_article.get(article_number)
            hierarchy = {
                "articleNumber": number,
                "articleTitle": (title or "").strip(),
                **(resolved_chapter or {}),
            }
            locator = f"art-{number}"
            article_chunk = add(
                new_chunk(f"{document_id}::{locator}", locator, line, hierarchy)
            )
            clause_chunk = point_chunk = None
            continue

        if awaiting_chapter_title and article_chunk is None:
            if not is_review_control_line(line):
                if chapter is not None:
                    chapter["chapterTitle"] = line
                awaiting_chapter_title = False
            continue

        clause_match = CLAUSE.match(line)
        if clause_match and article_chunk is not None:
            number, _ = clause_match.groups()
            article_locator = article_chunk["locator"]
            locator = f"{article_locator}::cl-{number}"
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
                new_chunk(f"{document_id}::{locator}", locator, line, hierarchy)
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
                new_chunk(f"{document_id}::{locator}", locator, line, hierarchy)
            )
            # Clause is the base retrieval unit, so it retains its point descendants.
            append_content(clause_chunk, line)
            continue

        if is_review_control_line(line):
            continue

        # Continuation text belongs to the deepest active legal unit. Point text is
        # also retained in its parent Clause so retrieval never loses legal context.
        if point_chunk is not None:
            append_content(point_chunk, line)
            append_content(clause_chunk, line)
        elif clause_chunk is not None:
            append_content(clause_chunk, line)
        elif article_chunk is not None:
            append_content(article_chunk, line)

    if not chunks:
        raise RuntimeError(f"{document_id}: no reviewed legal hierarchy found")
    return chunks


def full_text_review_locators(document_id: str, review: dict[str, Any]) -> tuple[str, ...]:
    scope = review.get("reviewScope")
    if not isinstance(scope, dict):
        raise RuntimeError(f"{document_id}: hierarchy review is missing reviewScope")
    raw_locators = scope.get("fullTextReviewedLocators")
    if not isinstance(raw_locators, list) or not raw_locators:
        raise RuntimeError(
            f"{document_id}: reviewScope.fullTextReviewedLocators is required"
        )
    locators = tuple(
        str(locator).strip()
        for locator in raw_locators
        if isinstance(locator, str) and locator.strip()
    )
    if len(locators) != len(raw_locators) or len(set(locators)) != len(locators):
        raise RuntimeError(
            f"{document_id}: reviewScope.fullTextReviewedLocators is invalid"
        )
    return locators


def locator_overlaps_review_scope(locator: str, reviewed_locator: str) -> bool:
    return (
        locator == reviewed_locator
        or locator.startswith(f"{reviewed_locator}::")
        or reviewed_locator.startswith(f"{locator}::")
    )


def filter_chunks_to_review_scope(
    document_id: str,
    chunks: list[dict[str, Any]],
    review: dict[str, Any],
) -> list[dict[str, Any]]:
    reviewed_locators = full_text_review_locators(document_id, review)
    available = {str(chunk["locator"]): chunk for chunk in chunks}
    unresolved = [locator for locator in reviewed_locators if locator not in available]
    if unresolved:
        raise RuntimeError(
            f"{document_id}: reviewed full-text locators cannot be resolved: {unresolved}"
        )

    filtered = [
        chunk
        for chunk in chunks
        if any(
            locator_overlaps_review_scope(str(chunk["locator"]), reviewed_locator)
            for reviewed_locator in reviewed_locators
        )
    ]
    if not filtered:
        raise RuntimeError(f"{document_id}: reviewed scope produced no publishable chunks")
    return filtered


def new_chunk(
    chunk_id: str,
    locator: str,
    content: str,
    hierarchy: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": chunk_id,
        "locator": locator,
        "content": content,
        "contentSha256": sha256(content),
        "hierarchy": hierarchy,
        "legalStatus": ACTIVE,
    }


def validate_article_33_review_mapping(reviews: dict[str, dict[str, Any]]) -> None:
    law_134_review = reviews.get(LAW_134)
    law_71_review = reviews.get(LAW_71)
    if not law_134_review or not law_71_review:
        return

    law_134_assertions = law_134_review.get("legalEffectAssertions")
    matching_assertion = None
    if isinstance(law_134_assertions, list):
        matching_assertion = next(
            (
                item
                for item in law_134_assertions
                if isinstance(item, dict)
                and item.get("amendingLocator") == "art-33"
                and item.get("targetDocumentId") == LAW_71
            ),
            None,
        )
    law_71_repeal_review = law_71_review.get("repealReview")
    expected = list(ARTICLE_33_REPEALS)
    if (
        not isinstance(matching_assertion, dict)
        or matching_assertion.get("repealedLocators") != expected
        or not isinstance(law_71_repeal_review, dict)
        or law_71_repeal_review.get("amendingDocumentId") != LAW_134
        or law_71_repeal_review.get("amendingLocator") != "art-33"
        or law_71_repeal_review.get("repealedLocators") != expected
    ):
        raise RuntimeError(
            "Law 134 Article 33 repeal mapping is not mutually confirmed by both reviews"
        )

    range_expansion = law_71_repeal_review.get("rangeExpansion")
    if not isinstance(range_expansion, dict):
        raise RuntimeError("Law 71 review is missing Article 33 range expansion")
    if range_expansion.get("art-41..art-45") != [
        "art-41",
        "art-42",
        "art-43",
        "art-44",
        "art-45",
    ] or range_expansion.get("includeDescendants") is not True:
        raise RuntimeError("Law 71 Article 41-45 repeal range expansion is invalid")


def apply_law_134_article_33(
    documents: list[dict[str, Any]],
    *,
    reviews: dict[str, dict[str, Any]],
    parsed_chunks: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    law_71 = next((item for item in documents if item["documentId"] == LAW_71), None)
    law_134 = next((item for item in documents if item["documentId"] == LAW_134), None)
    if not law_71 or not law_134:
        return None

    validate_article_33_review_mapping(reviews)

    amending_chunks = {chunk["locator"]: chunk for chunk in law_134["chunks"]}
    article_33 = amending_chunks.get("art-33")
    if (
        article_33 is None
        or "Bãi bỏ khoản 9 Điều 3" not in article_33["content"]
        or "Chương IV" not in article_33["content"]
    ):
        raise RuntimeError("Law 134 Article 33 reviewed content is incomplete")

    parsed_law_71 = {
        chunk["locator"]: chunk for chunk in parsed_chunks.get(LAW_71, [])
    }
    if "art-40" not in parsed_law_71 or "art-46" not in parsed_law_71:
        raise RuntimeError("Law 71 repeal boundary locators art-40/art-46 are missing")

    available = {chunk["locator"]: chunk for chunk in law_71["chunks"]}
    direct_targets = ARTICLE_33_REPEALS[:-1]
    if any(locator not in available for locator in direct_targets):
        raise RuntimeError("Law 134 Article 33 repeal targets cannot be resolved")

    chapter_range_locators = {
        locator
        for locator in available
        if re.match(r"^art-(41|42|43|44|45)(::|$)", locator)
    }
    for article_number in range(41, 46):
        if f"art-{article_number}" not in chapter_range_locators:
            raise RuntimeError(
                f"Law 134 Article 33 repeal range is missing art-{article_number}"
            )

    required_locators = set(direct_targets) | chapter_range_locators
    ref = {"documentId": LAW_134, "locator": "art-33"}
    for locator in required_locators:
        chunk = available[locator]
        chunk["legalStatus"] = REPEALED
        chunk["hierarchy"]["repealedByRef"] = ref

    return {
        "type": "LOCATOR_REPEAL",
        "amendingDocumentId": LAW_134,
        "amendingLocator": "art-33",
        "targetDocumentId": LAW_71,
        "declaredLocators": list(ARTICLE_33_REPEALS),
        "materializedChunkIds": sorted(available[locator]["id"] for locator in required_locators),
        "boundaryAssertions": {
            "art-40": "ACTIVE_OUTSIDE_REPEAL_RANGE",
            "art-46": "ACTIVE_OUTSIDE_REPEAL_RANGE",
        },
    }


def normalize_source_effect_status(document_id: str, value: str) -> str:
    normalized = SOURCE_EFFECT_STATUS.get(value.strip())
    if not normalized:
        raise RuntimeError(
            f"{document_id}: unsupported source effect status {value!r}"
        )
    return normalized


def build_payload(
    manifest_paths: list[Path],
    version: str,
    *,
    reviewed_dir: Path | None = None,
) -> dict[str, Any]:
    documents: list[dict[str, Any]] = []
    reviews: dict[str, dict[str, Any]] = {}
    parsed_chunks: dict[str, list[dict[str, Any]]] = {}
    source_artifacts: list[dict[str, Any]] = []

    for path in manifest_paths:
        manifest, review, all_chunks = load_reviewed_document(
            path,
            reviewed_dir=reviewed_dir,
        )
        document_id = required(manifest, "documentId")
        if document_id in reviews:
            raise RuntimeError(f"duplicate reviewed document {document_id}")
        reviews[document_id] = review
        parsed_chunks[document_id] = all_chunks
        chunks = filter_chunks_to_review_scope(document_id, all_chunks, review)
        source_review = review["sourceReview"]
        canonical_source_url = source_review.get("canonicalSourceUrl")
        source_url = (
            canonical_source_url.strip()
            if isinstance(canonical_source_url, str) and canonical_source_url.strip()
            else required(manifest, "sourceUrl")
        )
        source_effect_status = normalize_source_effect_status(
            document_id,
            required(manifest, "sourceEffectStatus"),
        )
        reviewed_source_sha = required(review, "reviewedSourceSha256")
        effective_date = manifest.get("effectiveFrom") or manifest.get("effectiveDate")

        documents.append(
            {
                "documentId": document_id,
                "title": required(manifest, "title"),
                "sourceUrl": source_url,
                "sourceSha256": reviewed_source_sha,
                "sourceEffectStatus": source_effect_status,
                "effectiveDate": effective_date,
                "snapshotPath": required(source_review, "sourceSnapshotReviewed"),
                "chunks": chunks,
            }
        )
        source_artifacts.append(
            {
                "documentId": document_id,
                "sourceManifest": str(path),
                "sourceManifestSha256": file_sha256(path),
                "reviewedSourceSha256": reviewed_source_sha,
                "reviewedTextSha256": required(review, "reviewedTextSha256"),
                "publishedChunkCount": len(chunks),
                "parsedChunkCount": len(all_chunks),
            }
        )

    relationship = apply_law_134_article_33(
        documents,
        reviews=reviews,
        parsed_chunks=parsed_chunks,
    )
    source_manifest: dict[str, Any] = {
        "reviewRequired": True,
        "normalizationWarnings": [],
        "reviewedArtifacts": [str(path) for path in manifest_paths],
        "sourceArtifacts": source_artifacts,
    }
    if relationship is not None:
        source_manifest["materializedRelationships"] = [relationship]

    return {
        "version": version,
        "sourceManifest": source_manifest,
        "documents": documents,
    }


def required(values: dict[str, Any], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"manifest is missing {key}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-manifest", action="append", required=True, type=Path)
    parser.add_argument(
        "--reviewed-dir",
        type=Path,
        help="Directory containing <document-id>.reviewed.txt and .hierarchy-review.json when source manifests do not declare them",
    )
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    payload = build_payload(
        args.source_manifest,
        args.version,
        reviewed_dir=args.reviewed_dir,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
