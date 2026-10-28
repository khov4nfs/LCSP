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
    """NFC, no control characters, line endings unified; Vietnamese diacritics are preserved.

    Business purpose: Normalize extracted legal text while retaining Vietnamese diacritics and visible wording.

    Business rules:
    - Use NFC and unified line endings; remove defined control/zero-width markers and normalize nonbreaking spaces.
    Execution flow:
    1. Normalize Unicode and line endings.
    2. Remove the defined invisible characters and return cleaned text.
    Failure cases:
    - Invalid non-text input propagates; cleaning does not infer missing legal text.
    Side effects:
    - Pure text transformation; original document bytes are unchanged.
    """
    value = unicodedata.normalize("NFC", value).replace("\r\n", "\n").replace("\r", "\n")
    value = value.replace(" ", " ").replace("​", "").replace("﻿", "")
    return _CONTROL.sub("", value)


def _decode(data: bytes) -> str:
    """Business purpose: Decode stored textual legal documents with a visible fallback for invalid UTF-8 bytes.

    Business rules:
    - Honor the UTF-8 BOM; undecodable bytes use replacement characters rather than a guessed alternative encoding.
    Execution flow:
    1. Attempt UTF-8-sig decoding.
    2. On invalid UTF-8, return UTF-8 text with replacement markers.
    Failure cases:
    - UnicodeDecodeError selects the replacement fallback; this helper cannot certify source extraction completeness.
    Side effects:
    - Pure byte-to-text conversion; no storage changes.
    """
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
        """Business purpose: Accumulate visible legal HTML text within its current table-cell context.

        Business rules:
        - Text belongs to the innermost open cell when present, otherwise the document output.
        Execution flow:
        1. Append the text to the active cell or top-level document buffer.
        Failure cases:
        - No parsing decision or external failure is introduced; the parser owns valid buffer state.
        Side effects:
        - Mutates the parser's in-memory text buffers only.
        """
        (self._cells[-1] if self._cells else self._parts).append(text)

    def _close_cells(self, table_depth: int) -> None:
        """End every open cell of the current table (HTML may omit </td>, </th> and </tr>).

        Business purpose: Preserve visible cell text even when legal HTML omits closing cell tags.

        Business rules:
        - Close only cells at the current or deeper table depth; collapse internal whitespace without merging neighboring cells.
        Execution flow:
        1. Pop each affected cell and its depth.
        2. Write normalized cell text into the enclosing cell or document buffer.
        Failure cases:
        - No missing closing tag raises a business error; the parser closes known open cells without inventing content.
        Side effects:
        - Mutates cell stacks and accumulated text; no document storage is changed.
        """
        while self._cells and self._cell_tables[-1] >= table_depth:
            self._cell_tables.pop()
            self._write(" ".join("".join(self._cells.pop()).split()))

    def _break(self) -> None:
        # Inside a cell a break is a space, so the whole row stays on one line.
        """Business purpose: Retain textual boundaries when converting legal HTML blocks and table cells.

        Business rules:
        - A break inside a cell is a space; outside cells it is a newline so rows and blocks remain separate.
        Execution flow:
        1. Choose the separator for the current cell context and append it to visible output.
        Failure cases:
        - No external dependency or rejection exists; separator choice depends only on parser state.
        Side effects:
        - Appends a separator to the in-memory output buffer.
        """
        self._write(" " if self._cells else "\n")

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001 - html.parser signature
        """Business purpose: Preserve legal HTML block/table structure while excluding non-visible markup.

        Business rules:
        - Scripts, styles, head and other skipped regions never contribute visible text.
        - Table rows reset cell separation and omitted cell endings are closed before new cells.
        Execution flow:
        1. Track skipped-region depth.
        2. For visible markup, maintain table/row/cell context and insert required separators.
        Failure cases:
        - Unrecognized tags add no structural separator; malformed HTML is handled through parser state without executing its content.
        Side effects:
        - Mutates skip depth, table/cell stacks and visible text buffers only.
        """
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
        """Business purpose: Complete visible legal HTML boundaries and recover omitted cell endings.

        Business rules:
        - Skipped-region endings reduce skip depth without exposing hidden text; table/row endings close active cells first.
        Execution flow:
        1. Update skipped-region state.
        2. Close relevant cells and table context or insert visible block breaks.
        Failure cases:
        - Unmatched skipped-region endings cannot make depth negative; unknown end tags leave output unchanged.
        Side effects:
        - Mutates parser stacks and appends text boundaries; no external action occurs.
        """
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
        """Business purpose: Include only visible HTML text in legal document extraction.

        Business rules:
        - Data inside an active skipped region is discarded from the visible source view.
        Execution flow:
        1. Append received text only when skipped-region depth is zero.
        Failure cases:
        - Hidden text produces no output; this handler does not attempt to execute or interpret markup data.
        Side effects:
        - Mutates visible in-memory buffers when eligible.
        """
        if self._skip_depth == 0:
            self._write(data)

    def text(self) -> str:
        """Business purpose: Return complete accumulated visible HTML text, including malformed final cells.

        Business rules:
        - Open cells are closed at end of input so their existing text is retained once.
        Execution flow:
        1. Close all remaining cells.
        2. Join top-level text fragments into the extracted body.
        Failure cases:
        - Missing cell end tags do not discard buffered content; no new text is fabricated.
        Side effects:
        - Finishes cell buffers in memory and returns text; no storage write occurs.
        """
        self._close_cells(0)  # unclosed cells at the end of a malformed document
        return "".join(self._parts)


