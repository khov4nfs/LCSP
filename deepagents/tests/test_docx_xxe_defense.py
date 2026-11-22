"""Test XXE and entity expansion defenses for DOCX extraction tools.

Mandatory security test asserting that XML entity declarations and expansion
attempts are rejected by defusedxml rather than expanded by stdlib ElementTree.
"""

from __future__ import annotations

import io
import zipfile
import pytest
from defusedxml.common import DefusedXmlException

from tools.legal.managed_documents.extract import ExtractionError, _read_part
from tools.legal.sources.extraction.official_text_extraction import _extract_docx_paragraphs
from tools.legal.sources.scripts.crawl_congbao_docx import extract_docx_paragraphs as crawl_extract_docx_paragraphs


def _create_malicious_docx_with_entity() -> bytes:
    """Create an in-memory DOCX archive containing an XML entity declaration (XXE/Billion laughs vector)."""
    malicious_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<!DOCTYPE w:document [\n'
        '  <!ENTITY injected "MALICIOUS_ENTITY_EXPANSION">\n'
        ']>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
        '  <w:body>\n'
        '    <w:p>\n'
        '      <w:r>\n'
        '        <w:t>&injected;</w:t>\n'
        '      </w:r>\n'
        '    </w:p>\n'
        '  </w:body>\n'
        '</w:document>'
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", malicious_xml)
    return buffer.getvalue()


def test_official_text_extraction_rejects_xxe_entity():
    """Verify official_text_extraction._extract_docx_paragraphs refuses XML entity injection."""
    docx_bytes = _create_malicious_docx_with_entity()
    with pytest.raises(DefusedXmlException):
        _extract_docx_paragraphs(docx_bytes)


def test_crawl_congbao_docx_rejects_xxe_entity():
    """Verify crawl_congbao_docx.extract_docx_paragraphs refuses XML entity injection."""
    docx_bytes = _create_malicious_docx_with_entity()
    with pytest.raises(DefusedXmlException):
        crawl_extract_docx_paragraphs(docx_bytes)


def test_managed_documents_extract_rejects_xxe_entity():
    """Verify managed_documents._read_part refuses XML entity injection with ExtractionError."""
    docx_bytes = _create_malicious_docx_with_entity()
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as archive:
        with pytest.raises(ExtractionError):
            _read_part(archive, "word/document.xml", required=True)
