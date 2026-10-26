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
        """Business purpose: Expose the source text assigned to one structural chunk for API validation and retrieval.

        Business rules:
        - Stored line order is preserved and line boundaries are represented with newline separators.
        - Leading and trailing whitespace around the combined chunk is removed; the property does not add or infer legal text.

        Execution flow:
        1. Join the chunk's line text in source order.
        2. Trim the combined text and return it.

        Failure cases:
        - An empty line list returns an empty string; malformed line entries propagate ordinary attribute errors.

        Side effects:
        - None: the property reads the chunk lines without mutating them.
        """
        return "\n".join(line.text for line in self.lines).strip()

    @property
    def pages(self) -> tuple[int | None, int | None]:
        """Business purpose: Report the source-page range represented by one chunk for citation and review metadata.

        Business rules:
        - Only non-null page numbers contribute to the range; the range is not a claim that every intervening page has text.
        - Chunks with no page provenance return `(None, None)` rather than an invented page.

        Execution flow:
        1. Collect the line page numbers that are present.
        2. Return their minimum and maximum, or two null values when none are known.

        Failure cases:
        - No page numbers is a valid provenance state; incomparable malformed values propagate Python's comparison error.

        Side effects:
        - None: page metadata is read from the chunk's lines only.
        """
        numbers = [line.page for line in self.lines if line.page is not None]
        return (min(numbers), max(numbers)) if numbers else (None, None)


@dataclass(frozen=True)
class ChunkingResult:
    profile: str
    chunks: list[dict[str, Any]]
    front_matter_characters: int


@lru_cache(maxsize=1)
def load_profiles() -> dict[str, Any]:
    """Business purpose: Load the configured legal-document structure profiles used to choose chunk boundaries and locators.

    Business rules:
    - The JSON profile file is the source of supported profile names, patterns, ordering, and chunk limits.
    - The module caches one parsed mapping; callers must treat it as shared configuration rather than a per-call copy.

    Execution flow:
    1. Read the configured JSON file as UTF-8 on the first call.
    2. Parse and return the profile mapping, reusing the cached value on later calls.

    Failure cases:
    - Missing, unreadable, or malformed configuration propagates the underlying filesystem or JSON parsing error.

    Side effects:
    - Reads the local structure-profile file once per process cache lifetime; it does not modify the file.
    """
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def sha256_ref(content: str) -> str:
    """Business purpose: Produce the content digest stored with legal-source chunks and extraction text.

    Business rules:
    - The supplied string is encoded as UTF-8 and the returned digest uses the `sha256:` scheme prefix.
    - The helper hashes exact input text; canonicalization and source-boundary choices belong to the caller.

    Execution flow:
    1. Encode the text as UTF-8.
    2. Calculate SHA-256 and return its hexadecimal digest with the scheme prefix.

    Failure cases:
    - Encoding errors propagate rather than yielding a fabricated hash.

    Side effects:
    - None: hashing is local and does not alter or persist the text.
    """
    return f"sha256:{sha256(content.encode('utf-8')).hexdigest()}"


def to_lines(pages: list[str], *, strip_markdown_markers: bool = False) -> list[Line]:
    """Convert extracted pages into non-empty, whitespace-normalised source lines.

    Business purpose: Prepare extracted legal-source text for deterministic chunking while retaining page provenance when page boundaries exist.

    Business rules:
    - Runs of spaces and tabs collapse to one space, surrounding whitespace is removed, and empty lines are omitted.
    - Page numbers are attached only when the input contains more than one page; optional Markdown heading markers are removed before storage.

    Execution flow:
    1. Determine whether the source has multiple pages for page attribution.
    2. Walk each page and physical line in input order, normalize whitespace, and optionally strip Markdown heading markers.
    3. Return only non-empty lines with their 1-based page when available.

    Failure cases:
    - Empty page text produces no lines; malformed page values propagate ordinary string-operation errors.

    Side effects:
    - None: normalized Line objects are created in memory and the extracted pages are not changed.
    """
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
    """Business purpose: Compile one profile-owned heading pattern using the case-insensitive matching rule shared by the chunker.

    Business rules:
    - The profile supplies the full regular expression; this helper adds no legal vocabulary or fallback pattern.
    - Matching is case-insensitive and otherwise preserves the profile's anchors and capture groups.

    Execution flow:
    1. Compile the supplied pattern with `re.IGNORECASE`.
    2. Return the compiled expression to the profile-specific chunking routine.

    Failure cases:
    - Invalid regular-expression syntax propagates `re.error` so the bad profile is not silently accepted.

    Side effects:
    - None: compilation creates an in-memory pattern object.
    """
    return re.compile(pattern, re.IGNORECASE)


