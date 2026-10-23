"""Split extracted text into addressable chunks using a configured structure profile.

The heading vocabulary of every profile lives in ``config/legal_structure_profiles.json``; this
module only applies the patterns it is given. Legacy locators remain retrieval/provenance addresses.
Canonical legal hierarchy and semantic accounting use the derived document AST and Agent claim graph.

The chunks are a lossless partition (INV-R1): every normalised non-empty line of the extracted text
belongs to exactly one chunk. Text before the first heading becomes a front-matter chunk, the heading
line (and any introductory text) of a chapter becomes a chapter-level chunk, and a repeated locator
keeps its text under a ``::dup-N`` locator. Only a single line longer than the chunk bound is cut
(``::part-N``), at a whitespace boundary where one exists; every other line stays whole.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Any

PROFILE_AUTO = "AUTO"
PROFILE_PARAGRAPHS = "PARAGRAPHS"
CONFIG_PATH = Path(__file__).resolve().parents[3] / "config" / "legal_structure_profiles.json"
LOCATOR_SEPARATOR = "::"
FRONT_MATTER_LOCATOR = "front-matter"
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


def _chunk_heading_tree(lines: list[Line], profile: dict[str, Any]) -> tuple[Chunk | None, list[Chunk], int]:
    """Returns ``(front matter chunk, structural chunks, front matter characters)``."""
    levels = {level["name"]: level for level in profile["levels"]}
    chapter = levels.get("chapter")
    article = levels["article"]
    clause = levels["clause"]
    point = levels.get("point")
    chapter_re = _compile(chapter["pattern"]) if chapter else None
    article_re = _compile(article["pattern"])
    clause_re = _compile(clause["pattern"])
    point_re = _compile(point["pattern"]) if point else None
    article_prefix, clause_prefix = article["locatorPrefix"], clause["locatorPrefix"]
    chapter_prefix = (chapter or {}).get("locatorPrefix") or "chap-"

    chunks: list[Chunk] = []
    front: list[Line] = []
    chapter_info: dict[str, Any] = {}
    chapter_chunk: Chunk | None = None  # the chapter heading and its text up to the first article
    current_article: dict[str, Any] | None = None
    article_locator = ""
    intro: list[Line] = []
    clause_chunks: list[Chunk] = []
    current_clause: Chunk | None = None
    current_point: Chunk | None = None
    last_clause = 0

    def close_article() -> None:
        nonlocal intro, clause_chunks, current_clause, current_point, current_article, last_clause
        if current_article is None:
            return
        if clause_chunks:
            if intro:
                chunks.append(Chunk(article_locator, list(intro), dict(current_article)))
            chunks.extend(clause_chunks)
        else:
            chunks.append(Chunk(article_locator, list(intro), dict(current_article)))
        intro, clause_chunks, current_clause, last_clause = [], [], None, 0
        current_article = None
        current_point = None

    def close_chapter() -> None:
        nonlocal chapter_chunk
        if chapter_chunk is not None:
            chunks.append(chapter_chunk)
            chapter_chunk = None

    index = 0
    while index < len(lines):
        line = lines[index]
        text = line.text
        if chapter_re and (match := chapter_re.match(text)):
            close_article()
            close_chapter()
            title = match.group(2).strip()
            heading = [line]
            if not title and chapter.get("titleOnNextLine") and index + 1 < len(lines):
                following = lines[index + 1].text
                if not (article_re.match(following) or clause_re.match(following)) and len(following) <= 160:
                    title = following
                    heading.append(lines[index + 1])
                    index += 1
            chapter_info = {"chapterNumber": match.group(1), "chapterTitle": title}
            chapter_chunk = Chunk(f"{chapter_prefix}{match.group(1).lower()}", heading, dict(chapter_info))
        elif match := article_re.match(text):
            close_article()
            close_chapter()
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
            current_point = None
        elif current_clause is not None and point_re and (match := point_re.match(text)):
            label = match.group(1).lower()
            current_point = Chunk(
                f"{current_clause.locator}{LOCATOR_SEPARATOR}{point['locatorPrefix']}{label}",
                [line],
                {**current_clause.hierarchy, "pointLabel": label},
            )
            clause_chunks.append(current_point)
        elif current_article is not None:
            (current_point.lines if current_point else current_clause.lines if current_clause else intro).append(line)
        elif chapter_chunk is not None:
            chapter_chunk.lines.append(line)  # introductory text of the chapter, before its first article
        else:
            front.append(line)
        index += 1
    close_article()
    close_chapter()
    front_chunk = Chunk(front_matter_locator(), front, {}) if front else None
    return front_chunk, chunks, sum(len(line.text) + 1 for line in front)


def _heading_count(lines: list[Line], profile: dict[str, Any]) -> int:
    if profile["kind"] == "heading-tree":
        article_re = _compile(next(l for l in profile["levels"] if l["name"] == "article")["pattern"])
        return sum(1 for line in lines if article_re.match(line.text))
    if profile["kind"] == "numbered-outline":
        pattern = _compile(profile["pattern"])
        return sum(1 for line in lines if pattern.match(line.text))
    return 0


# --- profile: numbered outline (1 / 1.2 / 1.2.3) --------------------------------------------------


def _chunk_numbered_outline(lines: list[Line], profile: dict[str, Any]) -> tuple[Chunk | None, list[Chunk], int]:
    pattern = _compile(profile["pattern"])
    prefix = profile["locatorPrefix"]
    max_heading = int(profile.get("maxHeadingCharacters", 160))
    sections: list[tuple[str, str, list[Line]]] = []
    front: list[Line] = []
    for line in lines:
        match = pattern.match(line.text)
        if match and len(line.text) <= max_heading and not line.text.rstrip().endswith((";", ",")):
            sections.append((match.group(1), match.group(2).strip(), [line]))
        elif sections:
            sections[-1][2].append(line)
        else:
            front.append(line)
    chunks: list[Chunk] = []
    for number, title, body in sections:
        parts = number.split(".")
        locator = LOCATOR_SEPARATOR.join(f"{prefix}{'.'.join(parts[: depth + 1])}" for depth in range(len(parts)))
        # A number that restarts (list items inside a section) repeats the locator; ``chunk_document`` keeps
        # such a section under a ``::dup-N`` locator instead of dropping its text.
        chunks.append(Chunk(locator, body, {"sectionNumber": number, "sectionTitle": title}))
    front_chunk = Chunk(front_matter_locator(), front, {}) if front else None
    return front_chunk, chunks, sum(len(line.text) + 1 for line in front)


# --- profile: paragraph windows -------------------------------------------------------------------


def _chunk_paragraphs(lines: list[Line], profile: dict[str, Any], limit: int) -> tuple[None, list[Chunk], int]:
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
    return None, chunks, 0


def front_matter_locator() -> str:
    return str(load_profiles().get("frontMatterLocator") or FRONT_MATTER_LOCATOR)


# --- splitting and output -------------------------------------------------------------------------


def _cut_line(text: str, limit: int) -> list[str]:
    """Pieces of one over-long line: each at most ``limit`` characters, cut at whitespace where possible.

    Whitespace between two pieces is dropped, so the pieces joined by one space give the line back. Without any
    whitespace in the window the cut is a hard one, moved back so it never separates a combining mark from its base.
    """
    pieces: list[str] = []
    rest = text
    while len(rest) > limit:
        cut = rest.rfind(" ", 1, limit + 1)
        if cut > 0:
            pieces.append(rest[:cut].rstrip())
            rest = rest[cut + 1 :].lstrip()
            continue
        cut = limit
        while cut > 1 and unicodedata.combining(rest[cut]):
            cut -= 1
        pieces.append(rest[:cut])
        rest = rest[cut:]
    if rest:
        pieces.append(rest)
    return pieces


def _split_oversized(chunk: Chunk, limit: int) -> list[Chunk]:
    if len(chunk.content) <= limit:
        return [chunk]
    parts: list[Chunk] = []
    window: list[Line] = []
    size = 0

    def emit(lines: list[Line]) -> None:
        parts.append(
            Chunk(
                f"{chunk.locator}{LOCATOR_SEPARATOR}part-{len(parts) + 1}",
                lines,
                {**chunk.hierarchy, "partOf": chunk.locator},
            )
        )

    def flush() -> None:
        nonlocal window, size
        if window:
            emit(window)
            window, size = [], 0

    for line in chunk.lines:
        if len(line.text) > limit:
            # A piece of a cut line never shares a chunk with another line, so every part is either whole lines
            # or text of exactly one line.
            flush()
            for piece in _cut_line(line.text, limit):
                emit([Line(piece, line.page)])
            continue
        if window and size + len(line.text) + 1 > limit:
            flush()
        window.append(line)
        size += len(line.text) + 1
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

    def run(name: str) -> tuple[Chunk | None, list[Chunk], int]:
        spec = profiles[name]
        if spec["kind"] == "heading-tree":
            return _chunk_heading_tree(lines, spec)
        if spec["kind"] == "numbered-outline":
            return _chunk_numbered_outline(lines, spec)
        return _chunk_paragraphs(lines, spec, limit)

    front_chunk, structural, front = run(chosen)
    if not structural and chosen != PROFILE_PARAGRAPHS:
        # A structured profile that found no structure still has to keep the text.
        chosen = PROFILE_PARAGRAPHS
        front_chunk, structural, front = run(chosen)
    raw = ([front_chunk] if front_chunk else []) + structural

    chunks: list[dict[str, Any]] = []
    used: set[str] = set()
    repeats: dict[str, int] = {}
    for chunk in raw:
        for part in _split_oversized(chunk, limit):
            content = part.content
            if not content:
                continue
            # A repeated heading keeps its text under a distinct locator instead of being dropped.
            base = part.locator
            repeats[base] = repeats.get(base, 0) + 1
            if repeats[base] > 1:
                part.locator = f"{base}{LOCATOR_SEPARATOR}dup-{repeats[base]}"
            while part.locator in used:  # defensive: a dup locator can never collide with another chunk
                repeats[base] += 1
                part.locator = f"{base}{LOCATOR_SEPARATOR}dup-{repeats[base]}"
            used.add(part.locator)
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