def _html_to_text(data: bytes) -> str:
    """Business purpose: Convert stored HTML bytes into visible legal text with structural separators.

    Business rules:
    - Use the non-executing HTML parser and the defined UTF-8 decoding fallback.
    Execution flow:
    1. Decode and feed the document to the visible-text parser.
    2. Close parsing and return all retained visible text.
    Failure cases:
    - Parser failures propagate to extraction; hidden markup is intentionally omitted rather than executed.
    Side effects:
    - Creates temporary parser state only; no network requests or document writes.
    """
    parser = _HtmlText()
    parser.feed(_decode(data))
    parser.close()
    return parser.text()


# --- DOCX -----------------------------------------------------------------------------------------


def _local(element) -> str:  # noqa: ANN001 - ElementTree element
    """Business purpose: Compare WordprocessingML elements by local tag name across wrapper namespaces.

    Business rules:
    - Strip only the namespace prefix encoded in the XML element tag.
    Execution flow:
    1. Return the tag suffix following the final namespace delimiter.
    Failure cases:
    - Malformed non-string tags propagate normal string-operation errors; XML parsing is validated upstream.
    Side effects:
    - Pure XML metadata projection.
    """
    return element.tag.rsplit("}", 1)[-1]


def _attr(element, name: str):  # noqa: ANN001, ANN202
    """Business purpose: Read a WordprocessingML attribute without mixing it with an unqualified XML field.

    Business rules:
    - Attribute lookup always uses the canonical WordprocessingML namespace.
    Execution flow:
    1. Return the namespaced attribute value or None when absent.
    Failure cases:
    - A missing optional attribute is None; invalid element objects propagate lookup failure.
    Side effects:
    - Read-only XML attribute access.
    """
    return element.get(_W + name)


def _child_val(parent, name: str):  # noqa: ANN001, ANN202
    """Business purpose: Read an optional Word property value without requiring absent layout metadata.

    Business rules:
    - Only the named direct Word child and its namespaced val attribute are considered.
    Execution flow:
    1. Find the optional property child.
    2. Return its value when present, otherwise None.
    Failure cases:
    - Absent parent or child returns None; malformed element access propagates.
    Side effects:
    - Read-only XML metadata retrieval.
    """
    child = parent.find(_W + name) if parent is not None else None
    return _attr(child, "val") if child is not None else None


