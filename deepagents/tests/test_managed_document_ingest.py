"""Managed Legal Source document ingestion: extraction, structure profiles, the boundary hand-off.

Provider-free and network-free. Documents are synthetic; nothing here names a real instrument.
"""

from __future__ import annotations

import re
import zipfile
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.common.capabilities.agent_runtime.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.agent_runtime.invocation import AGENT_INVOCATION_BOUNDARIES
from tools.legal.managed_documents.boundary import (
    LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
    ManagedDocumentIngestBoundary,
)
from tools.legal.managed_documents.chunker import (
    CONFIG_PATH,
    UnknownStructureProfile,
    chunk_document,
    load_profiles,
    sha256_ref,
)
from tools.legal.managed_documents.client import IngestionApiError, StoredOriginal
from tools.legal.managed_documents.extract import (
    MEDIA_DOCX,
    MEDIA_HTML,
    MEDIA_PDF,
    MEDIA_TEXT,
    ExtractionError,
    extract_document,
)
from tools.legal.managed_documents.ingest import ingest_document

STATUTE = """\
QUỐC HỘI
Luật số 99/2099/QH99

Chương I
QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh
Luật này quy định về việc mẫu.
Điều 2. Nghĩa vụ chung
Tổ chức thực hiện phải:
1. Lập hồ sơ theo mẫu và lưu giữ hồ sơ đó.
a) Hồ sơ phải đầy đủ;
b) Hồ sơ phải đúng hạn.
2. Báo cáo định kỳ theo quy định tại Điều 1 của Luật này.
Điều 3. Hiệu lực
Luật này có hiệu lực từ ngày ký.
"""

ENGLISH = """\
Preamble words that precede any heading.
Article 1. Scope
This Act applies to samples.
Article 2: Duties
1. Keep records.
2. Report yearly.
Article 3 - Entry into force
Applies from signature.
"""

OUTLINE = """\
Intro text before the outline.
1 Purpose
Why this exists.
1.1 Background
Some background.
2 Rules
The rules apply.
2.1 Records
Keep records.
"""


def locators(result) -> list[str]:
    return [chunk["locator"] for chunk in result.chunks]


class TestHeadingTreeProfile:
    def test_splits_articles_and_clauses_with_hierarchy(self):
        result = chunk_document([STATUTE], profile="ARTICLES")

        assert result.profile == "ARTICLES"
        assert locators(result) == ["art-1", "art-2", "art-2::cl-1", "art-2::cl-2", "art-3"]
        by_locator = {chunk["locator"]: chunk for chunk in result.chunks}
        clause = by_locator["art-2::cl-1"]
        assert clause["hierarchy"] == {
            "chapterNumber": "I",
            "chapterTitle": "QUY ĐỊNH CHUNG",
            "articleNumber": "2",
            "articleTitle": "Nghĩa vụ chung",
            "clauseNumber": "1",
        }
        # Points stay inside their clause; the cross-reference line does not open a new article.
        assert "b) Hồ sơ phải đúng hạn." in clause["content"]
        assert "Điều 1 của Luật này" in by_locator["art-2::cl-2"]["content"]
        # The article keeps its own lead-in as a non-leaf chunk above its clauses.
        assert by_locator["art-2"]["content"].endswith("phải:")

    def test_front_matter_is_counted_but_not_chunked(self):
        result = chunk_document([STATUTE], profile="ARTICLES")
        assert result.front_matter_characters > 0
        assert all("QUỐC HỘI" not in chunk["content"] for chunk in result.chunks)

    def test_hashes_are_of_the_exact_stored_text(self):
        result = chunk_document([STATUTE], profile="ARTICLES")
        for chunk in result.chunks:
            assert chunk["contentSha256"] == sha256_ref(chunk["content"])

    def test_headings_come_from_configuration_not_code(self):
        result = chunk_document([ENGLISH], profile="ARTICLES")
        assert locators(result) == ["art-1", "art-2", "art-2::cl-1", "art-2::cl-2", "art-3"]
        assert result.chunks[0]["hierarchy"]["articleTitle"] == "Scope"

    def test_only_the_next_clause_number_opens_a_clause(self):
        text = "Article 1. Scope\n1. First.\n3. Not the next clause.\n2. Second.\n"
        result = chunk_document([text], profile="ARTICLES")
        by_locator = {chunk["locator"]: chunk["content"] for chunk in result.chunks}
        assert sorted(by_locator) == ["art-1", "art-1::cl-1", "art-1::cl-2"]
        assert "3. Not the next clause." in by_locator["art-1::cl-1"]

    def test_a_repeated_heading_keeps_its_text_under_a_distinct_locator(self):
        text = "Article 1. Scope\nfirst body\nArticle 1. Scope again\nsecond body\n"
        result = chunk_document([text], profile="ARTICLES")
        assert locators(result) == ["art-1", "art-1::dup-2"]
        assert "second body" in result.chunks[1]["content"]


