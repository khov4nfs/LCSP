"""Corpus representation (INV-R1, INV-R5): lossless chunk partition and honest extraction.

Provider-free and network-free. Every document here is synthetic or taken from the frozen portfolio oracle
(read-only); nothing names a real instrument. The partition property is asserted for every profile and every
portfolio text, with a negative control proving the checker itself can fail.
"""

from __future__ import annotations

import json
import re
import zipfile
from collections import Counter
from io import BytesIO
from pathlib import Path

import pytest

from tools.legal.managed_documents.chunker import (
    LOCATOR_SEPARATOR,
    _cut_line,
    chunk_document,
    load_profiles,
    sha256_ref,
    to_lines,
)
from tools.legal.managed_documents.extract import (
    CELL_SEPARATOR,
    GAP_NO_TEXT_LAYER,
    GAP_UNSUPPORTED_NUMBERING,
    MEDIA_DOCX,
    MEDIA_HTML,
    MEDIA_MARKDOWN,
    MEDIA_PDF,
    MEDIA_TEXT,
    ExtractionError,
    extract_document,
)
from tools.legal.managed_documents.ingest import ingest_document

ROOT = Path(__file__).resolve().parents[2]
ORACLE = ROOT / "reports/lcsp360-semantic-convergence/corpus-agnostic-20261020/portfolio/portfolio-oracle.json"
SYNTHETIC = ROOT / "tests/fixtures/legal-graph/source.json"
PROFILES = ["AUTO", "ARTICLES", "NUMBERED_SECTIONS", "PARAGRAPHS"]

POLICY = (
    "Data Retention Policy\n1. Purpose\nThis policy sets retention rules.\n2. Scope\nThis policy applies to all staff.\n"
    "3. Rules\n1. Staff must delete customer records after 30 days.\n2. Staff must not copy records to personal devices.\n"
    "4. Exceptions\n1. Legal hold suspends deletion.\n"
)
STATUTE = (
    "THE DATA ACT\nPreamble: Whereas operators process data, this Act is adopted.\nChapter I\nGeneral provisions\n"
    "This Chapter applies only to operators established in the territory.\nArticle 1. Definitions\n"
    "An operator is any person who runs a covered service.\nArticle 2. Duty\n1. The operator must keep a log.\n"
    "2. The operator must not sell the log.\nArticle 3. Exception\nSmall operators are exempt from Article 2(1).\n"
)


# ----------------------------------------------------------------------------------------- helpers


def normalised(text: str, *, markdown: bool = False) -> list[str]:
    return [line.text for line in to_lines([text], strip_markdown_markers=markdown)]


def chunk_lines(chunks) -> list[str]:  # noqa: ANN001
    return [line for chunk in chunks for line in chunk["content"].split("\n")]


def partition_defects(source: list[str], chunks) -> dict[str, list[str]]:  # noqa: ANN001
    """Lines the chunks lost or invented (multiset difference in both directions)."""
    expected, actual = Counter(source), Counter(chunk_lines(chunks))
    return {"missing": list((expected - actual).elements()), "extra": list((actual - expected).elements())}


def portfolio_texts() -> dict[str, tuple[str, bool]]:
    """Plain-text rendering of every oracle item that has a text, keyed by item id (markdown flag second)."""
    if not ORACLE.exists():
        return {}
    texts: dict[str, tuple[str, bool]] = {}
    for item in json.loads(ORACLE.read_text(encoding="utf-8"))["items"]:
        text = item.get("text")
        if not text or item["format"] == "text/html":
            continue
        texts[item["id"]] = (text.replace("[TABLE] ", ""), item["format"] == "text/markdown")
    return texts


def synthetic_text() -> str:
    return "\n".join(json.loads(SYNTHETIC.read_text(encoding="utf-8"))["pages"])


# ------------------------------------------------------------------- A1: lossless chunk partition