def _roman(number: int, upper: bool) -> str:
    """Business purpose: Render supported Word list numbers as Roman labels so legal numbering survives extraction.

    Business rules:
    - Use the fixed subtractive Roman symbol table and requested letter case.
    Execution flow:
    1. Consume the number through ordered Roman values.
    2. Return the assembled label in the requested case.
    Failure cases:
    - Nonpositive numbers yield an empty label under the existing renderer; eligibility is determined by numbering metadata.
    Side effects:
    - Pure label formatting; list counters are not changed here.
    """
    pairs = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    out = ""
    for value, symbol in pairs:
        while number >= value:
            out += symbol
            number -= value
    return out.upper() if upper else out


def _letters(number: int, upper: bool) -> str:
    # Word counts a, b, ... z, aa, bb, ... zz, aaa, ...
    """Business purpose: Render Word's repeating alphabetic numbering for extracted legal list labels.

    Business rules:
    - Follow Word's a through z, aa through zz, aaa progression rather than spreadsheet column numbering.
    Execution flow:
    1. Select the repeated letter and repetition count.
    2. Return the label in the requested case.
    Failure cases:
    - Invalid numeric input propagates arithmetic/type errors; this renderer does not validate a numbering scheme.
    Side effects:
    - Pure label formatting; no document or counter mutation.
    """
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
        """Business purpose: Recover list numbering inherited through a Word paragraph style chain.

        Business rules:
        - Use the first style with list metadata and stop when a style repeats to avoid cyclic inheritance.
        Execution flow:
        1. Walk the style and its parents while recording visited identities.
        2. Return list ID, level and defining style, or an empty binding.
        Failure cases:
        - Unrecognized or cyclic style chains without a list return three None values; no numbering is invented.
        Side effects:
        - Read-only style metadata traversal.
        """
        seen = set()
        while style_id and style_id not in seen:
            seen.add(style_id)
            if style_id in self.style_lists:
                num_id, level = self.style_lists[style_id]
                return num_id, level, style_id
            style_id = self.style_parent.get(style_id)
        return None, None, None

    def label(self, paragraph) -> str:  # noqa: ANN001
        """Business purpose: Preserve supported automatic Word numbering as visible legal paragraph labels.

        Business rules:
        - Paragraph numbering overrides style inheritance; disabled, bullet and none formats emit no numeric label.
        - Only supported decimal, letter and Roman formats are rendered; unsupported levels/formats remain extraction gaps.
        Execution flow:
        1. Resolve paragraph or inherited list and level metadata.
        2. Apply initial overrides, advance the current counter and reset deeper levels.
        3. Substitute supported referenced levels into the printed label template.
        Failure cases:
        - Undefined levels or unsupported formats record an unsupported-numbering gap and return an empty label; invalid numeric metadata propagates.
        Side effects:
        - Updates list counters, started-list identities and unsupported-format diagnostics in memory.
        """
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
            """Business purpose: Render one referenced numbering level inside a Word legal label template.

            Business rules:
            - Legal numbering forces decimal rendering; otherwise use the referenced level's supported format and current/start counter.
            Execution flow:
            1. Resolve the template's referenced level.
            2. Record unsupported metadata or format the existing counter value.
            Failure cases:
            - Undefined levels and unsupported formats add a diagnostic and substitute an empty label fragment.
            Side effects:
            - May update unsupported-numbering diagnostics; does not advance list counters.
            """
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
        """Business purpose: Extract visible Word document blocks in source order without duplicating fallback content.

        Business rules:
        - Read paragraphs, tables and supported content wrappers; AlternateContent uses its Choice branch only.
        Execution flow:
        1. Visit ordered child blocks.
        2. Delegate supported paragraphs/tables or recurse through recognized wrappers.
        3. Return the accumulated visible lines.
        Failure cases:
        - Unrecognized block types are omitted by the defined extractor; malformed XML traversal propagates rather than inventing text.
        Side effects:
        - May advance numbering and note state through delegated reads; no stored document mutation.
        """
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
        """Business purpose: Keep legal table rows and cell boundaries visible in extracted Word text.

        Business rules:
        - Collapse whitespace within each cell, separate cells with CELL_SEPARATOR and omit wholly empty rows.
        Execution flow:
        1. Visit supported table rows and extract each cell's visible blocks.
        2. Return nonempty rows with explicit cell separators.
        Failure cases:
        - Empty tables return no lines; malformed cell content propagates delegated extraction errors.
        Side effects:
        - Advances delegated numbering/note state in memory; no source XML changes.
        """
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
        """Business purpose: Include Word table rows nested inside supported content controls.

        Business rules:
        - Yield direct rows and rows directly inside an sdtContent wrapper in document order.
        Execution flow:
        1. Visit table children and yield recognized row elements from direct or supported wrapped positions.
        Failure cases:
        - Missing wrapper content yields no rows; unsupported wrappers are not guessed into table structure.
        Side effects:
        - Read-only XML iteration; no extraction state is changed.
        """
        for child in table:
            if child.tag == _W + "tr":
                yield child
            elif child.tag == _W + "sdt":
                content = child.find(_W + "sdtContent")
                for inner in content if content is not None else []:
                    if inner.tag == _W + "tr":
                        yield inner

    def paragraph(self, paragraph) -> list[str]:  # noqa: ANN001
        """Business purpose: Extract a legal Word paragraph with its numbering, text boxes and referenced notes.

        Business rules:
        - Avoid deleted/moved-from text and fallback branches; text boxes and notes are emitted once through their own readers.
        Execution flow:
        1. Collect visible paragraph text, nested boxes and note references.
        2. Prefix supported automatic numbering.
        3. Append text-box blocks and referenced notes in their collected order.
        Failure cases:
        - Missing visible text remains empty; unsupported numbering is retained as diagnostics by the numbering reader.
        Side effects:
        - Updates numbering counters and emitted-note state through delegated readers; source XML remains unchanged.
        """
        text: list[str] = []
        boxes: list = []
        references: list[tuple[str, str]] = []

        def walk(node) -> None:  # noqa: ANN001
            """Business purpose: Collect visible inline Word text without repeating alternative or removed content.

            Business rules:
            - Tabs and breaks retain token boundaries; text boxes and notes are deferred to separate output.
            - Ignore fallback, paragraph/run properties, deletions and moved-from branches.
            Execution flow:
            1. Visit inline descendants in order.
            2. Accumulate visible characters or record deferred text boxes/note references while skipping excluded branches.
            Failure cases:
            - Unrecognized inline wrappers recurse into their children; absent text contributes an empty string rather than a fabricated value.
            Side effects:
            - Mutates the paragraph's local text, box and reference buffers only.
            """
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
        """Business purpose: Emit a real Word footnote or endnote once with a visible sequential label.

        Business rules:
        - Duplicate or unknown note references produce no text; empty note paragraphs are removed after whitespace normalization.
        Execution flow:
        1. Verify the note is known and not already emitted.
        2. Mark it emitted, advance its note-kind counter and normalize its paragraphs.
        3. Return labeled first text and remaining paragraphs when nonempty.
        Failure cases:
        - Unrecognized/duplicate notes return no lines; a known empty note still remains marked emitted without invented text.
        Side effects:
        - Updates emitted-note identities and note-kind counters in memory.
        """
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
        """Business purpose: Retain real Word note text that has no visible in-document reference.

        Business rules:
        - Use the same one-time emission policy as referenced notes, in stored footnote then endnote order.
        Execution flow:
        1. Visit all stored note identities.
        2. Collect text only for notes not already emitted.
        Failure cases:
        - Previously emitted or empty notes add no lines; no synthetic reference is inserted into the source.
        Side effects:
        - Advances note emission state and counters through the shared note reader.
        """
        lines: list[str] = []
        for kind in ("footnote", "endnote"):
            for note_id in self.notes[kind]:
                lines.extend(self.note(kind, note_id))
        return lines


