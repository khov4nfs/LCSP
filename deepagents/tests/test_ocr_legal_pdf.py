import subprocess
import importlib.util
import sys
from pathlib import Path

import pytest


script_path = (
    Path(__file__).parents[1]
    / "runtime"
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
