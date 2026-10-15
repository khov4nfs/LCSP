"""Materialize the one pinned legal_source as a read-only file tree for the agent."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

LEGAL_SOURCE_ROOT = "/legal-source"
INDEX_PATH = f"{LEGAL_SOURCE_ROOT}/INDEX.md"
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


def chunk_file_name(locator: str) -> str:
    """Filesystem-safe name for a locator; the exact locator stays in the file header."""
    return _UNSAFE.sub("_", locator.replace("::", "__")) + ".md"


def _chunk_path(document_id: str, locator: str) -> str:
    return f"{LEGAL_SOURCE_ROOT}/{_UNSAFE.sub('_', document_id)}/{chunk_file_name(locator)}"


def materialize_legal_source(bundle: dict[str, Any], root: Path) -> list[str]:
    """Write INDEX.md and one file per chunk under ``root``; return the virtual paths.

    Every file states the exact ``documentId``/``locator``/``contentSha256`` the agent
    must cite. Nothing outside the bundle (no assessment, customer or repository data)
    is ever written here.
    """
    legal_source_dir = root / LEGAL_SOURCE_ROOT.lstrip("/")
    legal_source_dir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = [INDEX_PATH]
    rows: list[str] = []
    for document in bundle["documents"]:
        document_id = document["documentId"]
        for chunk in document["chunks"]:
            virtual = _chunk_path(document_id, chunk["locator"])
            target = root / virtual.lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            hierarchy = json.dumps(chunk.get("hierarchy"), ensure_ascii=False, sort_keys=True)
            target.write_text(
                "\n".join(
                    [
                        f"documentId: {document_id}",
                        f"locator: {chunk['locator']}",
                        f"contentSha256: {chunk['contentSha256']}",
                        f"legalEffectStatus: {chunk['legalEffectStatus']}",
                        f"legalStatusSourceRef: {chunk.get('legalStatusSourceRef') or 'UNKNOWN'}",
                        f"sourceEffectStatus: {document['sourceEffectStatus']}",
                        f"hierarchy: {hierarchy}",
                        "---",
                        chunk["content"],
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            paths.append(virtual)
            rows.append(
                f"| {document_id} | {chunk['locator']} | {chunk['contentSha256']} "
                f"| {chunk['legalEffectStatus']} | {virtual} |"
            )
    header = [
        f"# Pinned legal_source {bundle['legalSourceVersion']}",
        "",
        f"legalSourceVersionId: {bundle['legalSourceVersionId']}",
        f"documents: {len(bundle['documents'])}",
        f"chunks: {len(rows)}",
        "",
        "Cite a source exactly as `documentId` + `locator` + `contentSha256` from this table.",
        "",
        "| documentId | locator | contentSha256 | legalEffectStatus | file |",
        "|---|---|---|---|---|",
    ]
    (legal_source_dir / "INDEX.md").write_text("\n".join([*header, *rows, ""]), encoding="utf-8")
    return paths


def _read(root: Path, virtual: str) -> str | None:
    try:
        return (root / virtual.lstrip("/")).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _index_rows(index: str) -> dict[str, tuple[str, str, str]]:
    """Map each file path in the INDEX table to its (documentId, locator, contentSha256)."""
    rows: dict[str, tuple[str, str, str]] = {}
    for line in index.splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) == 5 and cells[4].startswith(f"{LEGAL_SOURCE_ROOT}/"):
            rows[cells[4]] = (cells[0], cells[1], cells[2])
    return rows


def read_pins(root: Path) -> dict[tuple[str, str], str]:
    """The pinned (documentId, locator) -> contentSha256 table of INDEX.md; empty when unreadable."""
    index = _read(root, INDEX_PATH)
    if index is None:
        return {}
    return {(document_id, locator): sha for document_id, locator, sha in _index_rows(index).values()}


def _header(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in text.split("\n---\n", 1)[0].splitlines():
        name, _, value = line.partition(": ")
        fields[name] = value
    return fields


def refute_source_block(root: Path, reason: str, path: str) -> str | None:
    """Why an agent's source-blocking claim is false, or ``None`` when the tree backs it up.

    A claim only ends the run without submission when the materialized pinned source really is
    unreadable or its INDEX pins disagree with the chunk files. Anything else (a readable file,
    a consistent tree, a path the INDEX does not list) is unfinished work, not a blocked source.
    """
    index = _read(root, INDEX_PATH)
    if index is None:
        return None  # INDEX.md is the entry point of the pinned source: nothing is readable.
    rows = _index_rows(index)
    if reason == "SOURCE_UNREADABLE":
        if path != INDEX_PATH and path not in rows:
            return f"{path} is not a pinned source file listed in {INDEX_PATH}."
        return None if _read(root, path) is None else f"{path} is readable."
    for virtual, pin in rows.items():
        text = _read(root, virtual)
        header = _header(text) if text is not None else {}
        if (header.get("documentId"), header.get("locator"), header.get("contentSha256")) != pin:
            return None
    return "Every INDEX pin matches its chunk file."
