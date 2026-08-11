import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path


script_path = Path(__file__).parents[1] / "scripts" / "crawl_congbao_docx.py"
spec = importlib.util.spec_from_file_location("crawl_congbao_docx", script_path)
assert spec and spec.loader
crawl_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = crawl_module
spec.loader.exec_module(crawl_module)
CongBaoDocxCrawler = crawl_module.CongBaoDocxCrawler
provision_class = crawl_module.provision_class


def docx_fixture() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "word/document.xml",
            """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
            <w:p><w:r><w:t>Điều 1. Phạm vi</w:t></w:r></w:p>
            <w:p><w:r><w:t>1. Nội dung</w:t></w:r></w:p>
            <w:p><w:r><w:t>a) Chi tiết</w:t></w:r></w:p>
            </w:body></w:document>""",
        )
    return output.getvalue()


class Response:
    def __init__(self, content: bytes, content_type: str):
        self._content = content
        self.headers = {"Content-Type": content_type}

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        yield self._content


class Session:
    def get(self, url, **kwargs):
        assert kwargs["allow_redirects"] is False
        if "congbao.chinhphu.vn" in url:
            return Response(
                '<title>Luật số 134/2025/QH15</title><a href="https://g7.cdnchinhphu.vn/document.docx">download</a>'.encode(),
                "text/html",
            )
        return Response(docx_fixture(), "application/octet-stream")


def test_crawler_writes_normalizer_compatible_artifacts(tmp_path: Path):
    manifest_path = CongBaoDocxCrawler(Session()).create_snapshot(
        document_id="LAW-134-2025-QH15",
        source_url="https://congbao.chinhphu.vn/van-ban/luat-so-134-2025-qh15-468694.htm",
        source_effect_status="Còn hiệu lực",
        output_dir=tmp_path,
    )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_html = (tmp_path / manifest["htmlFile"]).read_text(encoding="utf-8")
    assert manifest["normalizationSource"] == "OFFICIAL_DOCX"
    assert manifest["title"] == "Luật số 134/2025/QH15"
    assert 'class="prov-article"' in source_html
    assert 'class="prov-clause"' in source_html
    assert 'class="prov-item"' in source_html


def test_clause_without_space_after_number_is_classified():
    assert provision_class("3.Quỹ được ưu tiên sử dụng") == "prov-clause"
