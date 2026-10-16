"""Split extracted text into addressable chunks using a configured structure profile.

The heading vocabulary of every profile lives in ``config/legal_structure_profiles.json``; this
module only applies the patterns it is given. Legacy locators remain retrieval/provenance addresses.
Canonical legal hierarchy and semantic accounting use the derived document AST and Agent claim graph.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Any

PROFILE_AUTO = "AUTO"
PROFILE_PARAGRAPHS = "PARAGRAPHS"
CONFIG_PATH = Path(__file__).resolve().parents[3] / "config" / "legal_structure_profiles.json"
LOCATOR_SEPARATOR = "::"
MAX_CHUNKS = 20000  # the API contract refuses more
_SPACES = re.compile(r"[ \t]+")


class UnknownStructureProfile(ValueError):
    pass


@dataclass(frozen=True)
class Line:
    text: str
    page: int | None


@dataclass
class Chunk:
    locator: str
    lines: list[Line]
    hierarchy: dict[str, Any] = field(default_factory=dict)

    @property
    def content(self) -> str:
        return "\n".join(line.text for line in self.lines).strip()

    @property
    def pages(self) -> tuple[int | None, int | None]:
        numbers = [line.page for line in self.lines if line.page is not None]
        return (min(numbers), max(numbers)) if numbers else (None, None)


@dataclass(frozen=True)
class ChunkingResult:
    profile: str
    chunks: list[dict[str, Any]]
    front_matter_characters: int


@lru_cache(maxsize=1)
def load_profiles() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def sha256_ref(content: str) -> str:
    return f"sha256:{sha256(content.encode('utf-8')).hexdigest()}"


def to_lines(pages: list[str], *, strip_markdown_markers: bool = False) -> list[Line]:
    """Non-empty, whitespace-normalised lines tagged with their 1-based page (when pages exist)."""
    paged = len(pages) > 1
    lines: list[Line] = []
    for index, page in enumerate(pages, start=1):
        for raw in page.split("\n"):
            text = _SPACES.sub(" ", raw).strip()
            if strip_markdown_markers:
                text = re.sub(r"^#{1,6}\s+", "", text)
            if text:
                lines.append(Line(text, index if paged else None))
    return lines


# --- profile: heading tree (chapter > article > clause) -------------------------------------------


def _compile(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


def _chunk_heading_tree(lines: list[Line], profile: dict[str, Any]) -> tuple[list[Chunk], int]:
    levels = {level["name"]: level for level in profile["levels"]}
    chapter = levels.get("chapter")
    article = levels["article"]
    clause = levels["clause"]
    chapter_re = _compile(chapter["pattern"]) if chapter else None
    article_re = _compile(article["pattern"])
    clause_re = _compile(clause["pattern"])
    article_prefix, clause_prefix = article["locatorPrefix"], clause["locatorPrefix"]

    chunks: list[Chunk] = []
    front_matter = 0
    chapter_info: dict[str, Any] = {}
    current_article: dict[str, Any] | None = None
    article_locator = ""
    intro: list[Line] = []
    clause_chunks: list[Chunk] = []
    current_clause: Chunk | None = None
    last_clause = 0

    def close_article() -> None:
        nonlocal intro, clause_chunks, current_clause, current_article, last_clause
        if current_article is None:
            return
        if clause_chunks:
            if intro:
                chunks.append(Chunk(article_locator, list(intro), dict(current_article)))
            chunks.extend(clause_chunks)
        else:
            chunks.append(Chunk(article_locator, list(intro), dict(current_article)))
        intro, clause_chunks, current_clause, last_clause = [], [], None, 0

    index = 0
    while index < len(lines):
        line = lines[index]
        text = line.text
        if current_article is None:
            front_matter_here = True
        else:
            front_matter_here = False
        if chapter_re and (match := chapter_re.match(text)):
            close_article()
            current_article = None
            title = match.group(2).strip()
            if not title and chapter.get("titleOnNextLine") and index + 1 < len(lines):
                following = lines[index + 1].text
                if not (article_re.match(following) or clause_re.match(following)) and len(following) <= 160:
                    title = following
                    index += 1
            chapter_info = {"chapterNumber": match.group(1), "chapterTitle": title}
        elif match := article_re.match(text):
            close_article()
            number = match.group(1)
            current_article = {
                **chapter_info,
                "articleNumber": number,
                "articleTitle": match.group(2).strip(),
            }
            article_locator = f"{article_prefix}{number.lower()}"
            intro = [line]
        elif (
            current_article is not None
            and (match := clause_re.match(text))
            and int(match.group(1)) == last_clause + 1
        ):
            # Only the next clause number opens a clause; other numbered lines are part of the text.
            number = match.group(1)
            last_clause += 1
            current_clause = Chunk(
                f"{article_locator}{LOCATOR_SEPARATOR}{clause_prefix}{number}",
                [line],
                {**current_article, "clauseNumber": number},
            )
            clause_chunks.append(current_clause)
        elif current_article is not None:
            (current_clause.lines if current_clause else intro).append(line)
        elif front_matter_here:
            front_matter += len(text) + 1
        index += 1
    close_article()
    return chunks, front_matter


def _heading_count(lines: list[Line], profile: dict[str, Any]) -> int:
    if profile["kind"] == "heading-tree":
        article_re = _compile(next(l for l in profile["levels"] if l["name"] == "article")["pattern"])
        return sum(1 for line in lines if article_re.match(line.text))
    if profile["kind"] == "numbered-outline":
        pattern = _compile(profile["pattern"])
        return sum(1 for line in lines if pattern.match(line.text))
    return 0


# --- profile: numbered outline (1 / 1.2 / 1.2.3) --------------------------------------------------


def _chunk_numbered_outline(lines: list[Line], profile: dict[str, Any]) -> tuple[list[Chunk], int]:
    pattern = _compile(profile["pattern"])
    prefix = profile["locatorPrefix"]
    max_heading = int(profile.get("maxHeadingCharacters", 160))
    sections: list[tuple[str, str, list[Line]]] = []
    front_matter = 0
    for line in lines:
        match = pattern.match(line.text)
        if match and len(line.text) <= max_heading and not line.text.rstrip().endswith((";", ",")):
            sections.append((match.group(1), match.group(2).strip(), [line]))
        elif sections:
            sections[-1][2].append(line)
        else:
            front_matter += len(line.text) + 1
    chunks: list[Chunk] = []
    seen: set[str] = set()
    for number, title, body in sections:
        parts = number.split(".")
        locator = LOCATOR_SEPARATOR.join(f"{prefix}{'.'.join(parts[: depth + 1])}" for depth in range(len(parts)))
        if locator in seen:
            continue
        seen.add(locator)
        chunks.append(Chunk(locator, body, {"sectionNumber": number, "sectionTitle": title}))
    return chunks, front_matter


# --- profile: paragraph windows -------------------------------------------------------------------


def _chunk_paragraphs(lines: list[Line], profile: dict[str, Any], limit: int) -> tuple[list[Chunk], int]:
    prefix = profile["locatorPrefix"]
    chunks: list[Chunk] = []
    window: list[Line] = []
    size = 0
    for line in lines:
        if window and size + len(line.text) + 1 > limit:
            chunks.append(Chunk(f"{prefix}{len(chunks) + 1:04d}", window, {"ordinal": len(chunks) + 1}))
            window, size = [], 0
        window.append(line)
        size += len(line.text) + 1
    if window:
        chunks.append(Chunk(f"{prefix}{len(chunks) + 1:04d}", window, {"ordinal": len(chunks) + 1}))
    return chunks, 0


# --- splitting and output -------------------------------------------------------------------------


def _split_oversized(chunk: Chunk, limit: int) -> list[Chunk]:
    if len(chunk.content) <= limit:
        return [chunk]
    parts: list[Chunk] = []
    window: list[Line] = []
    size = 0

    def flush() -> None:
        nonlocal window, size
        if window:
            parts.append(
                Chunk(
                    f"{chunk.locator}{LOCATOR_SEPARATOR}part-{len(parts) + 1}",
                    window,
                    {**chunk.hierarchy, "partOf": chunk.locator},
                )
            )
            window, size = [], 0

    for line in chunk.lines:
        pieces = [line.text[i : i + limit] for i in range(0, len(line.text), limit)] or [line.text]
        for piece in pieces:
            if window and size + len(piece) + 1 > limit:
                flush()
            window.append(Line(piece, line.page))
            size += len(piece) + 1
    flush()
    return parts


def chunk_document(pages: list[str], *, profile: str, markdown: bool = False) -> ChunkingResult:
    """Chunks for the requested profile; ``AUTO`` picks the first configured profile that fits."""
    config = load_profiles()
    profiles: dict[str, Any] = config["profiles"]
    limit = int(config["maxChunkCharacters"])
    lines = to_lines(pages, strip_markdown_markers=markdown)
    if profile == PROFILE_AUTO:
        minimum = int(config["autoMinimumHeadings"])
        chosen = next(
            (name for name in config["autoOrder"] if _heading_count(lines, profiles[name]) >= minimum),
            PROFILE_PARAGRAPHS,
        )
    elif profile in profiles:
        chosen = profile
    else:
        raise UnknownStructureProfile(profile)

    spec = profiles[chosen]
    if spec["kind"] == "heading-tree":
        raw, front = _chunk_heading_tree(lines, spec)
    elif spec["kind"] == "numbered-outline":
        raw, front = _chunk_numbered_outline(lines, spec)
    else:
        raw, front = _chunk_paragraphs(lines, spec, limit)
    if not raw and chosen != PROFILE_PARAGRAPHS:
        # A structured profile that found no structure still has to keep the text.
        chosen = PROFILE_PARAGRAPHS
        raw, front = _chunk_paragraphs(lines, profiles[PROFILE_PARAGRAPHS], limit)

    chunks: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for chunk in raw:
        for part in _split_oversized(chunk, limit):
            content = part.content
            if not content:
                continue
            # A repeated heading keeps its text under a distinct locator instead of being dropped.
            repeats = seen.get(part.locator, 0)
            seen[part.locator] = repeats + 1
            if repeats:
                part.locator = f"{part.locator}{LOCATOR_SEPARATOR}dup-{repeats + 1}"
            start, end = part.pages
            chunks.append(
                {
                    "locator": part.locator,
                    "content": content,
                    "contentSha256": sha256_ref(content),
                    "hierarchy": part.hierarchy,
                    "pageStart": start,
                    "pageEnd": end,
                }
            )
    return ChunkingResult(chosen, chunks, front)
