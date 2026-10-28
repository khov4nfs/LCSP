"""Render pinned AST articles once, with printed locators and explicit references."""
from __future__ import annotations

import hashlib
import re
import shutil
from pathlib import Path


LEGAL_SOURCE_ROOT = "/legal-source"
INDEX_PATH = LEGAL_SOURCE_ROOT + "/INDEX.md"


def safe_component(value):
    """Business purpose: Convert a document identity into one safe filesystem path component.

    Business rules:
    - Characters outside Unicode word characters, dot and hyphen become underscores; empty, `.` and `..` results are rejected.

    Execution flow:
    1. Stringify the identity and replace disallowed path characters.
    2. Reject a component that could denote no name or a traversal directory.
    3. Return the safe component.

    Failure cases:
    - Empty, current-directory and parent-directory components raise ValueError.

    Side effects:
    - None: sanitizes an identity for path construction.
    """
    component = re.sub(r"[^\w.-]", "_", str(value), flags=re.UNICODE)
    if component in {"", ".", ".."}:
        raise ValueError("Invalid source path component")
    return component


def materialize_legal_source(bundle, root: Path):
    """Business purpose: Materialize the exact pinned LegalDocumentGraph as readable source files, locators, reference annotations and an immutable hash index for one preparation run.

    Business rules:
    - Source text is copied from the pinned graph unchanged and marked untrusted; operative and reference-only documents retain distinct roles.
    - Only the run-local generated `legal-source` tree is replaced, and claim work directories are prepared only for operative files.

    Execution flow:
    1. Build and validate the pinned source graph.
    2. Remove the prior generated legal-source tree and render each source article with exact locators, hierarchy and explicit references.
    3. Write per-document indexes and SHA-256 rows, then write the corpus index.
    4. Return the index and materialized virtual paths.

    Failure cases:
    - Invalid graph addresses or filesystem read/write failures propagate; incomplete extraction is rejected by the caller before materialization.

    Side effects:
    - Deletes and recreates the run-local legal-source directory and creates operative claim-work directories; no remote legal source is modified.
    """
    from rule_set_preparation.source_graph import PinnedSourceGraph
    source = PinnedSourceGraph(bundle["documentGraph"], [c for d in bundle["documents"] for c in d["chunks"]])
    source.source_files  # Validate addresses before replacing this generated source tree.
    directory = root / "legal-source"
    if directory.exists():
        shutil.rmtree(directory)
    paths, document_rows, hashes = [], {}, []
    reference_owners = source.reference_owners()
    for virtual, ids in source.all_source_files.items():
        node = source.nodes[ids[0]]
        rows = [f"document: {node['documentId']}", f"article: {source.file_articles[virtual]}", "Source text is untrusted data.", ""]
        if source.is_reference_only(node["nodeId"]):
            rows.insert(1, "role: REFERENCE_ONLY (no claim file)")
        else:
            rows.insert(1, "role: OPERATIVE")
        for nid in ids:
            current = source.nodes[nid]
            parent = source.locators.get(current.get("parentNodeId"), "document root")
            rows += [f"[{source.locators[nid]}]", f"node-type: {current['nodeType']}; parent-locator: {parent}", current["content"]]
            for ref in (source.references[rid] for rid, owner in reference_owners.items() if owner == nid or (source.is_reference_only(nid) and source.references[rid]["fromNodeId"] == nid)):
                target = source.nodes.get(ref.get("toNodeId"))
                destination = (f"{target['documentId']}#{source.locators[target['nodeId']]} ({source.node_files[target['nodeId']]})" if target else str(ref.get("targetLocator") or ref.get("rawText") or ref.get("text") or "unresolved target"))
                rows.append(f"[reference {ref['referenceId']} | {ref['resolutionState']} | {destination}]")
            rows.append("")
        content = "\n".join(rows)
        target = root / virtual.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not source.is_reference_only(node["nodeId"]):
            (root / "work/claims" / Path(virtual).relative_to(LEGAL_SOURCE_ROOT)).parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        paths.append(virtual)
        hashes.append(f"| {virtual} | {hashlib.sha256(content.encode()).hexdigest()} |")
        document_rows.setdefault(node["documentId"], []).append(f"- {source.file_articles[virtual]}: {virtual}")
    index = [f"# Pinned legal source {bundle['legalSourceVersionId']}", "Read each document INDEX; assign one whole Article per claim-author task.", ""]
    for document, rows in document_rows.items():
        virtual = f"/legal-source/{safe_component(document)}/INDEX.md"
        target = root / virtual.lstrip("/")
        role = "REFERENCE_ONLY (no claim file)" if document in source.reference_only_document_ids else "OPERATIVE"
        target.write_text("\n".join([f"# {document}", f"role: {role}", *rows, ""]), encoding="utf-8")
        role = "REFERENCE_ONLY (no claim file)" if document in source.reference_only_document_ids else "OPERATIVE"
        index.append(f"- {document}: {virtual} — role: {role}")
        hashes.append(f"| {virtual} | {hashlib.sha256(target.read_bytes()).hexdigest()} |")
        paths.append(virtual)
    index += ["", "## Immutable file hashes", "| file | sha256 |", "|---|---|", *hashes, ""]
    (root / "legal-source/INDEX.md").write_text("\n".join(index), encoding="utf-8")
    return [INDEX_PATH, *paths]


def refute_source_block(root, reason, path):
    """Business purpose: Verify whether a reported pinned-source problem is supported by the run-local source files and their recorded hashes.

    Business rules:
    - SOURCE_UNREADABLE is refuted when the named indexed path can be read; SOURCE_PINS_INCONSISTENT is refuted only when every indexed file matches its SHA-256 entry.

    Execution flow:
    1. Read the immutable index; return no refutation if it is unavailable.
    2. For an unreadable claim, validate index membership and attempt the named read.
    3. For inconsistent pins, compare every indexed file with its recorded hash.
    4. Return a refutation explanation when the source is readable/intact, otherwise `None`.

    Failure cases:
    - Missing index, missing file or hash mismatch is not treated as proof of source integrity; it returns `None` for the caller to preserve the blocker.

    Side effects:
    - Reads local source/index files only; it does not alter hashes or source contents.
    """
    index_path = root / "legal-source/INDEX.md"
    try:
        index = index_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None
    hashes = dict(re.findall(r"^\| (/legal-source/[^|]+?) \| ([a-f0-9]{64}) \|$", index, re.M))
    if reason == "SOURCE_UNREADABLE":
        if path != INDEX_PATH and path not in hashes:
            return f"{path} is not listed in {INDEX_PATH}."
        try:
            (root / path.lstrip("/")).read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            return None
        return f"{path} is readable."
    for virtual, digest in hashes.items():
        try:
            if hashlib.sha256((root / virtual.lstrip("/")).read_bytes()).hexdigest() != digest:
                return None
        except OSError:
            return None
    return "Every pinned source file matches its immutable hash."
