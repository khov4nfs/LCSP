"""English runtime instruction loading without manual approval or SHA-256 checks.

Vietnamese is maintained as the source and English as the execution language.
Run-local snapshots preserve exact text, while the inventory defines allowed
instruction identities and paths. SHA metadata from legacy bundles is not a gate.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Callable, Collection, Mapping


class RuntimeInstructionBundleError(ValueError):
    """Stable fail-closed error raised before a model can be constructed."""


TrustedApprovalVerifier = Callable[[Mapping[str, object]], bool]

_RUNTIME_BUNDLE_CACHE: "ApprovedEnglishRuntimeBundle" | None = None
_SCOPED_RUNTIME_BUNDLE: ContextVar["ApprovedEnglishRuntimeBundle | None"] = ContextVar("scoped_runtime_instruction_bundle", default=None)


def clear_runtime_bundle_cache() -> None:
    """Business purpose: Reset the in-memory runtime instruction bundle cache.

    Business rules:
    - Used during testing or environment reload to force fresh asset loading.

    Execution flow:
    1. Reset the module-level bundle cache reference to None.

    Failure cases:
    - None: always succeeds.

    Side effects:
    - Clears in-memory bundle cache.
    """
    global _RUNTIME_BUNDLE_CACHE
    _RUNTIME_BUNDLE_CACHE = None


def production_runtime_bundle(*, fresh: bool = False) -> "ApprovedEnglishRuntimeBundle":
    """Business purpose: Load registered EN model instructions without approval or SHA checks.

    Business rules:
    - Use only inventory-registered VI/EN paths; neither approval nor content hash gates loading.
    - Process caching and run-local snapshots preserve stable text during a model invocation.
    Execution flow:
    1. Resolve the registered instruction paths and reject incomplete or duplicate identities.
    2. Read non-empty UTF-8 source and runtime text, then create the immutable run view.
    Failure cases:
    - Missing, empty, unsafe, malformed or unregistered assets fail closed.
    Side effects:
    - Read instruction files and optionally cache a process-scoped bundle.
    """
    global _RUNTIME_BUNDLE_CACHE
    scoped = _SCOPED_RUNTIME_BUNDLE.get()
    if scoped is not None:
        return scoped
    if _RUNTIME_BUNDLE_CACHE is not None and not fresh:
        return _RUNTIME_BUNDLE_CACHE

    from instruction_source_inventory import ROOT, safe_path

    try:
        inventory = json.loads((ROOT / "instructions/inventory.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeInstructionBundleError("INSTRUCTION_INVENTORY_MISSING_OR_INVALID") from error
    if not isinstance(inventory, dict) or inventory.get("schemaVersion") != "LCSP_EN_RUNTIME_BUNDLE_V1":
        raise RuntimeInstructionBundleError("INSTRUCTION_INVENTORY_VERSION")
    rows, required = inventory.get("entries"), inventory.get("requiredSourceIds")
    if not isinstance(rows, list) or not rows or not isinstance(required, list):
        raise RuntimeInstructionBundleError("INSTRUCTION_INVENTORY_INCOMPLETE")

    entries: dict[str, RuntimeInstructionEntry] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeInstructionBundleError("INSTRUCTION_ENTRY_INVALID")
        source_id = _required_string(row.get("sourceId"), "INSTRUCTION_ENTRY_ID_INVALID")
        if source_id in entries:
            raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_DUPLICATE")
        try:
            origin = safe_path(ROOT, row.get("vietnameseSourcePath")).read_text(encoding="utf-8")
            english = safe_path(ROOT, row.get("englishCandidatePath")).read_text(encoding="utf-8")
        except (OSError, UnicodeError, TypeError, ValueError) as error:
            raise RuntimeInstructionBundleError("INSTRUCTION_ASSET_MISSING_OR_INVALID") from error
        if not origin.strip() or not english.strip():
            raise RuntimeInstructionBundleError("INSTRUCTION_ENTRY_EMPTY")
        entries[source_id] = RuntimeInstructionEntry(
            source_id=source_id,
            vietnamese_source_revision=row.get("vietnameseSourceRevision") or "current",
            vietnamese_origin_sha256="",
            english_runtime_sha256="",
            english_runtime=english,
        )
    if (len(required) != len(entries) or not all(isinstance(x, str) for x in required)
            or set(required) != set(entries)):
        raise RuntimeInstructionBundleError("INSTRUCTION_REQUIRED_SOURCES_MISMATCH")

    bundle = ApprovedEnglishRuntimeBundle(
        bundle_id=inventory.get("bundleId") or "current-instructions",
        vietnamese_inventory_sha256="",
        english_bundle_sha256="",
        approval_identity="NOT_REQUIRED",
        approval_revision="NOT_REQUIRED",
        entries=entries,
    )
    if not fresh:
        _RUNTIME_BUNDLE_CACHE = bundle
    return bundle

@contextmanager
def runtime_instruction_snapshot():
    """Business purpose: Pin fresh development instruction bytes for one selected Preparation revision.

    Business rules:
    - Editing development instructions needs no publication workflow; concurrent runs retain their own immutable in-memory view.
    Execution flow:
    1. Load fresh runtime assets and set a context-local bundle.
    2. Yield the bundle and restore the previous context on every exit.
    Failure cases:
    - Missing/invalid assets fail before a model can be constructed.
    Side effects:
    - Reads instruction assets and temporarily binds this invocation's bundle; never clears another run's cache.
    """
    bundle = production_runtime_bundle(fresh=True)
    token = _SCOPED_RUNTIME_BUNDLE.set(bundle)
    try:
        yield bundle
    finally:
        _SCOPED_RUNTIME_BUNDLE.reset(token)


def runtime_instruction(source_id: str, key: str | None = None) -> str:
    """Business purpose: Resolve one English instruction or keyed asset from the instruction set.

    Business rules:
    - There is no locale selection or legacy prompt fallback.
    Execution flow:
    1. Load the verified bundle, select the entry and validate a keyed string when requested.
    Failure cases:
    - Missing, invalid or empty entries fail closed.
    Side effects:
    - Read runtime assets only.
    """
    text = production_runtime_bundle().instruction(source_id)
    if key is not None:
        try:
            text = json.loads(text)[key]
        except (ValueError, KeyError, TypeError) as error:
            raise RuntimeInstructionBundleError("INSTRUCTION_ENTRY_MISSING:" + source_id + ":" + key) from error
    if not isinstance(text, str) or not text.strip():
        raise RuntimeInstructionBundleError("INSTRUCTION_ENTRY_MISSING:" + source_id)
    return text


def _required_string(value: object, code: str) -> str:
    """Business purpose: Require a nonblank manifest metadata value.

    Business rules:
    - Absent or blank identities must not become guessed approval or source metadata.
    Execution flow:
    1. Validate the type and nonblank content, then return the value.
    Failure cases:
    - Raise the caller-specified stable bundle error for invalid values.
    Side effects:
    - None: validates one manifest field.
    """
    if not isinstance(value, str) or not value.strip():
        raise RuntimeInstructionBundleError(code)
    return value


def _safe_relative_path(value: object, code: str) -> Path:
    """Business purpose: Constrain bundle file access to the configured artifact root.

    Business rules:
    - Absolute, traversal and escaping paths are forbidden.
    Execution flow:
    1. Validate and resolve the relative asset path under root.
    Failure cases:
    - Unsafe paths reject loading before content is used.
    Side effects:
    - Resolve paths without changing assets.
    """
    raw = _required_string(value, code)
    path = Path(raw)
    if path.is_absolute() or ".." in path.parts:
        raise RuntimeInstructionBundleError(code)
    return path


def _read_asset(root: Path, relative: object, code: str) -> bytes:
    """Business purpose: Read one trusted-path instruction file without a checksum.

    Business rules:
    - Resolve paths within the configured root and require non-empty valid UTF-8 text.
    Execution flow:
    1. Normalize the relative path and resolve it under the trusted asset root.
    2. Read and validate the exact text bytes.
    Failure cases:
    - Missing, empty, invalid-encoding or escaping paths are rejected.
    Side effects:
    - Read one file without changing filesystem or runtime state.
    """
    resolved_root = root.resolve()
    path = (resolved_root / _safe_relative_path(relative, code)).resolve()
    if not path.is_relative_to(resolved_root):
        raise RuntimeInstructionBundleError(code)
    try:
        data = path.read_bytes()
        if not data or not data.decode("utf-8").strip():
            raise RuntimeInstructionBundleError(code)
    except (OSError, UnicodeError) as error:
        raise RuntimeInstructionBundleError(code) from error
    return data

@dataclass(frozen=True)
class RuntimeInstructionEntry:
    """One model-facing instruction from the declared English instruction set."""

    source_id: str
    vietnamese_source_revision: str
    vietnamese_origin_sha256: str
    english_runtime_sha256: str
    english_runtime: str


@dataclass(frozen=True)
class ApprovedEnglishRuntimeBundle:
    """An immutable English runtime snapshot; approval is not required."""

    bundle_id: str
    vietnamese_inventory_sha256: str
    english_bundle_sha256: str
    approval_identity: str
    approval_revision: str
    entries: Mapping[str, RuntimeInstructionEntry]

    @classmethod
    def load(
        cls,
        root: Path,
        manifest_path: Path,
        *,
        expected_entry_ids: Collection[str] | None = None,
        approval_verifier: TrustedApprovalVerifier | None = None,
        allow_pending: bool = False,
    ) -> "ApprovedEnglishRuntimeBundle":
        """Business purpose: Build an immutable instruction view from a trusted approved or candidate manifest.

        Business rules:
        - Revoked, duplicate and incomplete entries cannot be loaded.
        - Pending status is allowed when allow_pending is true to support developer workflows.
        - Manifest schema version must be supported.

        Execution flow:
        1. Validate manifest payload, schema version, and approval status.
        2. Resolve approval identity, revision, and optional verification callback.
        3. Read and hash each origin and runtime asset, then verify aggregate digests and required IDs.

        Failure cases:
        - Schema, revoked status, unapproved non-pending status, UTF-8, path, or digest failures reject loading.

        Side effects:
        - Read instruction bundle artifacts and return their verified runtime representation.
        """
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_MISSING_OR_INVALID") from error
        if not isinstance(payload, dict):
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_MISSING_OR_INVALID")
        if payload.get("bundleSchemaVersion") != "LCSP_EN_RUNTIME_BUNDLE_V1":
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_VERSION_UNSUPPORTED")
        if payload.get("approvalStatus") == "REVOKED":
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_REVOKED")
        status = payload.get("approvalStatus")
        # Historical approval status is ignored: instruction loading needs no reviewer.
        # An explicit REVOKED marker remains a separate administrative disable switch.
        bundle_id = payload.get("bundleId") or "current-instructions"
        approver = "NOT_REQUIRED"
        approval_revision = "NOT_REQUIRED"
        entries_payload = payload.get("entries")
        if not isinstance(entries_payload, list) or not entries_payload:
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_ENTRIES_MISSING")
        entries: dict[str, RuntimeInstructionEntry] = {}
        inventory_rows: list[dict[str, str]] = []
        english_rows: list[dict[str, str]] = []
        for item in entries_payload:
            if not isinstance(item, dict):
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_ENTRY_INVALID")
            source_id = _required_string(item.get("sourceId"), "RUNTIME_BUNDLE_ENTRY_ID_INVALID")
            if source_id in entries:
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_DUPLICATE_SOURCE_ID")
            vietnamese = _read_asset(root, item.get("vietnameseSourcePath"), "RUNTIME_BUNDLE_SOURCE_MISSING_OR_INVALID")
            english = _read_asset(root, item.get("englishRuntimePath"), "RUNTIME_BUNDLE_RUNTIME_MISSING_OR_INVALID")
            source_revision = item.get("vietnameseSourceRevision") or "current"
            entries[source_id] = RuntimeInstructionEntry(
                source_id=source_id,
                vietnamese_source_revision=source_revision,
                vietnamese_origin_sha256="",
                english_runtime_sha256="",
                english_runtime=english.decode("utf-8"),
            )
        if expected_entry_ids is not None and set(entries) != set(expected_entry_ids):
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_SOURCE_INVENTORY_MISMATCH")
        return cls(bundle_id, "", "", approver, approval_revision, entries)

    def instruction(self, source_id: str) -> str:
        """Business purpose: Return the exact verified English bytes for a declared source identity.

        Business rules:
        - An absent instruction cannot fall back to another source or language.
        Execution flow:
        1. Look up the requested source and return its loaded runtime text.
        Failure cases:
        - RUNTIME_BUNDLE_ENTRY_MISSING rejects unknown source IDs.
        Side effects:
        - None: reads the immutable bundle view.
        """
        try:
            return self.entries[source_id].english_runtime
        except KeyError as error:
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_ENTRY_MISSING") from error

    def manifest_metadata(self) -> dict[str, Any]:
        """Business purpose: Expose verified source and runtime fingerprints for run receipts.

        Business rules:
        - Receipt hashes describe loaded assets and retain independent approval identity.
        Execution flow:
        1. Project bundle identity, approval revision and sorted per-entry digests.
        Failure cases:
        - No provider usage or legal approval is inferred from these hashes.
        Side effects:
        - None: creates a metadata projection.
        """
        return {
            "runtimeInstructionBundleId": self.bundle_id,
            "instructionVersioning": "EXACT_RUN_SNAPSHOT",
            "approvalRequired": False,
            "instructionIds": sorted(self.entries),
        }