class TestLosslessPartition:
    @pytest.mark.parametrize("profile", PROFILES)
    @pytest.mark.parametrize("name", ["policy", "statute", "synthetic-instrument", *sorted(portfolio_texts())])
    def test_every_line_belongs_to_exactly_one_chunk(self, name, profile):
        if name == "policy":
            text, markdown = POLICY, False
        elif name == "statute":
            text, markdown = STATUTE, False
        elif name == "synthetic-instrument":
            text, markdown = synthetic_text(), False
        else:
            text, markdown = portfolio_texts()[name]
        source = normalised(text, markdown=markdown)
        result = chunk_document([text], profile=profile, markdown=markdown)

        assert partition_defects(source, result.chunks) == {"missing": [], "extra": []}
        # Chunks are emitted in document order, so the concatenation reproduces the line sequence exactly.
        assert chunk_lines(result.chunks) == source
        locators = [chunk["locator"] for chunk in result.chunks]
        assert len(locators) == len(set(locators)), "locators must be unique"
        assert all(chunk["content"].strip() for chunk in result.chunks)
        assert all(chunk["contentSha256"] == sha256_ref(chunk["content"]) for chunk in result.chunks)

    def test_the_checker_can_fail(self):
        result = chunk_document([POLICY], profile="NUMBERED_SECTIONS")
        source = normalised(POLICY)
        assert partition_defects(source, result.chunks[:-1])["missing"] == ["1. Legal hold suspends deletion."]
        assert partition_defects(source, [*result.chunks, result.chunks[0]])["extra"], "a duplicated chunk is a defect too"

    def test_a_pages_list_is_partitioned_like_its_joined_text(self):
        pages = ["Front matter line\nArticle 1. One\nbody one", "continues here\nArticle 2. Two\nbody two"]
        result = chunk_document(pages, profile="ARTICLES")
        assert partition_defects([line.text for line in to_lines(pages)], result.chunks) == {"missing": [], "extra": []}
        assert (result.chunks[1]["pageStart"], result.chunks[1]["pageEnd"]) == (1, 2)

    # --- (a) numbered sections that repeat a number keep their body -----------------------------------

    def test_repeated_section_numbers_keep_every_body_under_dup_locators(self):
        result = chunk_document([POLICY], profile="NUMBERED_SECTIONS")
        by_locator = {chunk["locator"]: chunk["content"] for chunk in result.chunks}
        assert [chunk["locator"] for chunk in result.chunks] == [
            "front-matter",
            "sec-1",
            "sec-2",
            "sec-3",
            "sec-1::dup-2",
            "sec-2::dup-2",
            "sec-4",
            "sec-1::dup-3",
        ]
        assert by_locator["sec-1::dup-2"] == "1. Staff must delete customer records after 30 days."
        assert by_locator["sec-2::dup-2"] == "2. Staff must not copy records to personal devices."
        assert by_locator["sec-1::dup-3"] == "1. Legal hold suspends deletion."

    def test_a_distinct_numbering_is_unchanged(self):
        outline = "1 Purpose\ntext\n1.1 Detail\nmore\n2 Rules\nx\n"
        result = chunk_document([outline], profile="NUMBERED_SECTIONS")
        assert [c["locator"] for c in result.chunks] == ["sec-1", "sec-1::sec-1.1", "sec-2"]

    # --- (b) chapter heading and the text before the first article -----------------------------------

    def test_a_chapter_heading_and_its_introduction_become_a_chapter_chunk(self):
        result = chunk_document([STATUTE], profile="ARTICLES")
        by_locator = {chunk["locator"]: chunk for chunk in result.chunks}
        chapter = by_locator["chap-i"]
        assert chapter["content"] == "Chapter I\nGeneral provisions\nThis Chapter applies only to operators established in the territory."
        assert chapter["hierarchy"] == {"chapterNumber": "I", "chapterTitle": "General provisions"}
        assert [chunk["locator"] for chunk in result.chunks][:3] == ["front-matter", "chap-i", "art-1"]
        # the chapter that has no text of its own still keeps its heading line
        bare = chunk_document(["Chapter II\nArticle 1. One\nbody\n"], profile="ARTICLES")
        assert bare.chunks[0]["locator"] == "chap-ii" and bare.chunks[0]["content"] == "Chapter II"

    @pytest.mark.parametrize("heading", ["Chapter I.", "Chapter I — General", "Chapter I: General", "Part 1 – General", "Chương I: QUY ĐỊNH CHUNG"])
    def test_a_delimited_chapter_heading_opens_a_chapter_chunk(self, heading):
        result = chunk_document([f"{heading}\nArticle 1. One\nbody\n"], profile="ARTICLES")
        assert result.chunks[0]["locator"].startswith("chap-")
        assert result.chunks[0]["content"].startswith(heading.split(" ")[0])

    def test_the_same_chapter_number_in_two_parts_stays_distinct(self):
        text = "Part 1\nChapter I\nArticle 1. One\nx\nPart 2\nChapter I\nArticle 2. Two\ny\n"
        result = chunk_document([text], profile="ARTICLES")
        locators = [c["locator"] for c in result.chunks]
        assert len(locators) == len(set(locators))
        assert partition_defects(normalised(text), result.chunks) == {"missing": [], "extra": []}

    # --- (c) front matter -----------------------------------------------------------------------------

    def test_front_matter_is_a_chunk_and_still_counted(self):
        result = chunk_document([STATUTE], profile="ARTICLES")
        front = result.chunks[0]
        assert front["locator"] == "front-matter"
        assert front["content"] == "THE DATA ACT\nPreamble: Whereas operators process data, this Act is adopted."
        assert result.front_matter_characters == sum(len(line) + 1 for line in front["content"].split("\n"))

    def test_there_is_no_front_matter_chunk_when_the_text_starts_with_a_heading(self):
        result = chunk_document(["Article 1. One\nbody\nArticle 2. Two\nbody\n"], profile="ARTICLES")
        assert all(chunk["locator"] != "front-matter" for chunk in result.chunks)
        assert result.front_matter_characters == 0

    def test_a_structured_profile_without_structure_still_keeps_everything_once(self):
        text = "nothing that looks like a heading\nsecond line\n"
        for profile in ("ARTICLES", "NUMBERED_SECTIONS"):
            result = chunk_document([text], profile=profile)
            assert result.profile == "PARAGRAPHS"
            assert partition_defects(normalised(text), result.chunks) == {"missing": [], "extra": []}

    def test_locators_of_repeated_headings_never_collide(self):
        text = "Article 1. A\nx\nArticle 1. B\ny\nArticle 1. C\nz\n"
        locators = [c["locator"] for c in chunk_document([text], profile="ARTICLES").chunks]
        assert locators == ["art-1", "art-1::dup-2", "art-1::dup-3"]

    # --- G1 on the Python side: prose is not a heading ------------------------------------------------

    @pytest.mark.parametrize(
        "prose",
        [
            "Part 1 does not limit any other obligation of an operator.",
            "Chapter 2 applies only to large operators.",
            "Part of the data is stored abroad.",
            "Section 4.1 Content of the plan",
        ],
    )
    def test_prose_that_starts_with_a_structural_word_does_not_split_an_article(self, prose):
        text = f"Article 1. One\nfirst line\n{prose}\nlast line\nArticle 2. Two\nbody\n"
        result = chunk_document([text], profile="ARTICLES")
        assert [c["locator"] for c in result.chunks] == ["art-1", "art-2"]
        assert prose in result.chunks[0]["content"] and "last line" in result.chunks[0]["content"]

    def test_a_dotted_number_is_not_an_article_number(self):
        text = "Article 4. Capacity\nbody\nSection 4.1 Content of the plan\nmore\nArticle 7. Audits\nx\n"
        assert [c["locator"] for c in chunk_document([text], profile="ARTICLES").chunks] == ["art-4", "art-7"]

    # --- oversized single lines -----------------------------------------------------------------------

    def test_an_oversized_line_is_cut_at_whitespace_and_reassembles(self):
        line = " ".join(f"word{index}" for index in range(2000))
        pieces = _cut_line(line, 6000)
        assert len(pieces) > 1 and all(len(piece) <= 6000 for piece in pieces)
        assert " ".join(pieces) == line
        assert all(not piece.startswith(" ") and not piece.endswith(" ") for piece in pieces)
        # no word was cut: every piece starts and ends on a token boundary of the original line
        assert [token for piece in pieces for token in piece.split(" ")] == line.split(" ")

    def test_a_token_longer_than_the_bound_is_hard_cut_without_splitting_a_combining_mark(self):
        text = "a" + "é" * 4000  # 8001 characters without whitespace
        pieces = _cut_line(text, 6000)
        assert "".join(pieces) == text and all(len(piece) <= 6000 for piece in pieces)
        assert all(not piece[0] == "́" for piece in pieces)

    def test_other_lines_stay_whole_when_one_line_is_cut(self):
        long_line = "1. " + " ".join(["clause"] * 2000)  # far beyond the chunk bound
        others = ["Article 1. Scope", "short before", "short after", "Article 2. Next", "body"]
        text = f"Article 1. Scope\nshort before\n{long_line}\nshort after\nArticle 2. Next\nbody\n"
        result = chunk_document([text], profile="ARTICLES")
        bound = load_profiles()["maxChunkCharacters"]
        pieces = [c for c in result.chunks if len(c["content"]) > 500]  # text of the cut line only
        assert len(pieces) >= 3 and all(len(c["content"]) <= bound for c in result.chunks)
        assert all("::part-" in c["locator"] for c in pieces)
        assert " ".join(c["content"] for c in pieces) == long_line
        rest = [line for c in result.chunks if c not in pieces for line in c["content"].split("\n")]
        assert Counter(rest) == Counter(others)


