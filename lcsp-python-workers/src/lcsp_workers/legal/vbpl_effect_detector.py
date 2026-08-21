from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


TYPE_CODE_EFFECTS = {
    "1": "REPEALED",
    "10": "AMENDED",
    "13": "ADDED",
}

LEGAL_STATUS_BY_EFFECT = {
    "REPEALED": "REPEALED",
    "AMENDED": "AMENDED",
    "ADDED": "ACTIVE",
}


@dataclass(frozen=True)
class ProvisionParagraph:
    index: int
    attrs: dict[str, str]
    text: str


class _ProvisionMarkupParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._current_attrs: dict[str, str] | None = None
        self._parts: list[str] = []
        self.paragraphs: list[ProvisionParagraph] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "p":
            self._current_attrs = {
                key: value for key, value in attrs if value is not None
            }
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._current_attrs is not None:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "p" or self._current_attrs is None:
            return
        text = " ".join("".join(self._parts).split())
        if text:
            self.paragraphs.append(
                ProvisionParagraph(
                    index=len(self.paragraphs) + 1,
                    attrs=self._current_attrs,
                    text=text,
                )
            )
        self._current_attrs = None
        self._parts = []


def detect_effects_from_html(document_id: str, html: str) -> dict[str, Any]:
    paragraphs = parse_paragraphs(html)
    observations = build_observations(document_id, paragraphs)
    return {
        "documentId": document_id,
        "htmlSha256": sha256(html),
        "typeCodeMapping": TYPE_CODE_EFFECTS,
        "summary": summarize(observations),
        "observations": observations,
    }


def detect_effects(*, source_manifest_path: Path, output_path: Path) -> Path:
    manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    document_id = required(manifest, "documentId")
    html_path = source_manifest_path.parent / required(manifest, "htmlFile")
    html = html_path.read_text(encoding="utf-8")
    
    payload = detect_effects_from_html(document_id, html)
    payload["sourceManifest"] = str(source_manifest_path)
    payload["htmlFile"] = str(html_path)
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return output_path


def parse_paragraphs(html: str) -> list[ProvisionParagraph]:
    parser = _ProvisionMarkupParser()
    parser.feed(html)
    return parser.paragraphs


def build_observations(
    document_id: str, paragraphs: list[ProvisionParagraph]
) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    article_number: str | None = None
    clause_number: str | None = None

    for paragraph in paragraphs:
        css_class = paragraph.attrs.get("class", "")
        if "prov-article" in css_class:
            article_number = first_number(paragraph.text)
            clause_number = None
        elif "prov-clause" in css_class:
            clause_number = leading_number(paragraph.text) or clause_number

        locator = locator_for(css_class, paragraph.text, article_number, clause_number)
        type_marker = parse_type_marker(paragraph.attrs.get("type"))
        new_type_marker = parse_type_marker(paragraph.attrs.get("new-types"))
        if type_marker is None and new_type_marker is None:
            continue

        effects = [
            marker["effectKind"]
            for marker in (type_marker, new_type_marker)
            if marker is not None and marker["effectKind"] != "UNKNOWN"
        ]
        primary_effect = effects[0] if effects else "UNKNOWN"
        observations.append(
            {
                "documentId": document_id,
                "locator": locator,
                "chunkId": f"{document_id}::{locator}" if locator else None,
                "htmlParagraphIndex": paragraph.index,
                "htmlId": paragraph.attrs.get("id"),
                "cssClass": css_class,
                "parentHtmlId": paragraph.attrs.get("parent-id"),
                "type": type_marker,
                "newType": new_type_marker,
                "effectKind": primary_effect,
                "legalStatusCandidate": LEGAL_STATUS_BY_EFFECT.get(
                    primary_effect, "UNKNOWN"
                ),
                "textSha256": sha256(paragraph.text),
                "textPreview": paragraph.text[:240],
                "evidence": {
                    "source": "VBPL_HTML_ATTRIBUTES",
                    "attributes": {
                        key: paragraph.attrs[key]
                        for key in ("type", "new-types", "id", "parent-id", "class")
                        if key in paragraph.attrs
                    },
                },
                "reviewRequired": True,
            }
        )
    return observations


def parse_type_marker(value: str | None) -> dict[str, str] | None:
    if not value:
        return None
    type_code, separator, type_ref = value.partition(":")
    return {
        "raw": value,
        "typeCode": type_code,
        "typeRef": type_ref if separator else "",
        "effectKind": TYPE_CODE_EFFECTS.get(type_code, "UNKNOWN"),
    }


def locator_for(
    css_class: str, text: str, article_number: str | None, clause_number: str | None
) -> str:
    if not article_number:
        return ""
    locator = f"art-{article_number}"
    if "prov-article" in css_class:
        return locator
    if clause_number:
        locator = f"{locator}::cl-{clause_number}"
    if "prov-item" in css_class:
        point_code = leading_point_code(text)
        if point_code:
            locator = f"{locator}::pt-{point_code}"
    return locator


def first_number(value: str) -> str | None:
    number = ""
    seen_digit = False
    for char in value:
        if char.isdigit():
            number += char
            seen_digit = True
            continue
        if seen_digit:
            break
    return number or None


def leading_number(value: str) -> str | None:
    number = ""
    for char in value.strip():
        if char.isdigit():
            number += char
            continue
        break
    return number or None


def leading_point_code(value: str) -> str | None:
    prefix, separator, _ = value.strip().partition(")")
    if not separator:
        return None
    prefix = prefix.strip().lower()
    return prefix if 0 < len(prefix) <= 2 else None


def summarize(observations: list[dict[str, Any]]) -> dict[str, Any]:
    by_effect: dict[str, int] = {}
    by_type_code: dict[str, int] = {}
    transitions: dict[str, int] = {}
    for observation in observations:
        effect = str(observation["effectKind"])
        by_effect[effect] = by_effect.get(effect, 0) + 1
        type_marker = observation.get("type")
        new_type_marker = observation.get("newType")
        if isinstance(type_marker, dict):
            type_code = str(type_marker["typeCode"])
            by_type_code[type_code] = by_type_code.get(type_code, 0) + 1
        if isinstance(type_marker, dict) and isinstance(new_type_marker, dict):
            transition = f"{type_marker['typeCode']}->{new_type_marker['typeCode']}"
            transitions[transition] = transitions.get(transition, 0) + 1
    return {
        "observationCount": len(observations),
        "byEffectKind": by_effect,
        "byTypeCode": by_type_code,
        "transitions": transitions,
    }


def sha256(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()}"


def required(values: dict[str, Any], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Source manifest is missing {key}")
    return value