class TestOtherProfiles:
    def test_numbered_sections_nest_by_number(self):
        result = chunk_document([OUTLINE], profile="NUMBERED_SECTIONS")
        assert locators(result) == [
            "sec-1",
            "sec-1::sec-1.1",
            "sec-2",
            "sec-2::sec-2.1",
        ]
        assert result.front_matter_characters > 0

    def test_paragraph_windows_cover_all_text_and_carry_pages(self):
        pages = ["alpha " * 400, "beta " * 400, "gamma " * 400]
        result = chunk_document(pages, profile="PARAGRAPHS")
        assert result.profile == "PARAGRAPHS"
        assert all(len(chunk["content"]) <= load_profiles()["maxChunkCharacters"] for chunk in result.chunks)
        assert result.chunks[0]["pageStart"] == 1
        assert result.chunks[-1]["pageEnd"] == 3

    def test_auto_picks_the_first_profile_with_enough_headings_else_paragraphs(self):
        assert chunk_document([STATUTE], profile="AUTO").profile == "ARTICLES"
        assert chunk_document([OUTLINE], profile="AUTO").profile == "NUMBERED_SECTIONS"
        plain = chunk_document(["just some words\nwith no structure at all\n"], profile="AUTO")
        assert plain.profile == "PARAGRAPHS"
        assert plain.chunks

    def test_a_structured_profile_with_no_structure_still_keeps_the_text(self):
        result = chunk_document(["nothing that looks like a heading here\n"], profile="ARTICLES")
        assert result.profile == "PARAGRAPHS"
        assert result.chunks[0]["content"].startswith("nothing")

    def test_unknown_profile_is_refused(self):
        with pytest.raises(UnknownStructureProfile):
            chunk_document(["x"], profile="NOT_A_PROFILE")

    def test_an_oversized_provision_is_split_into_parts_that_keep_its_ancestry(self):
        long_clause = "Article 1. Scope\n1. " + "word " * 3000 + "\n"
        result = chunk_document([long_clause], profile="ARTICLES")
        parts = [loc for loc in locators(result) if "::part-" in loc]
        assert len(parts) >= 2
        assert all(loc.startswith("art-1::cl-1::part-") for loc in parts)
        assert all(
            chunk["hierarchy"].get("partOf") == "art-1::cl-1"
            for chunk in result.chunks
            if "::part-" in chunk["locator"]
        )

    def test_markdown_heading_markers_do_not_hide_numbered_sections(self):
        result = chunk_document(["# 1 Purpose\ntext\n## 1.1 Detail\nmore\n# 2 Rules\nx\n"], profile="NUMBERED_SECTIONS", markdown=True)
        assert locators(result) == ["sec-1", "sec-1::sec-1.1", "sec-2"]


def minimal_pdf(lines: list[str]) -> bytes:
    """A one-page PDF with a Helvetica text layer, built by hand (no PDF writer needed)."""
    stream = "BT /F1 12 Tf 14 TL 50 750 Td " + " T* ".join(f"({line}) Tj" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body = b"%PDF-1.4\n"
    offsets = []
    for number, content in enumerate(objects, start=1):
        offsets.append(len(body))
        body += f"{number} 0 obj\n{content}\nendobj\n".encode()
    xref = len(body)
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        body += f"{offset:010d} 00000 n \n".encode()
    body += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return body


def minimal_docx(paragraphs: list[str]) -> bytes:
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f'<w:p><w:r><w:t xml:space="preserve">{p}</w:t></w:r></w:p>' for p in paragraphs)
    xml = f'<?xml version="1.0"?><w:document xmlns:w="{ns}"><w:body>{body}</w:body></w:document>'
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return buffer.getvalue()


