#!/usr/bin/env python3
"""Fetch an official Công báo DOCX and emit a normalized legal source artifact."""

from __future__ import annotations

import argparse
import certifi
import hashlib
import html
import json
import os
import re
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse
from xml.etree import ElementTree

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


CONGBAO_HOST = "congbao.chinhphu.vn"
CONGBAO_CDN_HOST = "g7.cdnchinhphu.vn"
MAX_RESPONSE_BYTES = 20 * 1024 * 1024
WORDPROCESSINGML_NAMESPACE = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SOURCE_EFFECT_STATUS_NAMES = {
    "Còn hiệu lực",
    "Hết hiệu lực một phần",
    "Chưa có hiệu lực",
    "Ngưng hiệu lực",
    "Hết hiệu lực toàn bộ",
    "Không còn phù hợp",
}


class CongBaoDocxCrawler:
    def __init__(
        self,
        session: requests.Session | None = None,
        *,
        ca_bundle: Path | None = None,
    ) -> None:
        self._session = session or self._create_session(ca_bundle=ca_bundle)

    def create_snapshot(
        self,
        *,
        document_id: str,
        source_url: str,
        source_effect_status: str,
        output_dir: Path,
    ) -> Path:
        self._validate_source_url(source_url)
        if source_effect_status not in SOURCE_EFFECT_STATUS_NAMES:
            raise ValueError("source_effect_status must be an approved registry value")
        page = self._fetch(source_url, expected_host=CONGBAO_HOST, content_type="text/html")
        page_html = page.decode("utf-8")
        docx_url = find_docx_url(page_html)
        docx = self._fetch(docx_url, expected_host=CONGBAO_CDN_HOST)
        paragraphs = extract_docx_paragraphs(docx)
        if not paragraphs:
            raise RuntimeError("Official DOCX contains no extractable paragraphs")

        output_dir.mkdir(parents=True, exist_ok=True)
        docx_path = output_dir / f"{document_id}.source.docx"
        html_path = output_dir / f"{document_id}.source.html"
        text_path = output_dir / f"{document_id}.source.txt"
        manifest_path = output_dir / f"{document_id}.source.json"
        docx_path.write_bytes(docx)
        html_path.write_text(build_structured_html(paragraphs), encoding="utf-8")
        text_path.write_text("\n".join(paragraphs) + "\n", encoding="utf-8")
        manifest_path.write_text(
            json.dumps(
                {
                    "documentId": document_id,
                    "title": extract_title(page_html),
                    "sourceUrl": source_url,
                    "downloadUrl": docx_url,
                    "sourceSha256": sha256(docx),
                    "sourceEffectStatus": source_effect_status,
                    "retrievedAt": datetime.now(UTC).isoformat(),
                    "sourceFile": docx_path.name,
                    "htmlFile": html_path.name,
                    "textFile": text_path.name,
                    "normalizationSource": "OFFICIAL_DOCX",
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return manifest_path

    def _fetch(self, url: str, *, expected_host: str, content_type: str | None = None) -> bytes:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != expected_host:
            raise RuntimeError("Official download URL host validation failed")
        response = self._session.get(
            url,
            timeout=(5, 30),
            allow_redirects=False,
            stream=True,
        )
        response.raise_for_status()
        if content_type and content_type not in response.headers.get("Content-Type", "").lower():
            raise RuntimeError("Official source returned an unsupported content type")
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            size += len(chunk)
            if size > MAX_RESPONSE_BYTES:
                raise RuntimeError("Official source response exceeds the size limit")
            chunks.append(chunk)
        return b"".join(chunks)

    @staticmethod
    def _create_session(*, ca_bundle: Path | None = None) -> requests.Session:
        session = requests.Session()
        # Some minimal server images have an incomplete system CA store. Keep
        # TLS verification enabled. An operator can supply an enterprise CA
        # bundle when a network performs TLS inspection.
        session.verify = str(ca_bundle or os.environ.get("REQUESTS_CA_BUNDLE") or certifi.where())
        session.mount(
            "https://",
            HTTPAdapter(
                max_retries=Retry(
                    total=3,
                    backoff_factor=1,
                    status_forcelist=(429, 500, 502, 503, 504),
                    allowed_methods=("GET",),
                )
            ),
        )
        return session

    @staticmethod
    def _validate_source_url(source_url: str) -> None:
        parsed = urlparse(source_url)
        if parsed.scheme != "https" or parsed.hostname != CONGBAO_HOST:
            raise ValueError("source_url must be an HTTPS congbao.chinhphu.vn URL")


def find_docx_url(page: str) -> str:
    match = re.search(r'href=["\']([^"\']+\.docx[^"\']*)["\']', page, re.IGNORECASE)
    if not match:
        raise RuntimeError("Official Công báo page has no DOCX download link")
    return html.unescape(match.group(1))


def extract_title(page: str) -> str:
    match = re.search(
        r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
        page,
        re.IGNORECASE,
    )
    if not match:
        match = re.search(r"<title[^>]*>\s*(.*?)\s*</title>", page, re.IGNORECASE | re.DOTALL)
    if not match:
        raise RuntimeError("Official Công báo page has no document title")
    return " ".join(html.unescape(match.group(1)).split())


def extract_docx_paragraphs(docx: bytes) -> list[str]:
    with zipfile.ZipFile(BytesIO(docx)) as archive:
        document = archive.read("word/document.xml")
    root = ElementTree.fromstring(document)
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{WORDPROCESSINGML_NAMESPACE}p"):
        text = "".join(
            node.text or "" for node in paragraph.iter(f"{WORDPROCESSINGML_NAMESPACE}t")
        )
        normalized = " ".join(text.split())
        if normalized:
            paragraphs.append(normalized)
    return paragraphs


def build_structured_html(paragraphs: Iterable[str]) -> str:
    elements = []
    for paragraph in paragraphs:
        css_class = provision_class(paragraph)
        elements.append(f'<p class="{css_class}">{html.escape(paragraph)}</p>')
    return "<html><body>" + "\n".join(elements) + "</body></html>\n"


def provision_class(paragraph: str) -> str:
    if re.match(r"^Điều\s+\d+", paragraph, re.IGNORECASE):
        return "prov-article"
    if re.match(r"^\d+\.\s*\S", paragraph):
        return "prov-clause"
    if re.match(r"^[a-zđ]\)\s+", paragraph, re.IGNORECASE):
        return "prov-item"
    return "prov-content"


def sha256(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--source-effect-status", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--ca-bundle", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = CongBaoDocxCrawler(ca_bundle=args.ca_bundle).create_snapshot(
        document_id=args.document_id,
        source_url=args.source_url,
        source_effect_status=args.source_effect_status,
        output_dir=args.output_dir,
    )
    print(manifest)


if __name__ == "__main__":
    main()