# ----------------------------------------------------------------- E1: extraction honesty (HTML)


class TestHtmlTables:
    def test_cells_of_a_row_are_separated_and_rows_are_lines(self):
        html = (
            b"<html><body><p>Fee schedule</p><table><tr><th>Service</th><th>Fee</th></tr>"
            b"<tr><td>Export</td><td>100</td></tr></table><p>After</p></body></html>"
        )
        text = extract_document(MEDIA_HTML, html).pages[0]
        lines = [line for line in text.split("\n") if line.strip()]
        assert lines == ["Fee schedule", f"Service{CELL_SEPARATOR}Fee", f"Export{CELL_SEPARATOR}100", "After"]
        assert "Export100" not in text and "ServiceFee" not in text

    def test_block_markup_and_whitespace_inside_a_cell_stay_on_the_row(self):
        html = b"<table><tr><td><p>Data</p>\n  <p>hosting</p></td><td>1,000\n units</td></tr></table>"
        assert [l for l in extract_document(MEDIA_HTML, html + b"<p>padding text</p>").pages[0].split("\n") if l.strip()] == [
            f"Data hosting{CELL_SEPARATOR}1,000 units",
            "padding text",
        ]

    def test_omitted_closing_tags_do_not_glue_or_swallow_rows(self):
        html = b"<table><tr><td>a<td>b<tr><td>c<td>d</table><p>after the table</p>"
        lines = [l for l in extract_document(MEDIA_HTML, html).pages[0].split("\n") if l.strip()]
        assert lines == [f"a{CELL_SEPARATOR}b", f"c{CELL_SEPARATOR}d", "after the table"]

    def test_an_empty_cell_keeps_its_column(self):
        html = b"<table><tr><td>left</td><td></td><td>right</td></tr></table><p>padding to be long enough</p>"
        assert f"left{CELL_SEPARATOR}{CELL_SEPARATOR}right" in extract_document(MEDIA_HTML, html).pages[0]

    def test_a_nested_table_stays_in_its_cell(self):
        html = b"<table><tr><td>outer<table><tr><td>x</td><td>y</td></tr></table></td><td>z</td></tr></table><p>padding to be long enough</p>"
        lines = [l for l in extract_document(MEDIA_HTML, html).pages[0].split("\n") if l.strip()]
        assert lines[0].endswith(f"{CELL_SEPARATOR}z") and lines[0].startswith("outer")

    def test_text_outside_tables_is_unchanged(self):
        html = b"<h1>Article 1. Scope</h1><p>Applies &amp; binds.</p><p>Second paragraph here.</p>"
        assert extract_document(MEDIA_HTML, html).pages[0].split() == ["Article", "1.", "Scope", "Applies", "&", "binds.", "Second", "paragraph", "here."]


