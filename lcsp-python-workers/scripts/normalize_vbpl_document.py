#!/usr/bin/env python3
"""Normalize a reviewed VBPL HTML snapshot into a draft legal-corpus payload."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ARTICLE_PATTERN = re.compile(r"^Điều\s+(\d+)\.?(?:\s*(.*))?$", re.IGNORECASE)
CLAUSE_PATTERN = re.compile(r"^(\d+)\.\s*(.+)$")
POINT_PATTERN = re.compile(r"^([a-zđ])\)\s*(.+)$", re.IGNORECASE)
ARTICLE_REFERENCE_PATTERN = re.compile(r"Điều\s+(\d+)", re.IGNORECASE)

SOURCE_EFFECT_STATUSES = {
    "Còn hiệu lực": "CON_HIEU_LUC",
    "Hết hiệu lực một phần": "HET_HIEU_LUC_MOT_PHAN",
    "Chưa có hiệu lực": "CHUA_CO_HIEU_LUC",
    "Ngưng hiệu lực": "NGUNG_HIEU_LUC",
    "Hết hiệu lực toàn bộ": "HET_HIEU_LUC_TOAN_BO",
    "Không còn phù hợp": "KHONG_CON_PHU_HOP",
}


@dataclass(frozen=True)
class Element:
    css_class: str
    text: str


class _ProvisionParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._css_class = ""
        self._depth = 0
        self._parts: list[str] = []
        self.elements: list[Element] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "p":
            self._depth = 1
            self._css_class = dict(attrs).get("class") or ""
            self._parts = []
        elif self._depth:
            self._depth += 1

    def handle_endtag(self, tag: str) -> None:
        if not self._depth:
            return
        self._depth -= 1
        if tag.lower() == "p" or self._depth == 0:
            text = " ".join("".join(self._parts).split())
            if text:
                self.elements.append(Element(self._css_class, text))
            self._depth = 0

    def handle_data(self, data: str) -> None:
        if self._depth:
            self._parts.append(data)


class VbplNormalizer:
    def normalize(
        self,
        *,
        source_manifest_path: Path,
        corpus_version: str,
        output_path: Path,
    ) -> Path:
        manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
        document_id = required(manifest, "documentId")
        html_path = source_manifest_path.parent / required(manifest, "htmlFile")
        html = html_path.read_text(encoding="utf-8")
        elements = parse_elements(html)
        chunks, warnings = build_chunks(document_id, elements)
        if not chunks:
            raise RuntimeError("No legal provisions were found in the VBPL HTML")

        source_effect_status = SOURCE_EFFECT_STATUSES.get(
            manifest.get("sourceEffectStatus"), "UNKNOWN"
        )
        if source_effect_status == "UNKNOWN":
            warnings.append("source_effect_status_unknown")
        payload = {
            "version": corpus_version,
            "sourceManifest": {
                "reviewRequired": True,
                "normalizationWarnings": warnings,
                "sourceArtifacts": [manifest],
            },
            "documents": [
                {
                    "documentId": document_id,
                    "title": required(manifest, "title"),
                    "sourceUrl": required(manifest, "sourceUrl"),
                    "sourceSha256": required(manifest, "sourceSha256"),
                    "sourceEffectStatus": source_effect_status,
                    "effectiveDate": manifest.get("effectiveFrom"),
                    "snapshotPath": str(html_path),
                    "chunks": chunks,
                }
            ],
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return output_path


def parse_elements(html: str) -> list[Element]:
    parser = _ProvisionParser()
    parser.feed(html)
    return parser.elements


def build_chunks(document_id: str, elements: list[Element]) -> tuple[list[dict[str, Any]], list[str]]:
    chunks: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    article_id = ""
    clause_id = ""

    for element in elements:
        css_class = element.css_class.lower()
        if "prov-article" in css_class:
            match = ARTICLE_PATTERN.match(element.text)
            if not match:
                warnings.append(f"unparsed_article:{element.text[:80]}")
                article_id = ""
                clause_id = ""
                continue
            article_number, title = match.groups()
            locator = f"art-{article_number}"
            article_id = f"{document_id}::{locator}"
            clause_id = ""
            chunks[article_id] = chunk(
                chunk_id=article_id,
                locator=locator,
                content=element.text,
                hierarchy={"articleNumber": article_number},
            )
            continue

        if "prov-clause" in css_class:
            match = CLAUSE_PATTERN.match(element.text)
            if not article_id or not match:
                warnings.append(f"unparsed_clause:{element.text[:80]}")
                continue
            clause_number, _ = match.groups()
            locator = f"{article_id.split('::', 1)[1]}::cl-{clause_number}"
            clause_id = f"{document_id}::{locator}"
            chunks[clause_id] = chunk(
                chunk_id=clause_id,
                locator=locator,
                content=element.text,
                hierarchy={
                    "articleNumber": article_id.rsplit("art-", 1)[1],
                    "clauseNumber": clause_number,
                    "parentChunkId": article_id,
                },
            )
            continue

        if "prov-item" in css_class:
            match = POINT_PATTERN.match(element.text)
            if not clause_id or not match:
                warnings.append(f"unparsed_point:{element.text[:80]}")
                continue
            point_code, _ = match.groups()
            locator = f"{clause_id.split('::', 1)[1]}::pt-{point_code.lower()}"
            point_id = f"{document_id}::{locator}"
            chunks[point_id] = chunk(
                chunk_id=point_id,
                locator=locator,
                content=element.text,
                hierarchy={
                    "parentChunkId": clause_id,
                    "pointCode": point_code.lower(),
                },
            )
            continue

        if "prov-content" in css_class and article_id:
            chunks[article_id]["content"] += "\n" + element.text
            chunks[article_id]["contentSha256"] = sha256(chunks[article_id]["content"])

    for item in chunks.values():
        item["hierarchy"]["outgoingRefIds"] = [
            f"{document_id}::art-{article_number}"
            for article_number in ARTICLE_REFERENCE_PATTERN.findall(item["content"])
            if f"{document_id}::art-{article_number}" != item["id"]
        ]
    return list(chunks.values()), warnings


def chunk(*, chunk_id: str, locator: str, content: str, hierarchy: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": chunk_id,
        "locator": locator,
        "content": content,
        "contentSha256": sha256(content),
        "hierarchy": hierarchy,
        "legalStatus": "ACTIVE",
    }


def sha256(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()}"


def required(values: dict[str, Any], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Source manifest is missing {key}")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--corpus-version", required=True)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = VbplNormalizer().normalize(
        source_manifest_path=args.source_manifest,
        corpus_version=args.corpus_version,
        output_path=args.output,
    )
    print(output)


if __name__ == "__main__":
    main()