def _chunk_heading_tree(lines: list[Line], profile: dict[str, Any]) -> tuple[Chunk | None, list[Chunk], int]:
    """Return the front-matter chunk, structural chunks, and front-matter character count.

    Business purpose: Partition source lines by the configured chapter/article/clause/point hierarchy while preserving addressable legacy locators.

    Business rules:
    - Heading patterns and locator prefixes come only from the selected structure profile.
    - A clause opens only when its number is the next sequential clause; other numbered lines remain text.
    - Content before the first structural heading remains in a front-matter chunk, and chapter introduction remains attached to its chapter chunk.

    Execution flow:
    1. Compile the selected profile's available level patterns and initialize front matter and hierarchy state.
    2. Walk lines in order, closing prior article/chapter chunks when a new heading changes scope.
    3. Assign article, sequential clause, and optional point lines to their current chunk while retaining hierarchy metadata.
    4. Close the final structures and return front matter, structural chunks, and the recorded front-matter character count.

    Failure cases:
    - Missing required profile keys or invalid configured patterns propagate errors; unrecognized headings stay in the current text chunk.

    Side effects:
    - Mutates only in-memory chunk lists and hierarchy state; no source file or persisted legal-source record is changed.
    """
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
        """Business purpose: Finalize the current article's introductory and clause chunks before another article begins.

        Business rules:
        - Article introduction is emitted separately only when clause chunks exist; otherwise the article locator owns its text.
        - Clause and point chunks remain in their source order and retain their existing hierarchy metadata.

        Execution flow:
        1. Return without changes when no article is open.
        2. Append any required article introduction and all collected clause/point chunks.
        3. Reset article-local text and numbering state for the next article.

        Failure cases:
        - An empty current article is still emitted with its article locator; malformed state errors propagate normally.

        Side effects:
        - Appends finalized chunks and resets variables captured from the enclosing in-memory parser.
        """
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
        """Business purpose: Finalize the current chapter-level chunk before a new chapter or end of source.

        Business rules:
        - Chapter heading text and any introduction before the first article remain grouped in the chapter chunk.
        - No chapter chunk is created when the parser has not opened one.

        Execution flow:
        1. Check whether a chapter chunk is open.
        2. Append it to the structural chunk sequence and clear the open-chapter reference.

        Failure cases:
        - An absent chapter is a valid no-op; list or closure failures propagate without inventing another chunk.

        Side effects:
        - Appends one in-memory chunk and clears the parser's captured chapter reference when present.
        """
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
    """Business purpose: Measure whether extracted source text contains enough configured headings to select a structured AUTO profile.

    Business rules:
    - Heading-tree profiles count article headings; numbered-outline profiles count matching configured outline headings.
    - Other profile kinds contribute zero so AUTO selection does not claim structure they do not define.

    Execution flow:
    1. Inspect the configured profile kind.
    2. Compile its article or outline pattern and count matching source lines.
    3. Return zero for profile kinds without an AUTO heading-count rule.

    Failure cases:
    - Missing required profile fields, absent article level, or invalid pattern syntax propagate configuration errors.

    Side effects:
    - None: the helper reads profile data and source lines without modifying them.
    """
    if profile["kind"] == "heading-tree":
        article_re = _compile(next(l for l in profile["levels"] if l["name"] == "article")["pattern"])
        return sum(1 for line in lines if article_re.match(line.text))
    if profile["kind"] == "numbered-outline":
        pattern = _compile(profile["pattern"])
        return sum(1 for line in lines if pattern.match(line.text))
    return 0