# ------------------------------------------------------------------- E1: extraction honesty (PDF)


def pdf_with_pages(pages: list[list[str] | None]) -> bytes:
    """A PDF whose page i has the given text lines, or no text layer at all when None."""
    count = len(pages)
    kids = " ".join(f"{4 + 2 * index} 0 R" for index in range(count))
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {count} >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for index, lines in enumerate(pages):
        stream = "" if not lines else "BT /F1 12 Tf 14 TL 50 750 Td " + " T* ".join(f"({line}) Tj" for line in lines) + " ET"
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {5 + 2 * index} 0 R "
            "/Resources << /Font << /F1 3 0 R >> >> >>"
        )
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
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


FIRST_PAGE = ["Article 1. Scope", "This Act applies to samples."]
THIRD_PAGE = ["Article 2. Duties", "Keep records."]


class TestPdfGaps:
    def test_a_page_without_a_text_layer_is_reported_exactly(self):
        document = extract_document(MEDIA_PDF, pdf_with_pages([FIRST_PAGE, None, THIRD_PAGE]))
        assert document.page_count == 3
        assert document.gaps == [{"page": 2, "kind": GAP_NO_TEXT_LAYER}]
        assert "Article 1. Scope" in document.pages[0] and document.pages[1].strip() == ""

    def test_every_blank_page_is_listed(self):
        document = extract_document(MEDIA_PDF, pdf_with_pages([None, FIRST_PAGE, None, None, THIRD_PAGE]))
        assert [gap["page"] for gap in document.gaps] == [1, 3, 4]

    def test_a_fully_textual_pdf_has_no_gap(self):
        assert extract_document(MEDIA_PDF, pdf_with_pages([FIRST_PAGE, THIRD_PAGE])).gaps == []

    def test_a_pdf_that_is_entirely_unextractable_still_fails_with_its_code(self):
        with pytest.raises(ExtractionError) as raised:
            extract_document(MEDIA_PDF, pdf_with_pages([None, None]))
        assert raised.value.code == "NO_EXTRACTABLE_TEXT"

    def test_the_gap_reaches_the_ingestion_result_and_the_document_stays_ready(self):
        result = ingest_document(data=pdf_with_pages([FIRST_PAGE, None, THIRD_PAGE]), media_type=MEDIA_PDF, structure_profile="AUTO", attempt=1)
        assert result["outcome"] == "READY"
        assert result["extraction"]["gaps"] == [{"page": 2, "kind": "NO_TEXT_LAYER"}]
        assert result["extraction"]["pageCount"] == 3 and len(result["extraction"]["pages"]) == 3

    def test_formats_without_pages_report_an_empty_list_not_a_missing_field(self):
        result = ingest_document(data=b"Article 1. Scope\nThis Act applies to samples.\n", media_type=MEDIA_TEXT, structure_profile="AUTO", attempt=1)
        assert result["extraction"]["gaps"] == []

    def test_gap_kinds_match_the_api_contract(self):
        source = (ROOT / "packages/contracts/src/legal-source/management.ts").read_text(encoding="utf-8")
        block = re.search(r"LEGAL_SOURCE_EXTRACTION_GAP_KINDS = \{(.*?)\} as const", source, re.S).group(1)
        declared = dict(re.findall(r"(\w+): \"(\w+)\"", block))
        assert declared == {GAP_NO_TEXT_LAYER: GAP_NO_TEXT_LAYER, GAP_UNSUPPORTED_NUMBERING: GAP_UNSUPPORTED_NUMBERING}