def _read_part(archive: zipfile.ZipFile, name: str, *, required: bool):  # noqa: ANN202
    # Some Word exporters use Windows separators inside the ZIP; aliases must stay unambiguous.
    """Business purpose: Read one unambiguous, bounded Word XML part from a stored document archive.

    Business rules:
    - Normalize ZIP path separators but reject duplicate aliases; each part must stay within the XML byte limit.
    Execution flow:
    1. Find the requested canonical part and enforce required/unique/size constraints.
    2. Read and parse the XML element tree.
    Failure cases:
    - Missing required parts, duplicate aliases, oversized XML or XML syntax failures raise EXTRACTION_FAILED; missing optional parts return None.
    Side effects:
    - Reads ZIP content in memory; does not extract paths onto the host filesystem.
    """
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
    """Paragraph texts of each real note (separators and continuation notes are layout, not content).

    Business purpose: Recover visible paragraphs of real Word footnotes/endnotes for later one-time emission.

    Business rules:
    - Exclude separators, continuation separators and continuation notices because they are layout, not legal text.
    Execution flow:
    1. Visit real notes and collect their text/tab-separated paragraph fragments.
    2. Return paragraphs keyed by pinned note identity.
    Failure cases:
    - Absent optional note XML returns an empty map; malformed element metadata propagates extraction failure.
    Side effects:
    - Read-only note projection; no numbering or emitted-note state changes.
    """
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
    """Business purpose: Extract legal Word body, numbering, tables and notes with explicit unsupported-numbering gaps.

    Business rules:
    - Require document.xml; optional numbering, styles and note parts follow the same bounded XML-part guards.
    - Unsupported automatic numbering must be reported instead of silently implying complete text.
    Execution flow:
    1. Read required and optional XML parts from the ZIP.
    2. Extract body blocks and then any unreferenced real notes.
    3. Return joined visible text and an explicit numbering gap when recorded.
    Failure cases:
    - Invalid ZIPs become EXTRACTION_FAILED; part/XML failures propagate; unsupported numbering returns a gap rather than an invented label.
    Side effects:
    - Uses in-memory document/read state only; no source or persistent extraction record is changed.
    """
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
    """Business purpose: Recover text from image-bearing PDF pages through the existing legal PDF OCR pipeline.

    Business rules:
    - OCR only the selected page numbers and retain the returned page-number mapping.
    Execution flow:
    1. Write the supplied PDF into an isolated temporary directory.
    2. Run LegalPdfOcr for the requested pages and collect their text.
    Failure cases:
    - Filesystem, OCR runtime or subprocess failures become EXTRACTION_FAILED rather than an empty successful extraction.
    Side effects:
    - Creates and removes a temporary PDF and invokes local OCR tooling; no provider inference or source storage mutation.
    """
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
    """Business purpose: Read legal PDF text with bounded pagination and OCR for image-bearing pages lacking text.

    Business rules:
    - Accept encrypted documents only when the empty password decrypts them; enforce MAX_PDF_PAGES.
    - OCR applies only to text-empty pages with images; genuinely blank pages remain empty for gap reporting.
    Execution flow:
    1. Load the PDF and validate encryption/page limits.
    2. Extract native text from every page.
    3. OCR selected scanned pages and return the page texts with an OCR-used flag.
    Failure cases:
    - Missing parser, invalid/encrypted/oversized PDF or supported parser/OCR failures raise EXTRACTION_FAILED; empty pages are not fabricated.
    Side effects:
    - Reads PDF bytes and may invoke local OCR with temporary files; does not persist extraction state.
    """
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
    """Text of the document, page by page where the format has pages.

    Business purpose: Produce format-aware legal text and explicit extraction gaps for a stored supported document.

    Business rules:
    - Support PDF, DOCX, HTML, plain text and Markdown only; retain page identity for PDFs.
    - Total stripped text must meet MIN_TEXT_CHARACTERS; empty PDF pages and unsupported Word numbering remain explicit gaps.
    Execution flow:
    1. Select the format-specific extractor and normalize visible text.
    2. Record the extraction tool, page count and detected gaps.
    3. Reject insufficient text or return the extracted document.
    Failure cases:
    - Unsupported format raises UNSUPPORTED_MEDIA_TYPE; insufficient text raises NO_EXTRACTABLE_TEXT; extractor failures remain EXTRACTION_FAILED.
    Side effects:
    - May use local PDF/OCR temporary files; returns extraction data for API persistence without modifying stored source bytes.
    """
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
