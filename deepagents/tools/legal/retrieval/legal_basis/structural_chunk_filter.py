"""Structural (non-semantic) legal-corpus chunk gate.

Formal headings and law preambles are not retrievable law. This only inspects chunk shape;
it never decides whether a provision imposes a duty or is relevant to engineering - that
interpretation belongs to the Legal Preparation agent.
"""
from __future__ import annotations

import re
from typing import Any


_ARTICLE_HEADING = re.compile(r"^\s*Điều\s+\d+\.\s*.+\s*$", re.I)
_CHAPTER_HEADING = re.compile(r"^\s*Chương\s+[IVXLC0-9]+\b.*$", re.I)
_LAW_PREAMBLE = re.compile(
    r"(quốc hội|cộng hòa xã hội chủ nghĩa việt nam|độc lập\s*-\s*tự do|"
    r"luật số|căn cứ hiến pháp|quốc hội ban hành|chủ tịch quốc hội)",
    re.I,
)


def is_legal_database_chunk(chunk: dict[str, Any]) -> bool:
    """Return whether the chunk should be persisted/indexed as legal text."""
    raw_content = str(chunk.get("content") or "")
    if not raw_content.strip():
        return False
    return not (_heading_only(raw_content) or _preamble_only(raw_content))


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