# ------------------------------------------------------------------- E1: extraction honesty (DOCX)

NAMESPACES = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
)


def wp(text: str, *, extra: str = "", properties: str = "") -> str:
    return f'<w:p>{properties}<w:r><w:t xml:space="preserve">{text}</w:t></w:r>{extra}</w:p>'


def numbered(text: str, num_id: str, level: int | None = 0) -> str:
    ilvl = f'<w:ilvl w:val="{level}"/>' if level is not None else ""
    return wp(text, properties=f'<w:pPr><w:numPr>{ilvl}<w:numId w:val="{num_id}"/></w:numPr></w:pPr>')


def docx(body: str, *, numbering: str | None = None, styles: str | None = None, footnotes: str | None = None, endnotes: str | None = None) -> bytes:
    def part(root: str, content: str) -> str:
        return f'<?xml version="1.0"?><w:{root} {NAMESPACES}>{content}</w:{root}>'

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", part("document", f"<w:body>{body}</w:body>"))
        for name, root, content in (
            ("numbering", "numbering", numbering),
            ("styles", "styles", styles),
            ("footnotes", "footnotes", footnotes),
            ("endnotes", "endnotes", endnotes),
        ):
            if content is not None:
                archive.writestr(f"word/{name}.xml", part(root, content))
    return buffer.getvalue()