# --- profile: numbered outline (1 / 1.2 / 1.2.3) --------------------------------------------------


def _chunk_numbered_outline(lines: list[Line], profile: dict[str, Any]) -> tuple[Chunk | None, list[Chunk], int]:
    """Business purpose: Partition source lines into numbered-outline sections and retain text before the first section as front matter.

    Business rules:
    - A matching line opens a section only when it stays under the configured heading length and does not end in a continuation comma or semicolon.
    - Each dotted section number produces a hierarchical legacy locator; repeated locators are disambiguated later by `chunk_document`.
    - Lines that do not open a section remain attached to the prior section or to front matter when no section exists.

    Execution flow:
    1. Compile the profile pattern and scan lines in order, opening eligible sections and accumulating their following text.
    2. Build chunks with dotted hierarchical locators and recorded section number/title metadata.
    3. Return the optional front-matter chunk, section chunks, and front-matter character count.

    Failure cases:
    - Missing profile keys or invalid patterns propagate errors; nonmatching text is preserved instead of discarded.

    Side effects:
    - Mutates only newly allocated in-memory section and chunk lists.
    """
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
    """Business purpose: Partition normalized source lines into sequential paragraph windows when no structural profile is usable.

    Business rules:
    - Window size uses the supplied character limit, counting one separator character after each line.
    - A line is never dropped to meet the limit; an individually oversized line is split by the later bounded-splitting stage.
    - Paragraph windows receive stable ordinal locators and no inferred hierarchy beyond that ordinal.

    Execution flow:
    1. Accumulate lines until adding the next line would exceed the limit.
    2. Emit each completed window with a sequential locator and ordinal metadata.
    3. Emit the remaining window and return no front-matter chunk.

    Failure cases:
    - Invalid profile fields propagate lookup errors; an empty line list returns no chunks.

    Side effects:
    - Creates in-memory chunk records only; source lines and profile values are not modified.
    """
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
    """Business purpose: Return the configured locator used to address text that precedes recognized document structure.

    Business rules:
    - A nonempty configured front-matter locator takes precedence over the module's stable fallback.
    - The value is a retrieval address only and does not assign legal hierarchy or effect.

    Execution flow:
    1. Load the cached structure profiles.
    2. Return the configured locator or `front-matter` when it is absent or empty.

    Failure cases:
    - Configuration read or JSON parse failures propagate from `load_profiles`.

    Side effects:
    - May trigger the first local profile-file read through the cached configuration loader.
    """
    return str(load_profiles().get("frontMatterLocator") or FRONT_MATTER_LOCATOR)


# --- splitting and output -------------------------------------------------------------------------


