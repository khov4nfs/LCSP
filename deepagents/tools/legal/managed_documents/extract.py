"""Read the text of one stored document. Supported formats only; anything else is refused by the API first."""

from __future__ import annotations

import re
import unicodedata
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from io import BytesIO
from xml.etree import ElementTree

MEDIA_PDF = "application/pdf"
MEDIA_HTML = "text/html"
MEDIA_TEXT = "text/plain"
MEDIA_MARKDOWN = "text/markdown"
MEDIA_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

MAX_PDF_PAGES = 3000
MAX_DOCX_XML_BYTES = 80 * 1024 * 1024
MIN_TEXT_CHARACTERS = 20

_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_BLOCK_TAGS = {
    "p", "div", "br", "li", "ul", "ol", "tr", "table", "section", "article", "header", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "hr", "dd", "dt",
}
_SKIPPED_TAGS = {"script", "style", "noscript", "template", "head", "svg"}
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ExtractionError(Exception):
    """The document could not be turned into text. ``code`` is a LEGAL_SOURCE_DOCUMENT_FAILURE_CODES value."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ExtractedDocument:
    """Text split into pages (a single page for formats without pages)."""

    pages: list[str]
    page_count: int | None
    tool: str


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


class _HtmlText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001 - html.parser signature
        if tag in _SKIPPED_TAGS:
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(data)

    def text(self) -> str:
        return "".join(self._parts)


def _html_to_text(data: bytes) -> str:
    parser = _HtmlText()
    parser.feed(_decode(data))
    parser.close()
    return parser.text()


def _docx_to_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise ExtractionError("EXTRACTION_FAILED")
            xml = archive.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as error:
        raise ExtractionError("EXTRACTION_FAILED") from error
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as error:
        raise ExtractionError("EXTRACTION_FAILED") from error
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{_WORD_NS}p"):
        pieces: list[str] = []
        for node in paragraph.iter():
            if node.tag == f"{_WORD_NS}t" and node.text:
                pieces.append(node.text)
            elif node.tag in (f"{_WORD_NS}tab", f"{_WORD_NS}br"):
                pieces.append(" " if node.tag.endswith("tab") else "\n")
        paragraphs.append("".join(pieces))
    return "\n".join(paragraphs)


def _pdf_pages(data: bytes) -> list[str]:
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
        return [page.extract_text() or "" for page in reader.pages]
    except ExtractionError:
        raise
    except (PyPdfError, ValueError, KeyError, RecursionError, OSError) as error:
        raise ExtractionError("EXTRACTION_FAILED") from error


def extract_document(media_type: str, data: bytes) -> ExtractedDocument:
    """Text of the document, page by page where the format has pages."""
    if media_type == MEDIA_PDF:
        pages = [clean_text(page) for page in _pdf_pages(data)]
        document = ExtractedDocument(pages, len(pages), "pypdf")
    elif media_type == MEDIA_DOCX:
        document = ExtractedDocument([clean_text(_docx_to_text(data))], None, "docx-xml")
    elif media_type == MEDIA_HTML:
        document = ExtractedDocument([clean_text(_html_to_text(data))], None, "html-text")
    elif media_type in (MEDIA_TEXT, MEDIA_MARKDOWN):
        document = ExtractedDocument([clean_text(_decode(data))], None, "plain-text")
    else:
        raise ExtractionError("UNSUPPORTED_MEDIA_TYPE")
    if sum(len(page.strip()) for page in document.pages) < MIN_TEXT_CHARACTERS:
        raise ExtractionError("NO_EXTRACTABLE_TEXT")
    return document
