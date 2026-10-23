"""Read the text of one stored document. Supported formats only; anything else is refused by the API first.

The extractor never reports success for a subset it cannot name: content that is detected but not extracted
(a PDF page without a text layer, a Word numbering scheme it cannot render) is returned as an explicit gap
(``ExtractedDocument.gaps``) that the API persists with the extraction. Table cells, Word footnotes and endnotes
and automatic numbering labels are extracted with separators that keep token boundaries.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree

MEDIA_PDF = "application/pdf"
MEDIA_HTML = "text/html"
MEDIA_TEXT = "text/plain"
MEDIA_MARKDOWN = "text/markdown"
MEDIA_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

MAX_PDF_PAGES = 3000
MAX_DOCX_XML_BYTES = 80 * 1024 * 1024
MIN_TEXT_CHARACTERS = 20

# Mirrors LEGAL_SOURCE_EXTRACTION_GAP_KINDS in packages/contracts (parity is asserted by a test).
GAP_NO_TEXT_LAYER = "NO_TEXT_LAYER"
GAP_UNSUPPORTED_NUMBERING = "UNSUPPORTED_NUMBERING"
CELL_SEPARATOR = " | "
FOOTNOTE_LABEL = "Footnote"
ENDNOTE_LABEL = "Endnote"

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
_BLOCK_TAGS = {
    "p", "div", "br", "li", "ul", "ol", "tr", "table", "section", "article", "header", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "hr", "dd", "dt",
}
_CELL_TAGS = {"td", "th"}
_SKIPPED_TAGS = {"script", "style", "noscript", "template", "head", "svg"}
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ExtractionError(Exception):
    """The document could not be turned into text. ``code`` is a LEGAL_SOURCE_DOCUMENT_FAILURE_CODES value."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ExtractedDocument:
    """Text split into pages (a single page for formats without pages), plus what could not be extracted."""

    pages: list[str]
    page_count: int | None
    tool: str
    gaps: list[dict] = field(default_factory=list)


def clean_text(value: str) -> str:
    """NFC, no control characters, line endings unified; Vietnamese diacritics are preserved."""
    value = unicodedata.normalize("NFC", value).replace("\r\n", "\n").replace("\r", "\n")
    value = value.replace(" ", " ").replace("​", "").replace("﻿", "")
    return _CONTROL.sub("", value)


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="replace")


# --- HTML -----------------------------------------------------------------------------------------