def lines_of(document) -> list[str]:  # noqa: ANN001
    return document.pages[0].split("\n")


def lvl(index: int, fmt: str, text: str, *, start: int = 1, style: str | None = None, legal: bool = False) -> str:
    linked = f'<w:pStyle w:val="{style}"/>' if style else ""
    is_legal = "<w:isLgl/>" if legal else ""
    return f'<w:lvl w:ilvl="{index}"><w:start w:val="{start}"/><w:numFmt w:val="{fmt}"/>{linked}{is_legal}<w:lvlText w:val="{text}"/></w:lvl>'


LIST = (
    '<w:abstractNum w:abstractNumId="0">'
    + lvl(0, "decimal", "%1.")
    + lvl(1, "lowerLetter", "(%2)")
    + lvl(2, "lowerRoman", "%3)")
    + '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
)


class TestDocxTables:
    def test_a_table_row_is_one_line_with_separated_cells(self):
        row = lambda *cells: "<w:tr>" + "".join(f"<w:tc>{wp(c)}</w:tc>" for c in cells) + "</w:tr>"
        body = wp("Schedule 1") + f"<w:tbl>{row('Service', 'Annual fee')}{row('Data hosting', '1,000 units')}</w:tbl>" + wp("Annex A")
        assert lines_of(extract_document(MEDIA_DOCX, docx(body))) == [
            "Schedule 1",
            f"Service{CELL_SEPARATOR}Annual fee",
            f"Data hosting{CELL_SEPARATOR}1,000 units",
            "Annex A",
        ]

    def test_paragraphs_in_a_cell_share_the_row_and_empty_cells_keep_their_column(self):
        cell = lambda *paragraphs: "<w:tc>" + "".join(wp(p) for p in paragraphs) + "</w:tc>"
        body = f"<w:tbl><w:tr>{cell('Data', 'hosting')}<w:tc><w:p/></w:tc>{cell('1,000')}</w:tr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>" + wp("after the table")
        assert lines_of(extract_document(MEDIA_DOCX, docx(body))) == [f"Data hosting{CELL_SEPARATOR}{CELL_SEPARATOR}1,000", "after the table"]

    def test_a_nested_table_is_flattened_into_its_cell(self):
        inner = f"<w:tbl><w:tr><w:tc>{wp('x')}</w:tc><w:tc>{wp('y')}</w:tc></w:tr></w:tbl>"
        body = f"<w:tbl><w:tr><w:tc>{wp('outer')}{inner}</w:tc><w:tc>{wp('z')}</w:tc></w:tr></w:tbl>"
        assert lines_of(extract_document(MEDIA_DOCX, docx(body + wp("padding text for length")))) == [
            f"outer x{CELL_SEPARATOR}y{CELL_SEPARATOR}z",
            "padding text for length",
        ]

    def test_paragraphs_without_tables_are_unchanged(self):
        assert lines_of(extract_document(MEDIA_DOCX, docx(wp("Article 1. Scope") + wp("") + wp("Applies to samples and more.")))) == [
            "Article 1. Scope",
            "",
            "Applies to samples and more.",
        ]


class TestDocxNotes:
    FOOTNOTES = (
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
        '<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Credit applies for each month.</w:t></w:r></w:p></w:footnote>'
    )

    def test_a_footnote_is_extracted_once_right_after_the_paragraph_that_cites_it(self):
        body = wp("Availability is 99.5%.", extra='<w:r><w:footnoteReference w:id="2"/></w:r>') + wp("The next paragraph follows.")
        document = extract_document(MEDIA_DOCX, docx(body, footnotes=self.FOOTNOTES))
        assert lines_of(document) == ["Availability is 99.5%.", "Footnote 1: Credit applies for each month.", "The next paragraph follows."]
        assert document.pages[0].count("Credit applies") == 1
        assert document.gaps == []

    def test_a_footnote_cited_twice_is_not_repeated_and_separators_are_not_text(self):
        cite = '<w:r><w:footnoteReference w:id="2"/></w:r>'
        document = extract_document(MEDIA_DOCX, docx(wp("First.", extra=cite) + wp("Second.", extra=cite) + wp("padding for length"), footnotes=self.FOOTNOTES))
        assert document.pages[0].count("Credit applies") == 1
        assert "separator" not in document.pages[0].lower()

    def test_an_uncited_note_and_an_endnote_are_still_extracted(self):
        endnotes = '<w:endnote w:id="1"><w:p><w:r><w:t>Closing remark.</w:t></w:r></w:p></w:endnote>'
        body = wp("Body paragraph that cites the endnote.", extra='<w:r><w:endnoteReference w:id="1"/></w:r>')
        document = extract_document(MEDIA_DOCX, docx(body, footnotes=self.FOOTNOTES, endnotes=endnotes))
        assert lines_of(document) == [
            "Body paragraph that cites the endnote.",
            "Endnote 1: Closing remark.",
            "Footnote 1: Credit applies for each month.",
        ]

    def test_a_document_without_notes_has_no_note_lines(self):
        assert "Footnote" not in extract_document(MEDIA_DOCX, docx(wp("Plain paragraph of sufficient length."))).pages[0]


