"""Materialize the one pinned corpus as a read-only file tree for the agent."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

CORPUS_ROOT = "/corpus"
INDEX_PATH = f"{CORPUS_ROOT}/INDEX.md"
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


def chunk_file_name(locator: str) -> str:
    """Filesystem-safe name for a locator; the exact locator stays in the file header."""
    return _UNSAFE.sub("_", locator.replace("::", "__")) + ".md"


def _chunk_path(document_id: str, locator: str) -> str:
    return f"{CORPUS_ROOT}/{_UNSAFE.sub('_', document_id)}/{chunk_file_name(locator)}"


def materialize_corpus(bundle: dict[str, Any], root: Path) -> list[str]:
    """Write INDEX.md and one file per chunk under ``root``; return the virtual paths.

    Every file states the exact ``documentId``/``locator``/``contentSha256`` the agent
    must cite. Nothing outside the bundle (no assessment, customer or repository data)
    is ever written here.
    """
    corpus_dir = root / CORPUS_ROOT.lstrip("/")
    corpus_dir.mkdir(parents=True, exist_ok=True)
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
                        f"legalStatus: {chunk['legalStatus']}",
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
                f"| {chunk['legalStatus']} | {virtual} |"
            )
    header = [
        f"# Pinned corpus {bundle['corpusVersion']}",
        "",
        f"legalCorpusVersionId: {bundle['legalCorpusVersionId']}",
        f"documents: {len(bundle['documents'])}",
        f"chunks: {len(rows)}",
        "",
        "Cite a source exactly as `documentId` + `locator` + `contentSha256` from this table.",
        "",
        "| documentId | locator | contentSha256 | legalStatus | file |",
        "|---|---|---|---|---|",
    ]
    (corpus_dir / "INDEX.md").write_text("\n".join([*header, *rows, ""]), encoding="utf-8")
    return paths