def _cut_line(text: str, limit: int) -> list[str]:
    """Pieces of one over-long line: each at most ``limit`` characters, cut at whitespace where possible.

    Whitespace between two pieces is dropped, so the pieces joined by one space give the line back. Without any
    whitespace in the window the cut is a hard one, moved back so it never separates a combining mark from its base.

    Business purpose: Split an individually over-limit source line into bounded retrieval pieces without separating a combining mark from its base character.

    Business rules:
    - The supplied limit bounds each returned piece; whitespace boundaries are preferred when one exists in the window.
    - Inter-piece whitespace is normalized away by trimming, so joining returned pieces with one space reconstructs normalized source text.

    Execution flow:
    1. While the remaining line is longer than the limit, search for a space within the allowed window.
    2. Cut at that space when possible; otherwise cut at the limit and move backward over combining marks.
    3. Append any remaining suffix as the final piece.

    Failure cases:
    - A nonpositive limit is not separately validated and may cause indexing or looping errors; callers use the configured positive chunk limit.

    Side effects:
    - None: pieces are returned in memory and the source string is immutable.
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
    """Business purpose: Ensure a structural chunk fits the configured maximum while retaining its locator lineage and page metadata.

    Business rules:
    - Chunks already within the limit are returned unchanged.
    - Oversized multi-line chunks are partitioned into bounded `::part-N` windows. An individually oversized line is split alone; neighboring lines are never merged into its fragments.
    - Each generated part records its original locator in hierarchy metadata.

    Execution flow:
    1. Return the original chunk when its normalized content is within the bound.
    2. Walk source lines, flushing accumulated windows before oversized lines or when a window would exceed the limit.
    3. Split oversized lines, append all parts, and return them in source order.

    Failure cases:
    - Invalid limits are not normalized here; malformed content or hierarchy data propagates ordinary runtime errors.

    Side effects:
    - Creates in-memory part chunks and closure-local output state; it does not mutate source files or persisted records.
    """
    if len(chunk.content) <= limit:
        return [chunk]
    parts: list[Chunk] = []
    window: list[Line] = []
    size = 0

    def emit(lines: list[Line]) -> None:
        """Business purpose: Add one bounded line group as the next part of its original structural chunk.

        Business rules:
        - Part numbering follows append order and each generated locator is qualified by the original locator.
        - Hierarchy metadata preserves original fields and records `partOf` for provenance.

        Execution flow:
        1. Derive the next part locator from the current output count.
        2. Append a new Chunk with the supplied lines and copied hierarchy metadata.

        Failure cases:
        - Invalid captured chunk or list state propagates ordinary Python errors; no part is fabricated after such a failure.

        Side effects:
        - Appends one Chunk to the enclosing in-memory parts list.
        """
        parts.append(
            Chunk(
                f"{chunk.locator}{LOCATOR_SEPARATOR}part-{len(parts) + 1}",
                lines,
                {**chunk.hierarchy, "partOf": chunk.locator},
            )
        )

    def flush() -> None:
        """Business purpose: Close the current bounded line window before a source boundary or oversized line is handled.

        Business rules:
        - An empty window produces no part.
        - A nonempty window is emitted once and the accumulator resets for subsequent source text.

        Execution flow:
        1. Check whether the captured window contains lines.
        2. Emit that window and clear both the line list and its tracked size.

        Failure cases:
        - Empty windows are valid no-ops; an emit failure propagates and prevents a false successful split.

        Side effects:
        - May append a Chunk through `emit` and resets the enclosing parser's in-memory window state.
        """
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
    """Chunk extracted pages for the requested profile; ``AUTO`` picks the first configured profile that fits.

    Business purpose: Produce a deterministic, addressable partition of extracted legal-source text for API ingestion and later retrieval.

    Business rules:
    - The configured profile file owns profile order, heading patterns, locator prefixes, and maximum chunk characters.
    - AUTO selects the first configured profile meeting the minimum heading count, otherwise paragraph windows; a structured profile with no structure also falls back to paragraphs.
    - Every nonempty normalized source line is retained. Oversized structural chunks become bounded `::part-N` windows; individual lines stay whole unless a line itself exceeds the bound. Repeated locators receive `::dup-N`.
    - The API's maximum chunk-count acceptance rule is enforced by the ingestion caller, not by this chunking function.

    Execution flow:
    1. Load configuration and normalize extracted pages into source lines, optionally stripping Markdown heading markers.
    2. Select or validate the requested profile and run its heading-tree, numbered-outline, or paragraph partitioner.
    3. Fall back to paragraph windows when a structured profile finds no structural chunks.
    4. Split oversized chunks, preserve unique locators, and emit content hashes, hierarchy, and page ranges.

    Failure cases:
    - Unknown explicit profile names raise UnknownStructureProfile; missing or malformed profile configuration errors propagate.
    - Malformed source lines or structure patterns fail rather than returning incomplete accepted content.

    Side effects:
    - Reads the cached local structure-profile configuration and builds result objects in memory; it does not persist chunks or call the API.
    """
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
        """Business purpose: Run the configured partition strategy selected for this document.

        Business rules:
        - Heading-tree and numbered-outline profile kinds use their dedicated locator builders.
        - Other configured profile kinds use paragraph windows with the configured character limit.

        Execution flow:
        1. Read the named profile specification.
        2. Dispatch by its configured kind to the corresponding chunk-building function.

        Failure cases:
        - A missing profile name or malformed profile structure propagates its configuration lookup or parsing error.

        Side effects:
        - None beyond in-memory chunk construction; this helper does not change the selected profile or source lines.
        """
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
