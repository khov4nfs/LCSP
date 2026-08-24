#!/usr/bin/env python3
"""Fetch one official VBPL legal document as a reviewable HTML snapshot.

This is intentionally a narrow operator tool. It accepts a known VBPL gateway
document ID and an official vbpl.vn source URL; it does not crawl arbitrary
URLs or bulk-scrape the registry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


VBPL_PORTAL_HOST = "vbpl.vn"
VBPL_GATEWAY_BASE_URL = "https://vbpl-bientap-gateway.moj.gov.vn"
MAX_RESPONSE_BYTES = 10 * 1024 * 1024


@dataclass(frozen=True)
class VbplSnapshot:
    document_id: str
    source_url: str
    final_url: str
    gateway_document_id: str
    source_sha256: str
    html_sha256: str
    text_sha256: str
    source_effect_status: str | None
    retrieved_at: str


class _TextExtractor(HTMLParser):
    _BLOCK_ELEMENTS = {"br", "div", "p", "li", "tr", "h1", "h2", "h3", "h4"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in self._BLOCK_ELEMENTS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        lines = [" ".join(line.split()) for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line)


class VbplDocumentCrawler:
    def __init__(self, session: requests.Session | None = None) -> None:
        self._session = session or self._create_session()

    def create_snapshot(
        self,
        *,
        document_id: str,
        gateway_document_id: str,
        source_url: str,
        output_dir: Path,
    ) -> Path:
        self._validate_source_url(source_url)
        payload = self._fetch_detail(gateway_document_id)
        html = self._require_html(payload)
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()
        text = extract_text(html)
        if not text:
            raise RuntimeError("VBPL detail response contained no extractable legal text")

        output_dir.mkdir(parents=True, exist_ok=True)
        payload_path = output_dir / f"{document_id}.source.payload.json"
        html_path = output_dir / f"{document_id}.source.html"
        text_path = output_dir / f"{document_id}.source.txt"
        manifest_path = output_dir / f"{document_id}.source.json"
        payload_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        html_path.write_text(html, encoding="utf-8")
        text_path.write_text(text + "\n", encoding="utf-8")
        effect_status = self._effect_status(payload)
        snapshot = VbplSnapshot(
            document_id=document_id,
            source_url=source_url,
            final_url=source_url,
            gateway_document_id=gateway_document_id,
            source_sha256=sha256(raw),
            html_sha256=sha256(html.encode()),
            text_sha256=sha256(text.encode()),
            source_effect_status=effect_status,
            retrieved_at=datetime.now(UTC).isoformat(),
        )
        manifest_path.write_text(
            json.dumps(
                {
                    "documentId": snapshot.document_id,
                    "sourceUrl": snapshot.source_url,
                    "finalUrl": snapshot.final_url,
                    "gatewayDocumentId": snapshot.gateway_document_id,
                    "sourceSha256": snapshot.source_sha256,
                    "htmlSha256": snapshot.html_sha256,
                    "textSha256": snapshot.text_sha256,
                    "sourceEffectStatus": snapshot.source_effect_status,
                    "retrievedAt": snapshot.retrieved_at,
                    "documentNumber": payload.get("docNum"),
                    "title": payload.get("title"),
                    "effectiveFrom": payload.get("effFrom"),
                    "snapshotFile": payload_path.name,
                    "htmlFile": html_path.name,
                    "textFile": text_path.name,
                    "normalizationSource": "VBPL_GATEWAY_JSON",
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return manifest_path

    def _fetch_detail(self, gateway_document_id: str) -> dict[str, Any]:
        if not gateway_document_id.strip():
            raise ValueError("gateway_document_id is required")
        response = self._session.get(
            f"{VBPL_GATEWAY_BASE_URL}/api/qtdc/public/doc/{gateway_document_id}",
            headers={"Accept": "application/json"},
            timeout=(5, 30),
            allow_redirects=False,
            stream=True,
        )
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "")
        if "application/json" not in content_type.lower():
            raise RuntimeError("VBPL gateway returned an unsupported content type")
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            size += len(chunk)
            if size > MAX_RESPONSE_BYTES:
                raise RuntimeError("VBPL gateway response exceeds the size limit")
            chunks.append(chunk)
        data = json.loads(b"".join(chunks))
        payload = data.get("data")
        if not isinstance(payload, dict):
            raise RuntimeError("VBPL gateway response does not contain a document payload")
        return payload

    @staticmethod
    def _create_session() -> requests.Session:
        session = requests.Session()
        retry = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET",),
        )
        session.mount("https://", HTTPAdapter(max_retries=retry))
        return session

    @staticmethod
    def _validate_source_url(source_url: str) -> None:
        parsed = urlparse(source_url)
        if parsed.scheme != "https" or parsed.hostname != VBPL_PORTAL_HOST:
            raise ValueError("source_url must be an HTTPS vbpl.vn URL")

    @staticmethod
    def _require_html(payload: dict[str, Any]) -> str:
        document_content = payload.get("documentContent")
        if not isinstance(document_content, dict):
            raise RuntimeError("VBPL detail response has no documentContent")
        content = document_content.get("content")
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("VBPL detail response has no HTML content")
        return content

    @staticmethod
    def _effect_status(payload: dict[str, Any]) -> str | None:
        status = payload.get("effStatus")
        return status.get("name") if isinstance(status, dict) else None


def extract_text(html: str) -> str:
    extractor = _TextExtractor()
    extractor.feed(html)
    return extractor.text()


def sha256(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--gateway-document-id", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = VbplDocumentCrawler().create_snapshot(
        document_id=args.document_id,
        gateway_document_id=args.gateway_document_id,
        source_url=args.source_url,
        output_dir=args.output_dir,
    )
    print(manifest)


if __name__ == "__main__":
    main()