class TestExtraction:
    def test_pdf_text_layer_is_read(self):
        pdf = minimal_pdf(["Article 1. Scope", "This Act applies to samples.", "Article 2. Duties", "Keep records."])
        document = extract_document(MEDIA_PDF, pdf)
        assert document.page_count == 1
        assert "Article 1. Scope" in document.pages[0]
        assert document.tool == "pypdf"

    def test_a_pdf_without_a_text_layer_is_reported_not_guessed(self):
        with pytest.raises(ExtractionError) as raised:
            extract_document(MEDIA_PDF, minimal_pdf([]))
        assert raised.value.code == "NO_EXTRACTABLE_TEXT"

    def test_a_corrupt_pdf_is_an_extraction_failure(self):
        with pytest.raises(ExtractionError) as raised:
            extract_document(MEDIA_PDF, b"%PDF-1.7 this is not a pdf")
        assert raised.value.code == "EXTRACTION_FAILED"

    def test_docx_paragraphs_are_read(self):
        document = extract_document(MEDIA_DOCX, minimal_docx(["Article 1. Scope", "Applies to samples and more."]))
        assert document.pages == ["Article 1. Scope\nApplies to samples and more."]

    def test_a_docx_that_is_not_a_zip_is_an_extraction_failure(self):
        with pytest.raises(ExtractionError) as raised:
            extract_document(MEDIA_DOCX, b"PK\x03\x04 broken")
        assert raised.value.code == "EXTRACTION_FAILED"

    def test_html_text_keeps_blocks_and_drops_scripts(self):
        html = (
            b"<html><head><title>t</title><style>x{}</style></head><body>"
            b"<h1>Article 1. Scope</h1><p>Applies &amp; binds.</p><script>alert(1)</script>"
            b"<p>Second paragraph here.</p></body></html>"
        )
        text = extract_document(MEDIA_HTML, html).pages[0]
        assert "alert" not in text and "x{}" not in text
        assert "Applies & binds." in text
        assert text.index("Article 1. Scope") < text.index("Second paragraph")

    def test_text_is_nfc_and_free_of_control_characters(self):
        decomposed = "Phạm vi".replace("ạ", "ạ") + "\x00 hết\r\nDòng hai kéo dài đủ ký tự"
        text = extract_document(MEDIA_TEXT, decomposed.encode()).pages[0]
        assert "\x00" not in text and "\r" not in text
        assert "Phạm" in text

    def test_an_unsupported_type_is_refused(self):
        with pytest.raises(ExtractionError) as raised:
            extract_document("application/zip", b"anything long enough to read")
        assert raised.value.code == "UNSUPPORTED_MEDIA_TYPE"


class TestIngestResult:
    def test_ready_result_has_the_contract_shape(self):
        result = ingest_document(data=STATUTE.encode(), media_type=MEDIA_TEXT, structure_profile="AUTO", attempt=3)

        assert result["outcome"] == "READY" and result["attempt"] == 3
        assert set(result["extraction"]) == {
            "tool",
            "toolVersion",
            "structureProfile",
            "pageCount",
            "textSha256",
            "characterCount",
            "frontMatterCharacters",
            "pages",
        }
        assert result["extraction"]["structureProfile"] == "ARTICLES"
        assert set(result["chunks"][0]) == {
            "locator",
            "content",
            "contentSha256",
            "hierarchy",
            "pageStart",
            "pageEnd",
        }

    def test_document_problems_become_failure_codes(self):
        assert ingest_document(data=b"x" * 5, media_type=MEDIA_TEXT, structure_profile="AUTO", attempt=1) == {
            "outcome": "FAILED",
            "attempt": 1,
            "failureCode": "NO_EXTRACTABLE_TEXT",
        }
        assert ingest_document(data=b"x" * 50, media_type="image/png", structure_profile="AUTO", attempt=2)[
            "failureCode"
        ] == "UNSUPPORTED_MEDIA_TYPE"
        assert ingest_document(data=STATUTE.encode(), media_type=MEDIA_TEXT, structure_profile="BOGUS", attempt=1)[
            "failureCode"
        ] == "EXTRACTION_FAILED"

    def test_configured_profile_names_match_the_contract_value_set(self):
        # The API contract accepts exactly these ids; the runtime must define each of them.
        assert set(load_profiles()["profiles"]) == {"ARTICLES", "NUMBERED_SECTIONS", "PARAGRAPHS"}
        assert CONFIG_PATH.exists()


MESSAGE = {"documentRowId": "5e3a4a0c-0a3e-4a86-9b88-1f0c3b9a8e11", "attempt": 2}


class FakeClient:
    def __init__(self, *, original=None, fetch_error=None, post_errors=None):
        self.original = original or StoredOriginal(STATUTE.encode(), MEDIA_TEXT, "AUTO")
        self.fetch_error = fetch_error
        self.post_errors = list(post_errors or [])
        self.posted: list[dict] = []

    def fetch_original(self, document_row_id, attempt):
        if self.fetch_error:
            raise self.fetch_error
        return self.original

    def post_result(self, document_row_id, result):
        self.posted.append(result)
        if self.post_errors:
            raise self.post_errors.pop(0)
        return {"applied": True, "state": result["outcome"]}