class _HtmlText(HTMLParser):
    """Visible text. Block tags break lines; table cells of one row share a line, separated by ``CELL_SEPARATOR``."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._cells: list[list[str]] = []  # open cells, innermost last
        self._cell_tables: list[int] = []  # table depth of each open cell
        self._row_cells: list[int] = []  # cells already written in the current row, per open table
        self._skip_depth = 0

    def _write(self, text: str) -> None:
        (self._cells[-1] if self._cells else self._parts).append(text)

    def _close_cells(self, table_depth: int) -> None:
        """End every open cell of the current table (HTML may omit </td>, </th> and </tr>)."""
        while self._cells and self._cell_tables[-1] >= table_depth:
            self._cell_tables.pop()
            self._write(" ".join("".join(self._cells.pop()).split()))

    def _break(self) -> None:
        # Inside a cell a break is a space, so the whole row stays on one line.
        self._write(" " if self._cells else "\n")

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001 - html.parser signature
        if tag in _SKIPPED_TAGS:
            self._skip_depth += 1
        elif self._skip_depth:
            return
        elif tag == "table":
            self._break()
            self._row_cells.append(0)
        elif tag == "tr":
            self._close_cells(len(self._row_cells))
            self._break()
            if self._row_cells:
                self._row_cells[-1] = 0
        elif tag in _CELL_TAGS:
            self._close_cells(len(self._row_cells))
            if self._row_cells:
                if self._row_cells[-1]:
                    self._write(CELL_SEPARATOR)
                self._row_cells[-1] += 1
            self._cells.append([])
            self._cell_tables.append(len(self._row_cells))
        elif tag in _BLOCK_TAGS:
            self._break()

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif self._skip_depth:
            return
        elif tag in _CELL_TAGS:
            self._close_cells(len(self._row_cells))
        elif tag == "table":
            self._close_cells(len(self._row_cells))
            if self._row_cells:
                self._row_cells.pop()
            self._break()
        elif tag == "tr":
            self._close_cells(len(self._row_cells))
            self._break()
        elif tag in _BLOCK_TAGS:
            self._break()

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._write(data)

    def text(self) -> str:
        self._close_cells(0)  # unclosed cells at the end of a malformed document
        return "".join(self._parts)


def _html_to_text(data: bytes) -> str:
    parser = _HtmlText()
    parser.feed(_decode(data))
    parser.close()
    return parser.text()


# --- DOCX -----------------------------------------------------------------------------------------


def _local(element) -> str:  # noqa: ANN001 - ElementTree element
    return element.tag.rsplit("}", 1)[-1]


def _attr(element, name: str):  # noqa: ANN001, ANN202
    return element.get(_W + name)


def _child_val(parent, name: str):  # noqa: ANN001, ANN202
    child = parent.find(_W + name) if parent is not None else None
    return _attr(child, "val") if child is not None else None


def _roman(number: int, upper: bool) -> str:
    pairs = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    out = ""
    for value, symbol in pairs:
        while number >= value:
            out += symbol
            number -= value
    return out.upper() if upper else out


def _letters(number: int, upper: bool) -> str:
    # Word counts a, b, ... z, aa, bb, ... zz, aaa, ...
    letter = chr(ord("a") + (number - 1) % 26) * ((number - 1) // 26 + 1)
    return letter.upper() if upper else letter


_FORMATTERS = {
    "decimal": lambda n: str(n),
    "decimalZero": lambda n: f"{n:02d}",
    "lowerLetter": lambda n: _letters(n, False),
    "upperLetter": lambda n: _letters(n, True),
    "lowerRoman": lambda n: _roman(n, False),
    "upperRoman": lambda n: _roman(n, True),
}
_NO_LABEL_FORMATS = {"bullet", "none"}


class _Numbering:
    """Word automatic numbering for the simple decimal / letter / roman formats.

    ``numbering.xml`` defines the list levels, ``styles.xml`` may attach a list to a paragraph style. A paragraph
    in a list gets its rendered label ("1.", "(a)", "Article 3") in front of its text. Any other number format is
    not rendered; it is recorded in ``unsupported`` so the caller can report a gap instead of silently dropping the
    label.
    """

    def __init__(self, numbering_root, styles_root) -> None:  # noqa: ANN001
        self.levels: dict[str, dict[int, dict]] = {}
        self.nums: dict[str, tuple[str, dict[int, int]]] = {}
        self.style_lists: dict[str, tuple[str | None, int | None]] = {}
        self.style_parent: dict[str, str] = {}
        self.counters: dict[str, dict[int, int]] = {}
        self.started: set[str] = set()
        self.unsupported: set[str] = set()
        if numbering_root is not None:
            for abstract in numbering_root.findall(_W + "abstractNum"):
                levels = {}
                for lvl in abstract.findall(_W + "lvl"):
                    index = int(_attr(lvl, "ilvl") or 0)
                    levels[index] = {
                        "start": int(_child_val(lvl, "start") or 1),
                        "format": _child_val(lvl, "numFmt") or "decimal",
                        "text": _child_val(lvl, "lvlText") or "",
                        "legal": lvl.find(_W + "isLgl") is not None,
                        "style": _child_val(lvl, "pStyle"),
                    }
                self.levels[_attr(abstract, "abstractNumId")] = levels
            for num in numbering_root.findall(_W + "num"):
                overrides = {}
                for override in num.findall(_W + "lvlOverride"):
                    start = _child_val(override, "startOverride")
                    if start is not None:
                        overrides[int(_attr(override, "ilvl") or 0)] = int(start)
                self.nums[_attr(num, "numId")] = (_child_val(num, "abstractNumId"), overrides)
        if styles_root is not None:
            for style in styles_root.findall(_W + "style"):
                style_id = _attr(style, "styleId")
                parent = _child_val(style, "basedOn")
                if parent:
                    self.style_parent[style_id] = parent
                num_pr = style.find(f"{_W}pPr/{_W}numPr")
                if num_pr is not None:
                    level = _child_val(num_pr, "ilvl")
                    self.style_lists[style_id] = (_child_val(num_pr, "numId"), int(level) if level is not None else None)

    def _style_list(self, style_id: str | None) -> tuple[str | None, int | None, str | None]:
        seen = set()
        while style_id and style_id not in seen:
            seen.add(style_id)
            if style_id in self.style_lists:
                num_id, level = self.style_lists[style_id]
                return num_id, level, style_id
            style_id = self.style_parent.get(style_id)
        return None, None, None

    def label(self, paragraph) -> str:  # noqa: ANN001
        properties = paragraph.find(_W + "pPr")
        num_pr = properties.find(_W + "numPr") if properties is not None else None
        num_id = _child_val(num_pr, "numId") if num_pr is not None else None
        level = _child_val(num_pr, "ilvl") if num_pr is not None else None
        level = int(level) if level is not None else None
        style = _child_val(properties, "pStyle")
        if num_id is None:
            num_id, style_level, linked = self._style_list(style)
            if num_id is not None and level is None:
                level = style_level
                if level is None and linked:
                    abstract = self.nums.get(num_id, (None, {}))[0]
                    level = next((i for i, spec in self.levels.get(abstract, {}).items() if spec["style"] == linked), None)
        if num_id is None or num_id == "0":
            return ""
        abstract_id, overrides = self.nums.get(num_id, (None, {}))
        levels = self.levels.get(abstract_id)
        level = level if level is not None else 0
        spec = (levels or {}).get(level)
        if spec is None:
            self.unsupported.add("undefined-list-level")
            return ""
        if spec["format"] in _NO_LABEL_FORMATS:
            return ""
        counters = self.counters.setdefault(abstract_id, {})
        if num_id not in self.started:
            self.started.add(num_id)
            for lvl, start in overrides.items():
                counters[lvl] = start - 1
        counters[level] = counters.get(level, spec["start"] - 1) + 1
        for deeper in [l for l in counters if l > level]:
            del counters[deeper]
        if spec["format"] not in _FORMATTERS:
            self.unsupported.add(spec["format"])
            return ""

        def render(match: re.Match[str]) -> str:
            ref = int(match.group(1)) - 1
            ref_spec = levels.get(ref)
            if ref_spec is None:
                self.unsupported.add("undefined-list-level")
                return ""
            fmt = "decimal" if spec["legal"] else ref_spec["format"]
            if fmt not in _FORMATTERS:
                self.unsupported.add(fmt)
                return ""
            return _FORMATTERS[fmt](counters.get(ref, ref_spec["start"]))

        return re.sub(r"%([1-9])", render, spec["text"]).strip()


class _DocxReader:
    """Walks WordprocessingML in document order and yields one string per text line."""

    def __init__(self, numbering: _Numbering, notes: dict[str, dict[str, list[str]]]) -> None:
        self.numbering = numbering
        self.notes = notes  # kind ("footnote" | "endnote") -> id -> paragraph texts
        self.counts = {"footnote": 0, "endnote": 0}
        self.emitted: set[tuple[str, str]] = set()

    def blocks(self, container) -> list[str]:  # noqa: ANN001
        lines: list[str] = []
        for child in container:
            name = _local(child)
            if child.tag == _W + "p":
                lines.extend(self.paragraph(child))
            elif child.tag == _W + "tbl":
                lines.extend(self.table(child))
            elif child.tag in (_W + "sdt",):
                content = child.find(_W + "sdtContent")
                if content is not None:
                    lines.extend(self.blocks(content))
            elif name in ("sdtContent", "customXml", "smartTag", "ins", "moveTo"):
                lines.extend(self.blocks(child))
            elif name == "AlternateContent":
                choice = child.find(_MC + "Choice")
                if choice is not None:
                    lines.extend(self.blocks(choice))
        return lines

    def table(self, table) -> list[str]:  # noqa: ANN001
        rows: list[str] = []
        for row in self._rows(table):
            cells = []
            for cell in row.findall(_W + "tc"):
                text = " ".join(" ".join(self.blocks(cell)).split())
                cells.append(text)
            if any(cells):
                rows.append(CELL_SEPARATOR.join(cells))
        return rows

    @staticmethod
    def _rows(table):  # noqa: ANN001, ANN205
        for child in table:
            if child.tag == _W + "tr":
                yield child
            elif child.tag == _W + "sdt":
                content = child.find(_W + "sdtContent")
                for inner in content if content is not None else []:
                    if inner.tag == _W + "tr":
                        yield inner

    def paragraph(self, paragraph) -> list[str]:  # noqa: ANN001
        text: list[str] = []
        boxes: list = []
        references: list[tuple[str, str]] = []

        def walk(node) -> None:  # noqa: ANN001
            for child in node:
                tag = child.tag
                if tag == _W + "t":
                    text.append(child.text or "")
                elif tag == _W + "tab":
                    text.append(" ")
                elif tag in (_W + "br", _W + "cr"):
                    text.append("\n")
                elif tag == _W + "noBreakHyphen":
                    text.append("-")
                elif tag == _W + "txbxContent":
                    boxes.append(child)  # its paragraphs are separate lines, emitted once below
                elif tag == _W + "footnoteReference":
                    references.append(("footnote", _attr(child, "id")))
                elif tag == _W + "endnoteReference":
                    references.append(("endnote", _attr(child, "id")))
                elif tag in (_MC + "Fallback", _W + "pPr", _W + "rPr", _W + "del", _W + "moveFrom"):
                    continue  # Fallback repeats the Choice branch; the others carry no visible text
                else:
                    walk(child)

        walk(paragraph)
        body = "".join(text)
        label = self.numbering.label(paragraph)
        lines = [f"{label} {body}" if label and body.strip() else body]
        for box in boxes:
            lines.extend(self.blocks(box))
        for kind, note_id in references:
            lines.extend(self.note(kind, note_id))
        return lines

    def note(self, kind: str, note_id: str) -> list[str]:
        if (kind, note_id) in self.emitted or note_id not in self.notes[kind]:
            return []
        self.emitted.add((kind, note_id))
        self.counts[kind] += 1
        label = f"{FOOTNOTE_LABEL if kind == 'footnote' else ENDNOTE_LABEL} {self.counts[kind]}:"
        paragraphs = [" ".join(p.split()) for p in self.notes[kind][note_id]]
        paragraphs = [p for p in paragraphs if p]
        if not paragraphs:
            return []
        return [f"{label} {paragraphs[0]}", *paragraphs[1:]]

    def unreferenced_notes(self) -> list[str]:
        lines: list[str] = []
        for kind in ("footnote", "endnote"):
            for note_id in self.notes[kind]:
                lines.extend(self.note(kind, note_id))
        return lines


def _read_part(archive: zipfile.ZipFile, name: str, *, required: bool):  # noqa: ANN202
    # Some Word exporters use Windows separators inside the ZIP; aliases must stay unambiguous.
    parts = [info for info in archive.infolist() if info.filename.replace("\\", "/") == name]
    if not parts:
        if required:
            raise ExtractionError("EXTRACTION_FAILED") from None
        return None
    if len(parts) != 1:
        raise ExtractionError("EXTRACTION_FAILED")
    info = parts[0]
    if info.file_size > MAX_DOCX_XML_BYTES:
        raise ExtractionError("EXTRACTION_FAILED")
    try:
        return ElementTree.fromstring(archive.read(info))
    except ElementTree.ParseError as error:
        raise ExtractionError("EXTRACTION_FAILED") from error


def _docx_notes(root, tag: str) -> dict[str, list[str]]:  # noqa: ANN001
    """Paragraph texts of each real note (separators and continuation notes are layout, not content)."""
    out: dict[str, list[str]] = {}
    if root is None:
        return out
    for note in root.findall(_W + tag):
        if _attr(note, "type") in ("separator", "continuationSeparator", "continuationNotice"):
            continue
        paragraphs = []
        for paragraph in note.iter(_W + "p"):
            parts = []
            for node in paragraph.iter():
                if node.tag == _W + "t" and node.text:
                    parts.append(node.text)
                elif node.tag == _W + "tab":
                    parts.append(" ")
            paragraphs.append("".join(parts))
        out[_attr(note, "id")] = paragraphs
    return out


def _docx_to_text(data: bytes) -> tuple[str, list[dict]]:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            document = _read_part(archive, "word/document.xml", required=True)
            numbering = _Numbering(_read_part(archive, "word/numbering.xml", required=False), _read_part(archive, "word/styles.xml", required=False))
            notes = {
                "footnote": _docx_notes(_read_part(archive, "word/footnotes.xml", required=False), "footnote"),
                "endnote": _docx_notes(_read_part(archive, "word/endnotes.xml", required=False), "endnote"),
            }
    except zipfile.BadZipFile as error:
        raise ExtractionError("EXTRACTION_FAILED") from error
    body = document.find(_W + "body")
    reader = _DocxReader(numbering, notes)
    lines = reader.blocks(body if body is not None else document)
    lines.extend(reader.unreferenced_notes())
    gaps = [{"page": None, "kind": GAP_UNSUPPORTED_NUMBERING}] if numbering.unsupported else []
    return "\n".join(lines), gaps


# --- PDF ------------------------------------------------------------------------------------------


def _ocr_pdf_pages(data: bytes, page_numbers: list[int]) -> dict[int, str]:
    from tools.legal.sources.scripts.ocr_legal_pdf import LegalPdfOcr

    try:
        with tempfile.TemporaryDirectory(prefix="lcsp-managed-pdf-") as temporary:
            original = Path(temporary) / "original.pdf"
            original.write_bytes(data)
            return {page.page_number: page.text for page in LegalPdfOcr().extract_pages(
                pdf_path=original, page_numbers=page_numbers,
            )}
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        raise ExtractionError("EXTRACTION_FAILED") from error


def _pdf_pages(data: bytes) -> tuple[list[str], bool]:
    try:
        from pypdf import PdfReader
        from pypdf.errors import PyPdfError
    except ImportError as error:  # pragma: no cover - dependency is declared
        raise ExtractionError("EXTRACTION_FAILED") from error
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ExtractionError("EXTRACTION_FAILED")
        if len(reader.pages) > MAX_PDF_PAGES:
            raise ExtractionError("EXTRACTION_FAILED")
        pages = [page.extract_text() or "" for page in reader.pages]
        # Empty text on an image-bearing page needs OCR; a genuinely blank page remains an explicit gap.
        scanned = [number for number, page in enumerate(reader.pages, start=1)
                   if not pages[number - 1].strip() and len(page.images)]
        if scanned:
            for number, text in _ocr_pdf_pages(data, scanned).items():
                pages[number - 1] = text
        return pages, bool(scanned)
    except ExtractionError:
        raise
    except (PyPdfError, ValueError, KeyError, RecursionError, OSError) as error:
        raise ExtractionError("EXTRACTION_FAILED") from error


def extract_document(media_type: str, data: bytes) -> ExtractedDocument:
    """Text of the document, page by page where the format has pages."""
    if media_type == MEDIA_PDF:
        raw_pages, ocr_used = _pdf_pages(data)
        pages = [clean_text(page) for page in raw_pages]
        # A page with no text may be scanned content that this extractor cannot read: report it, never guess.
        gaps = [{"page": number, "kind": GAP_NO_TEXT_LAYER} for number, page in enumerate(pages, start=1) if not page.strip()]
        document = ExtractedDocument(pages, len(pages), "pypdf+tesseract:vie+eng@300dpi" if ocr_used else "pypdf", gaps)
    elif media_type == MEDIA_DOCX:
        text, gaps = _docx_to_text(data)
        document = ExtractedDocument([clean_text(text)], None, "docx-xml", gaps)
    elif media_type == MEDIA_HTML:
        document = ExtractedDocument([clean_text(_html_to_text(data))], None, "html-text")
    elif media_type in (MEDIA_TEXT, MEDIA_MARKDOWN):
        document = ExtractedDocument([clean_text(_decode(data))], None, "plain-text")
    else:
        raise ExtractionError("UNSUPPORTED_MEDIA_TYPE")
    if sum(len(page.strip()) for page in document.pages) < MIN_TEXT_CHARACTERS:
        raise ExtractionError("NO_EXTRACTABLE_TEXT")
    return document
