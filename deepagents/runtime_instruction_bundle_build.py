"""Deterministic compiler for reviewable EN runtime-bundle candidates.

This compiler never translates or approves content.  It copies only declared,
UTF-8 candidate assets and binds them to the exact Vietnamese source bytes.
"""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
from typing import Any

from runtime_instruction_bundle import RuntimeInstructionBundleError


SCHEMA_VERSION = "LCSP_EN_RUNTIME_BUNDLE_V1"


def _sha(value: bytes) -> str:
    """Business purpose: Hash deterministic build inputs.

    Business rules:
    - Use exact input bytes without language or newline conversion.
    Execution flow:
    1. Compute the SHA-256 identity.
    Failure cases:
    - Invalid byte input propagates an error.
    Side effects:
    - None: pure hashing.
    """
    return sha256(value).hexdigest()


def _read_utf8(root: Path, raw: object, code: str) -> tuple[str, bytes]:
    """Business purpose: Read a safe, nonempty UTF-8 build asset.

    Business rules:
    - Unsafe paths, missing files and invalid encoding must block compilation.
    Execution flow:
    1. Resolve the source-relative path, read bytes and validate UTF-8 content.
    Failure cases:
    - Malformed or absent assets raise a stable build error.
    Side effects:
    - Read source or candidate bytes only.
    """
    if not isinstance(raw, str) or not raw or Path(raw).is_absolute() or ".." in Path(raw).parts:
        raise RuntimeInstructionBundleError(code)
    from instruction_source_inventory import safe_path

    path = safe_path(root, raw)
    try:
        data = path.read_bytes()
        data.decode("utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise RuntimeInstructionBundleError(code) from error
    if not data:
        raise RuntimeInstructionBundleError(code)
    return raw, data


def compile_candidate(source_root: Path, inventory_path: Path, output_path: Path) -> dict[str, Any]:
    """Business purpose: Compile a reproducible pending English bundle from version-bound candidates.

    Business rules:
    - Every required source needs matching origin and candidate hashes plus provenance; the compiler never grants approval.
    Execution flow:
    1. Validate inventory and candidates, compute deterministic aggregate hashes and write a PENDING manifest.
    Failure cases:
    - Incomplete, stale, corrupt or unsafe translation inputs prevent publication.
    Side effects:
    - Write the candidate manifest without generating reviewer identities or production approval.
    """
    try:
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_INVENTORY_INVALID") from error
    if not isinstance(inventory, dict) or inventory.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_INVENTORY_INVALID")
    records = inventory.get("entries")
    if not isinstance(records, list) or not records:
        raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_ENTRIES_MISSING")
    if "constructionSites" in inventory:
        from instruction_source_inventory import validate_inventory

        validate_inventory(source_root, inventory_path)
    # Report the complete translation backlog before attempting any publication.
    missing = sorted(row["sourceId"] for row in records if isinstance(row, dict) and not row.get("englishCandidatePath"))
    if missing:
        raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_CANDIDATES_MISSING:" + ",".join(missing))
    if "constructionSites" in inventory:
        # Candidate compilation cannot approve or activate framework controls.
        # Production loading separately requires the full strict control gate.
        validate_inventory(source_root, inventory_path, require_complete=True, require_framework_control=False)
    entries: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in sorted(records, key=lambda row: row.get("sourceId", "") if isinstance(row, dict) else ""):
        if not isinstance(row, dict) or not isinstance(row.get("sourceId"), str) or not row["sourceId"] or row["sourceId"] in seen:
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_DUPLICATE_SOURCE_ID")
        seen.add(row["sourceId"])
        vi_path, vi = _read_utf8(source_root, row.get("vietnameseSourcePath"), "RUNTIME_BUNDLE_SOURCE_INVALID")
        if "sourceSha256" in row and _sha(vi) != row["sourceSha256"]:
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_SOURCE_DRIFT")
        if "constructionSites" in inventory and "candidateOriginSha256" in row and row.get("candidateOriginSha256") != _sha(vi):
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_CANDIDATE_STALE")
        en_path, en = _read_utf8(source_root, row.get("englishCandidatePath"), "RUNTIME_BUNDLE_CANDIDATE_INVALID")
        if "constructionSites" in inventory:
            if "englishCandidateSha256" in row and row.get("englishCandidateSha256") != _sha(en):
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_CANDIDATE_DRIFT")
            provenance = row.get("translationProvenance")
            if provenance is not None and not isinstance(provenance, dict):
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_TRANSLATION_PROVENANCE_MISSING")
        revision = row.get("vietnameseSourceRevision", "r1")
        entries.append({"sourceId": row["sourceId"], "vietnameseSourcePath": vi_path, "vietnameseSourceRevision": revision,
                        "vietnameseSourceSha256": _sha(vi), "englishRuntimePath": en_path, "englishRuntimeSha256": _sha(en)})
    inventory_rows = [{"sourceId": item["sourceId"], "sha256": item["vietnameseSourceSha256"]} for item in entries]
    runtime_rows = [{"sourceId": item["sourceId"], "sha256": item["englishRuntimeSha256"]} for item in entries]
    bundle_id = inventory.get("bundleId") or "candidate-r1"
    payload = {"bundleSchemaVersion": SCHEMA_VERSION, "bundleId": bundle_id, "approvalStatus": "PENDING",
               "vietnameseInventorySha256": _sha(json.dumps(sorted(inventory_rows, key=lambda x: x["sourceId"]), separators=(",", ":"), ensure_ascii=False).encode("utf-8")),
               "englishBundleSha256": _sha(json.dumps(sorted(runtime_rows, key=lambda x: x["sourceId"]), separators=(",", ":"), ensure_ascii=False).encode("utf-8")), "entries": entries}
    if not isinstance(payload["bundleId"], str) or not payload["bundleId"]:
        raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_ID_INVALID")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes((json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    return payload