class TestDocxNumbering:
    def labels(self, body: str, **parts: str) -> list[str]:
        return lines_of(extract_document(MEDIA_DOCX, docx(body, **parts)))

    def test_decimal_letter_and_roman_labels_restart_per_level(self):
        body = "".join(
            [
                numbered("Alpha clause", "1", 0),
                numbered("Beta sub", "1", 1),
                numbered("Gamma sub", "1", 1),
                numbered("Deep one", "1", 2),
                numbered("Deep two", "1", 2),
                numbered("Delta clause", "1", 0),
                numbered("Epsilon sub", "1", 1),
            ]
        )
        assert self.labels(body, numbering=LIST) == [
            "1. Alpha clause",
            "(a) Beta sub",
            "(b) Gamma sub",
            "i) Deep one",
            "ii) Deep two",
            "2. Delta clause",
            "(a) Epsilon sub",
        ]

    def test_compound_labels_and_literal_words_in_the_label_text(self):
        abstract = (
            '<w:abstractNum w:abstractNumId="3">'
            + lvl(0, "decimal", "Article %1.")
            + lvl(1, "decimal", "%1.%2")
            + "</w:abstractNum>"
            '<w:num w:numId="5"><w:abstractNumId w:val="3"/></w:num>'
        )
        body = numbered("Definitions", "5", 0) + numbered("First point", "5", 1) + numbered("Second point", "5", 1) + numbered("Duties", "5", 0) + numbered("Only point", "5", 1)
        assert self.labels(body, numbering=abstract) == [
            "Article 1. Definitions",
            "1.1 First point",
            "1.2 Second point",
            "Article 2. Duties",
            "2.1 Only point",
        ]

    def test_start_values_upper_case_formats_and_double_letters(self):
        abstract = '<w:abstractNum w:abstractNumId="1">' + lvl(0, "upperLetter", "%1)", start=25) + "</w:abstractNum>" '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'
        body = numbered("x one", "2") + numbered("x two", "2") + numbered("x three", "2")
        assert self.labels(body, numbering=abstract) == ["Y) x one", "Z) x two", "AA) x three"]

    def test_a_restart_override_starts_the_list_again(self):
        abstract = (
            '<w:abstractNum w:abstractNumId="0">' + lvl(0, "decimal", "%1.") + "</w:abstractNum>"
            '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
            '<w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'
        )
        body = numbered("one", "1") + numbered("two", "1") + numbered("again one", "2") + numbered("again two", "2")
        assert self.labels(body, numbering=abstract) == ["1. one", "2. two", "1. again one", "2. again two"]

    def test_numbering_attached_to_a_style_including_inherited_styles(self):
        styles = (
            '<w:style w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>'
            '<w:style w:styleId="Heading1Bold"><w:basedOn w:val="Heading1"/></w:style>'
        )
        abstract = '<w:abstractNum w:abstractNumId="0">' + lvl(0, "decimal", "%1.", style="Heading1") + "</w:abstractNum>" '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
        body = wp("Scope", properties='<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>') + wp("Duties", properties='<w:pPr><w:pStyle w:val="Heading1Bold"/></w:pPr>') + wp("Unstyled body text")
        assert self.labels(body, numbering=abstract, styles=styles) == ["1. Scope", "2. Duties", "Unstyled body text"]

    def test_bullets_and_numid_zero_add_no_label_and_no_gap(self):
        abstract = '<w:abstractNum w:abstractNumId="4">' + lvl(0, "bullet", "•") + "</w:abstractNum>" '<w:num w:numId="7"><w:abstractNumId w:val="4"/></w:num>'
        body = numbered("bullet item text", "7") + numbered("explicitly not numbered", "0")
        document = extract_document(MEDIA_DOCX, docx(body, numbering=abstract))
        assert lines_of(document) == ["bullet item text", "explicitly not numbered"]
        assert document.gaps == []

    def test_a_format_that_cannot_be_rendered_is_reported_as_a_gap_not_dropped_silently(self):
        abstract = '<w:abstractNum w:abstractNumId="9">' + lvl(0, "chineseCounting", "%1") + "</w:abstractNum>" '<w:num w:numId="3"><w:abstractNumId w:val="9"/></w:num>'
        document = extract_document(MEDIA_DOCX, docx(numbered("first numbered paragraph", "3") + numbered("second numbered paragraph", "3"), numbering=abstract))
        assert lines_of(document) == ["first numbered paragraph", "second numbered paragraph"]  # the text is never lost
        assert document.gaps == [{"page": None, "kind": GAP_UNSUPPORTED_NUMBERING}]

    def test_a_document_that_uses_no_numbering_has_no_gap_even_if_numbering_xml_exists(self):
        document = extract_document(MEDIA_DOCX, docx(wp("A plain paragraph of enough length."), numbering=LIST))
        assert document.gaps == []

    def test_numbering_labels_reach_the_chunker_as_headings(self):
        abstract = '<w:abstractNum w:abstractNumId="0">' + lvl(0, "decimal", "Article %1.") + "</w:abstractNum>" '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
        body = numbered("Scope", "1") + wp("This Act applies.") + numbered("Duties", "1") + wp("Keep records.")
        result = ingest_document(data=docx(body, numbering=abstract), media_type=MEDIA_DOCX, structure_profile="ARTICLES", attempt=1)
        assert [c["locator"] for c in result["chunks"]] == ["art-1", "art-2"]


