#!/usr/bin/env python3
"""Create reviewable OCR artifacts from scanned legal PDFs.

This command deliberately stops before normalization, corpus ingestion, or
approval. A legal operator must review the generated text and locators first.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable, Sequence


RunCommand = Callable[..., subprocess.CompletedProcess[str]]


@dataclass(frozen=True)
class OcrPage:
    page_number: int
    text: str
    text_sha256: str


class LegalPdfOcr:
    def __init__(self, run_command: RunCommand = subprocess.run) -> None:
        self._run_command = run_command

    def create_artifact(
        self,
        *,
        pdf_path: Path,
        document_id: str,
        source_url: str,
        output_dir: Path,
        language: str,
        dpi: int,
    ) -> Path:
        if not pdf_path.is_file():
            raise ValueError(f"PDF does not exist: {pdf_path}")
        if not source_url.startswith("https://"):
            raise ValueError("source_url must be an HTTPS official-source URL")
        self._require_command("pdftoppm")
        self._require_command("tesseract")
        self._require_language(language)

        with tempfile.TemporaryDirectory(prefix="lcsp-legal-ocr-") as temporary:
            image_prefix = Path(temporary) / "page"
            self._run(
                [
                    "pdftoppm",
                    "-png",
                    "-r",
                    str(dpi),
                    str(pdf_path),
                    str(image_prefix),
                ]
            )
            pages = [
                self._ocr_page(page_number, image_path, language)
                for page_number, image_path in enumerate(
                    sorted(Path(temporary).glob("page-*.png")), start=1
                )
            ]

        if not pages:
            raise RuntimeError("OCR did not render any PDF pages")

        output_dir.mkdir(parents=True, exist_ok=True)
        text_path = output_dir / f"{document_id}.ocr.txt"
        manifest_path = output_dir / f"{document_id}.ocr.json"
        text_path.write_text(
            "\n\f\n".join(page.text for page in pages) + "\n", encoding="utf-8"
        )
        manifest_path.write_text(
            json.dumps(
                {
                    "documentId": document_id,
                    "sourceUrl": source_url,
                    "sourceFile": str(pdf_path),
                    "sourceSha256": self._sha256_file(pdf_path),
                    "ocrTextFile": text_path.name,
                    "ocrLanguage": language,
                    "ocrDpi": dpi,
                    "createdAt": datetime.now(UTC).isoformat(),
                    "pages": [asdict(page) for page in pages],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return manifest_path

    def _ocr_page(self, page_number: int, image_path: Path, language: str) -> OcrPage:
        result = self._run(["tesseract", str(image_path), "stdout", "-l", language])
        text = result.stdout.strip()
        if not text:
            raise RuntimeError(f"OCR returned no text for page {page_number}")
        return OcrPage(
            page_number=page_number,
            text=text,
            text_sha256=self._sha256_text(text),
        )

    def _require_command(self, command: str) -> None:
        if shutil.which(command) is None:
            raise RuntimeError(
                f"{command} is required. Install the OCR prerequisites before running this command."
            )

    def _require_language(self, language: str) -> None:
        installed = self._run(["tesseract", "--list-langs"]).stdout.splitlines()[1:]
        missing = [value for value in language.split("+") if value not in installed]
        if missing:
            raise RuntimeError(
                "Missing Tesseract language data: " + ", ".join(missing)
            )

    def _run(self, command: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return self._run_command(
            command,
            check=True,
            text=True,
            capture_output=True,
        )

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        return f"sha256:{digest.hexdigest()}"

    @staticmethod
    def _sha256_text(value: str) -> str:
        return f"sha256:{hashlib.sha256(value.encode()).hexdigest()}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--language", default="vie+eng")
    parser.add_argument("--dpi", type=int, default=300)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = LegalPdfOcr().create_artifact(
        pdf_path=args.pdf,
        document_id=args.document_id,
        source_url=args.source_url,
        output_dir=args.output_dir,
        language=args.language,
        dpi=args.dpi,
    )
    print(manifest)


if __name__ == "__main__":
    main()