def boundary(client):
    config = SimpleNamespace(nestjs_api_base_url="http://api", worker_api_key="k")
    return ManagedDocumentIngestBoundary(config, client=client)


class TestBoundary:
    def test_is_registered_for_its_command(self):
        entries = [b for b in AGENT_INVOCATION_BOUNDARIES if b.source_event == LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND]
        assert len(entries) == 1
        assert entries[0].target.endswith("ManagedDocumentIngestBoundary")
        assert ManagedDocumentIngestBoundary.source_event == LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND

    def test_ingests_and_posts_the_result_for_the_requested_attempt(self):
        client = FakeClient()
        outcome = boundary(client).handle(MESSAGE, "corr")
        assert outcome == {"state": "READY", "applied": True}
        assert client.posted[0]["attempt"] == 2 and client.posted[0]["outcome"] == "READY"

    def test_a_bad_command_is_not_retried(self):
        for message in ({}, {"documentRowId": "nope", "attempt": 1}, {**MESSAGE, "attempt": 0}, {**MESSAGE, "attempt": "1"}):
            with pytest.raises(NonRetryableAgentBoundaryError):
                boundary(FakeClient()).handle(message, "corr")

    def test_a_stale_or_settled_delivery_is_skipped(self):
        client = FakeClient(fetch_error=IngestionApiError(409, "LEGAL_SOURCE_DOCUMENT_NOT_RETRYABLE"))
        assert boundary(client).handle(MESSAGE, "corr") == {
            "state": "SKIPPED",
            "reason": "LEGAL_SOURCE_DOCUMENT_NOT_RETRYABLE",
        }
        assert client.posted == []

    def test_a_server_error_is_left_to_the_queue_to_redeliver(self):
        with pytest.raises(IngestionApiError):
            boundary(FakeClient(fetch_error=IngestionApiError(503, "HTTP_503"))).handle(MESSAGE, "corr")

    def test_a_rejected_request_is_terminal(self):
        with pytest.raises(NonRetryableAgentBoundaryError):
            boundary(FakeClient(fetch_error=IngestionApiError(403, "FORBIDDEN"))).handle(MESSAGE, "corr")

    def test_a_document_that_cannot_be_read_is_recorded_as_failed_not_lost(self):
        client = FakeClient(original=StoredOriginal(b"%PDF-1.7 broken", MEDIA_PDF, "AUTO"))
        assert boundary(client).handle(MESSAGE, "corr") == {"state": "FAILED", "applied": True}
        assert client.posted == [{"outcome": "FAILED", "attempt": 2, "failureCode": "EXTRACTION_FAILED"}]

    def test_a_result_the_api_refuses_is_recorded_as_a_failed_document(self):
        client = FakeClient(post_errors=[IngestionApiError(422, "LEGAL_SOURCE_INGESTION_RESULT_INVALID")])
        boundary(client).handle(MESSAGE, "corr")
        assert [p["outcome"] for p in client.posted] == ["READY", "FAILED"]

    def test_a_parser_crash_settles_as_a_failed_document(self, monkeypatch):
        import tools.legal.managed_documents.boundary as module

        monkeypatch.setattr(module, "ingest_document", lambda **_: (_ for _ in ()).throw(RuntimeError("boom")))
        client = FakeClient()
        boundary(client).handle(MESSAGE, "corr")
        assert client.posted[0]["failureCode"] == "EXTRACTION_FAILED"


class TestLawAgnostic:
    """What the platform reasons over is data an administrator manages, never code."""

    IDENTITY = re.compile(r"\b\d{1,4}[-/]\d{4}[-/][A-Z]{2,}\d*\b|VN-LEGAL|vbpl\.vn|congbao|Quốc hội", re.IGNORECASE)

    def test_managed_ingestion_code_names_no_instrument(self):
        package = Path(__file__).resolve().parents[1] / "tools" / "legal" / "managed_documents"
        for file in sorted(package.glob("*.py")):
            assert not self.IDENTITY.search(file.read_text(encoding="utf-8")), file.name

    def test_structure_profiles_define_headings_not_instruments(self):
        text = CONFIG_PATH.read_text(encoding="utf-8")
        assert not self.IDENTITY.search(text)


def test_architecture_acceptance_pdf_matches_provider_free_extraction_receipt():
    import json
    fixture = Path(__file__).resolve().parents[2] / "tests/fixtures/legal-graph"
    actual = ingest_document(data=(fixture / "source.pdf").read_bytes(), media_type="application/pdf", structure_profile="ARTICLES", attempt=1)
    assert actual == json.loads((fixture / "extraction.json").read_text())
    assert actual["extraction"]["pageCount"] == 3
