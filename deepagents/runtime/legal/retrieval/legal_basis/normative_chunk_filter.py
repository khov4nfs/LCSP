"""Deterministic legal-corpus gates before retrieval/index and EngineeringRule compile."""
from __future__ import annotations

import re
from typing import Any


CHUNK_NORMATIVE_CLASSES = {
    "engineering_rule_candidate": "ENGINEERING_RULE_CANDIDATE",
    "context_only": "CONTEXT_ONLY",
    "exclude_from_database": "EXCLUDE_FROM_DATABASE",
}

_ARTICLE_HEADING = re.compile(r"^\s*Điều\s+\d+\.\s*.+\s*$", re.I)
_CHAPTER_HEADING = re.compile(r"^\s*Chương\s+[IVXLC0-9]+\b.*$", re.I)
_LAW_PREAMBLE = re.compile(
    r"(quốc hội|cộng hòa xã hội chủ nghĩa việt nam|độc lập\s*-\s*tự do|"
    r"luật số|căn cứ hiến pháp|quốc hội ban hành|chủ tịch quốc hội)",
    re.I,
)
_CONTEXT_ONLY_ARTICLE_TITLES = (
    "phạm vi điều chỉnh",
    "đối tượng áp dụng",
    "giải thích từ ngữ",
    "nguyên tắc cơ bản",
    "chính sách của nhà nước",
)
_ENGINEERING_OBLIGATION_TERMS = (
    "phải",
    "không được",
    "bị nghiêm cấm",
    "nghiêm cấm",
    "có trách nhiệm",
    "nghĩa vụ",
    "bảo đảm",
    "duy trì",
    "thiết lập",
    "kiểm tra",
    "giám sát",
    "đánh giá",
    "quản lý rủi ro",
    "thông báo",
    "công bố",
    "báo cáo",
    "lưu trữ",
    "ghi nhận",
    "kiểm soát",
    "can thiệp",
    "tuân thủ",
)


def legal_chunk_normative_class(chunk: dict[str, Any]) -> str:
    """Classify whether a legal chunk may enter DB and EngineeringRule compilation.

    The legal corpus should not persist formal headers/preamble as retrievable law.
    Scope, definitions, principles, and state policy articles can be useful legal
    context, but they are not direct EngineeringRule sources unless a curated
    template explicitly uses a narrower operative clause elsewhere.
    """
    raw_content = str(chunk.get("content") or "")
    content = _normalize(raw_content)
    if not content:
        return CHUNK_NORMATIVE_CLASSES["exclude_from_database"]

    if _heading_only(raw_content) or _preamble_only(raw_content):
        return CHUNK_NORMATIVE_CLASSES["exclude_from_database"]

    hierarchy = chunk.get("hierarchy") if isinstance(chunk.get("hierarchy"), dict) else {}
    article_title = _normalize(str(hierarchy.get("articleTitle") or ""))
    locator = str(chunk.get("locator") or "")
    is_article_level = bool(locator) and "::" not in locator
    if is_article_level and _context_article_title(article_title):
        return CHUNK_NORMATIVE_CLASSES["context_only"]
    if _context_article_title(article_title):
        return CHUNK_NORMATIVE_CLASSES["context_only"]

    if _contains_engineering_obligation(content):
        return CHUNK_NORMATIVE_CLASSES["engineering_rule_candidate"]
    return CHUNK_NORMATIVE_CLASSES["context_only"]


def is_legal_database_chunk(chunk: dict[str, Any]) -> bool:
    """Return whether the chunk should be persisted/indexed as legal text."""
    return (
        legal_chunk_normative_class(chunk)
        != CHUNK_NORMATIVE_CLASSES["exclude_from_database"]
    )


def is_engineering_rule_source_chunk(chunk: dict[str, Any]) -> bool:
    """Return whether the chunk can directly source an EngineeringRule contract."""
    return (
        legal_chunk_normative_class(chunk)
        == CHUNK_NORMATIVE_CLASSES["engineering_rule_candidate"]
    )


def _heading_only(content: str) -> bool:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    return len(lines) == 1 and bool(
        _ARTICLE_HEADING.fullmatch(lines[0]) or _CHAPTER_HEADING.fullmatch(lines[0])
    )


def _preamble_only(content: str) -> bool:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if not lines:
        return True
    if any(line.lower().startswith("điều ") for line in lines):
        return False
    return bool(_LAW_PREAMBLE.search(" ".join(lines)))


def _context_article_title(title: str) -> bool:
    return any(value in title for value in _CONTEXT_ONLY_ARTICLE_TITLES)


def _contains_engineering_obligation(content: str) -> bool:
    return any(term in content for term in _ENGINEERING_OBLIGATION_TERMS)


def _normalize(value: str) -> str:
    return " ".join(value.casefold().split())