class TestDocxTextBoxesAndRevisions:
    BOX = '<w:txbxContent><w:p><w:r><w:t>Boxed duty text</w:t></w:r></w:p></w:txbxContent>'

    def test_a_text_box_is_read_once_even_though_word_stores_it_twice(self):
        alternate = (
            f"<w:r><mc:AlternateContent><mc:Choice Requires=\"wps\"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx>{self.BOX}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>"
            f"<mc:Fallback><w:pict><v:shape><v:textbox>{self.BOX}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>"
        )
        document = extract_document(MEDIA_DOCX, docx(wp("Host paragraph text", extra=alternate) + wp("Following paragraph.")))
        assert lines_of(document) == ["Host paragraph text", "Boxed duty text", "Following paragraph."]
        assert document.pages[0].count("Boxed duty text") == 1

    def test_a_legacy_text_box_without_alternate_content_is_not_glued_to_its_host(self):
        legacy = f"<w:r><w:pict><v:shape><v:textbox>{self.BOX}</v:textbox></v:shape></w:pict></w:r>"
        assert lines_of(extract_document(MEDIA_DOCX, docx(wp("Host paragraph text", extra=legacy)))) == ["Host paragraph text", "Boxed duty text"]

    def test_tracked_deletions_are_not_part_of_the_text(self):
        deleted = '<w:del w:id="1"><w:r><w:delText>removed words</w:delText></w:r></w:del>'
        document = extract_document(MEDIA_DOCX, docx(wp("Kept text that is long enough", extra=deleted)))
        assert lines_of(document) == ["Kept text that is long enough"]

    def test_content_controls_hyperlinks_and_tabs(self):
        sdt = f"<w:sdt><w:sdtContent>{wp('Inside a content control')}</w:sdtContent></w:sdt>"
        link = '<w:hyperlink><w:r><w:t>linked</w:t></w:r></w:hyperlink><w:r><w:tab/><w:t>after tab</w:t></w:r>'
        document = extract_document(MEDIA_DOCX, docx(sdt + wp("See ", extra=link)))
        assert lines_of(document) == ["Inside a content control", "See linked after tab"]
