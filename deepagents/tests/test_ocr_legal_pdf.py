import subprocess
import importlib.util
import sys
from pathlib import Path

import pytest


script_path = (
    Path(__file__).parents[1]
    / "tools"
    / "legal"
    / "sources"
    / "scripts"
    / "ocr_legal_pdf.py"
)
spec = importlib.util.spec_from_file_location("ocr_legal_pdf", script_path)
assert spec and spec.loader
ocr_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ocr_module
spec.loader.exec_module(ocr_module)
LegalPdfOcr = ocr_module.LegalPdfOcr


def test_selected_pages_are_rendered_one_at_a_time_with_resource_controls(tmp_path, monkeypatch):
    pdf = tmp_path / "original.pdf"
    pdf.write_bytes(b"unchanged-original")
    monkeypatch.setattr(ocr_module.shutil, "which", lambda _: "/usr/bin/tool")
    commands = []

    def run(command, **options):
        assert options["timeout"] == 90
        assert options["env"]["OMP_THREAD_LIMIT"] == "1"
        commands.append(command)
        if command == ["tesseract", "--list-langs"]:
            return subprocess.CompletedProcess(command, 0, "Languages:\nvie\neng\n", "")
        if command[0] == "pdftoppm":
            Path(command[-1]).with_suffix(".png").write_bytes(b"rendered-page")
            return subprocess.CompletedProcess(command, 0, "", "")
        assert Path(command[1]).is_file()
        return subprocess.CompletedProcess(command, 0, "Điều 1. Văn bản nhận dạng", "")

    pages = LegalPdfOcr(run).extract_pages(pdf_path=pdf, page_numbers=[2, 7])
    renders = [command for command in commands if command[0] == "pdftoppm"]
    assert [(command[command.index("-f") + 1], command[command.index("-l") + 1]) for command in renders] == [("2", "2"), ("7", "7")]
    assert [page.page_number for page in pages] == [2, 7]
    assert all(not Path(command[-1]).parent.exists() for command in renders)
    assert pdf.read_bytes() == b"unchanged-original"


def test_create_artifact_writes_page_provenance(tmp_path: Path, monkeypatch):
    pdf = tmp_path / "law.pdf"
    pdf.write_bytes(b"scanned-law")
    monkeypatch.setattr(ocr_module.shutil, "which", lambda _: "/usr/bin/tool")

    def run(command, **_):
        if command == ["tesseract", "--list-langs"]:
            return subprocess.CompletedProcess(command, 0, "List of available languages:\neng\nvie\n", "")
        if command[0] == "pdftoppm":
            (Path(command[-1]).parent / "page-1.png").write_bytes(b"page")
            return subprocess.CompletedProcess(command, 0, "", "")
        return subprocess.CompletedProcess(command, 0, "Điều 1. Nội dung luật", "")

    manifest_path = LegalPdfOcr(run).create_artifact(
        pdf_path=pdf,
        document_id="LAW-TEST",
        source_url="https://vbpl.vn/law-test",
        output_dir=tmp_path / "output",
        language="vie+eng",
        dpi=300,
    )

    manifest = manifest_path.read_text(encoding="utf-8")
    assert '"documentId": "LAW-TEST"' in manifest
    assert '"page_number": 1' in manifest
    assert (tmp_path / "output" / "LAW-TEST.ocr.txt").read_text(encoding="utf-8") == "Điều 1. Nội dung luật\n"


def test_create_artifact_rejects_non_official_url(tmp_path: Path, monkeypatch):
    pdf = tmp_path / "law.pdf"
    pdf.write_bytes(b"scanned-law")
    monkeypatch.setattr(ocr_module.shutil, "which", lambda _: "/usr/bin/tool")

    with pytest.raises(ValueError, match="HTTPS"):
        LegalPdfOcr().create_artifact(
            pdf_path=pdf,
            document_id="LAW-TEST",
            source_url="http://example.test/law",
            output_dir=tmp_path / "output",
            language="vie",
            dpi=300,
        )
