"""Build an inventory-bound EN instruction manifest without approval or SHA-256.

The compiler copies only registered source/candidate references. It verifies
presence, non-empty UTF-8 content and safe paths. Human sign-off and checksums
are neither generated nor required to edit or run an instruction.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from runtime_instruction_bundle import RuntimeInstructionBundleError

SCHEMA_VERSION = "LCSP_EN_RUNTIME_BUNDLE_V1"


def _read_utf8(root: Path, raw: object, code: str) -> str:
    """Business purpose: Validate one registered source or English instruction asset.

    Business rules:
    - No approval or checksum is required; files must be non-empty UTF-8.
    Execution flow:
    1. Resolve the path beneath the given asset root.
    2. Validate UTF-8 content and return the relative path.
    Failure cases:
    - Missing, invalid, empty or unsafe paths fail closed with a stable error.
    Side effects:
    - Read one file; do not mutate its contents.
    """
    if not isinstance(raw, str) or not raw:
        raise RuntimeInstructionBundleError(code)
    from instruction_source_inventory import safe_path
    try:
        path = safe_path(root, raw)
        content = path.read_text(encoding="utf-8")
    except RuntimeInstructionBundleError:
        raise
    except (OSError, UnicodeError, ValueError, TypeError) as error:
        raise RuntimeInstructionBundleError(code) from error
    if not content.strip():
        raise RuntimeInstructionBundleError(code)
    return raw


def compile_candidate(source_root: Path, inventory_path: Path, output_path: Path) -> dict[str, Any]:
    """Business purpose: Produce a complete VI/EN instruction asset registry.

    Business rules:
    - Human sign-off and SHA-256 are not prerequisites for instruction updates.
    - Duplicate IDs, missing text, bad encoding and unsafe paths are prohibited.
    Execution flow:
    1. Validate registered identities and resolve Vietnamese and English asset paths.
    2. Write a deterministic manifest containing paths, not hashes or approval records.
    Failure cases:
    - Invalid inventory, missing required assets or mismatched source sets reject output.
    Side effects:
    - Persist the generated registry file, without editing instruction sources.
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
    missing = sorted(row["sourceId"] for row in records
                     if isinstance(row, dict) and not row.get("englishCandidatePath"))
    if missing:
        raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_CANDIDATES_MISSING:" + ",".join(missing))
    if "constructionSites" in inventory:
        from instruction_source_inventory import validate_inventory
        validate_inventory(source_root, inventory_path, require_complete=True,
                           require_framework_control=False)
    entries: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in sorted(records, key=lambda x: x.get("sourceId", "") if isinstance(x, dict) else ""):
        if not isinstance(row, dict) or not isinstance(row.get("sourceId"), str) or not row["sourceId"] or row["sourceId"] in seen:
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_DUPLICATE_SOURCE_ID")
        sid = row["sourceId"]
        seen.add(sid)
        vi = _read_utf8(source_root, row.get("vietnameseSourcePath"), "RUNTIME_BUNDLE_SOURCE_INVALID")
        en = _read_utf8(source_root, row.get("englishCandidatePath"), "RUNTIME_BUNDLE_CANDIDATE_INVALID")
        entries.append({
            "sourceId": sid, "vietnameseSourcePath": vi,
            "vietnameseSourceRevision": row.get("vietnameseSourceRevision") or "current",
            "englishRuntimePath": en,
        })
    required = inventory.get("requiredSourceIds")
    if isinstance(required, list) and (len(required) != len(entries) or set(required) != seen):
        raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_SOURCE_INVENTORY_MISMATCH")
    payload = {
        "bundleSchemaVersion": SCHEMA_VERSION,
        "bundleId": inventory.get("bundleId") or "current-instructions",
        "approvalRequired": False,
        "entries": entries,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload
