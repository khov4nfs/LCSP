"""Verified, build-time English runtime instruction bundles.

The runtime may consume English instruction bytes only from an independently
approved bundle.  Vietnamese source remains outside the runtime selection path:
it is hashed solely to prove the exact reviewed origin.  This module does not
translate, approve, or fall back between languages.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
from typing import Any, Callable, Collection, Mapping


class RuntimeInstructionBundleError(ValueError):
    """Stable fail-closed error raised before a model can be constructed."""


TrustedApprovalVerifier = Callable[[Mapping[str, object]], bool]

_RUNTIME_BUNDLE_CACHE: "ApprovedEnglishRuntimeBundle" | None = None


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


def production_runtime_bundle() -> "ApprovedEnglishRuntimeBundle":
    """Business purpose: Load runtime English instructions directly into the agent.

    Business rules:
    - Instructions are loaded directly from disk without manifest or SHA guard checks.
    - In-memory caching ensures instructions are read once per process.

    Execution flow:
    1. Return cached bundle if already loaded in memory.
    2. Read English candidate instruction files directly from disk into runtime entries.
    3. Construct and cache the runtime bundle.

    Failure cases:
    - If no instruction files can be found, raise RuntimeInstructionBundleError.

    Side effects:
    - Reads text files from disk and caches the bundle in memory.
    """
    global _RUNTIME_BUNDLE_CACHE
    if _RUNTIME_BUNDLE_CACHE is not None:
        return _RUNTIME_BUNDLE_CACHE

    from instruction_source_inventory import ROOT

    entries: dict[str, RuntimeInstructionEntry] = {}

    candidate_dir = ROOT / "instructions/candidates/r1"
    if candidate_dir.exists():
        for file in sorted(candidate_dir.glob("*.txt")):
            sid = file.stem
            try:
                text = file.read_text(encoding="utf-8")
            except OSError:
                continue
            text_sha = sha256(text.encode("utf-8")).hexdigest()
            entries[sid] = RuntimeInstructionEntry(
                source_id=sid,
                vietnamese_source_revision="r1",
                vietnamese_origin_sha256="",
                english_runtime_sha256=text_sha,
                english_runtime=text,
            )

    configured = os.environ.get("LCSP_RUNTIME_INSTRUCTION_MANIFEST")
    manifest_path = Path(configured) if configured else ROOT / "instructions/candidates/r1/manifest.json"
    if not manifest_path.exists():
        manifest_path = ROOT / "instructions/candidates/r1/manifest.pending.json"
    if manifest_path.exists():
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            for item in payload.get("entries", []):
                sid = item.get("sourceId")
                if not sid or sid in entries:
                    continue
                en_path = ROOT / item.get("englishRuntimePath", "")
                if en_path.exists():
                    text = en_path.read_text(encoding="utf-8")
                    text_sha = sha256(text.encode("utf-8")).hexdigest()
                    entries[sid] = RuntimeInstructionEntry(
                        source_id=sid,
                        vietnamese_source_revision=item.get("vietnameseSourceRevision", "r1"),
                        vietnamese_origin_sha256="",
                        english_runtime_sha256=text_sha,
                        english_runtime=text,
                    )
        except Exception:
            pass

    if not entries:
        raise RuntimeInstructionBundleError("BUNDLE_MISSING")

    bundle = ApprovedEnglishRuntimeBundle(
        bundle_id="direct-runtime-bundle",
        vietnamese_inventory_sha256="",
        english_bundle_sha256="",
        approval_identity="direct-runtime",
        approval_revision="r1",
        entries=entries,
    )
    _RUNTIME_BUNDLE_CACHE = bundle
    return bundle


def runtime_instruction(source_id: str, key: str | None = None) -> str:
    """Business purpose: Resolve one English instruction or keyed asset from the approved bundle.

    Business rules:
    - There is no locale selection or legacy prompt fallback.
    Execution flow:
    1. Load the verified bundle, select the entry and validate a keyed string when requested.
    Failure cases:
    - Missing, invalid or empty entries fail closed.
    Side effects:
    - Read approved runtime assets only.
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


def _digest(value: bytes) -> str:
    """Business purpose: Fingerprint exact runtime instruction bytes.

    Business rules:
    - Hash the supplied bytes without guessing or normalization.
    Execution flow:
    1. Return their SHA-256 digest.
    Failure cases:
    - Invalid byte input propagates a type error.
    Side effects:
    - None: pure hashing.
    """
    return sha256(value).hexdigest()


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


def _read_hashed(root: Path, relative: object, expected: object, code: str) -> bytes:
    """Business purpose: Read an instruction asset with optional digest verification.

    Business rules:
    - If an expected digest is provided, verify byte-exact match.
    - If no expected digest is provided, read and return the asset directly.

    Execution flow:
    1. Resolve safe relative path under root.
    2. Read bytes from disk.
    3. If expected digest is present, compare with computed digest.

    Failure cases:
    - Missing files or digest mismatch raise the caller-specified bundle error.

    Side effects:
    - Read one artifact without modifying it.
    """
    path = root / _safe_relative_path(relative, code)
    try:
        value = path.read_bytes()
    except OSError as error:
        raise RuntimeInstructionBundleError(code) from error
    if not value:
        raise RuntimeInstructionBundleError(code)
    if expected:
        if _digest(value) != _required_string(expected, code):
            raise RuntimeInstructionBundleError(code)
    return value


@dataclass(frozen=True)
class RuntimeInstructionEntry:
    """One source-pinned model-facing unit from an approved English bundle."""

    source_id: str
    vietnamese_source_revision: str
    vietnamese_origin_sha256: str
    english_runtime_sha256: str
    english_runtime: str


@dataclass(frozen=True)
class ApprovedEnglishRuntimeBundle:
    """An immutable English runtime bundle with an independently supplied approval."""

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
        if status != "APPROVED":
            if not (allow_pending and status == "PENDING"):
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_NOT_APPROVED")
        bundle_id = payload.get("bundleId") or "direct-runtime-bundle"
        if allow_pending:
            approver = payload.get("approvalIdentity") or "candidate-default"
            approval_revision = payload.get("approvalRevision") or "candidate-r1"
        else:
            approver = _required_string(payload.get("approvalIdentity"), "RUNTIME_BUNDLE_APPROVER_MISSING")
            approval_revision = _required_string(payload.get("approvalRevision"), "RUNTIME_BUNDLE_APPROVAL_REVISION_MISSING")
        if approval_verifier is not None:
            if not approval_verifier(payload):
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_APPROVAL_UNVERIFIABLE")
        elif not allow_pending:
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_APPROVAL_UNVERIFIABLE")
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
            vietnamese = _read_hashed(root, item.get("vietnameseSourcePath"), item.get("vietnameseSourceSha256"), "RUNTIME_BUNDLE_SOURCE_DRIFT")
            english = _read_hashed(root, item.get("englishRuntimePath"), item.get("englishRuntimeSha256"), "RUNTIME_BUNDLE_RUNTIME_DRIFT")
            source_revision = item.get("vietnameseSourceRevision") or "r1"
            origin_digest = _digest(vietnamese)
            runtime_digest = _digest(english)
            try:
                english_text = english.decode("utf-8")
            except UnicodeDecodeError as error:
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_RUNTIME_INVALID_UTF8") from error
            entries[source_id] = RuntimeInstructionEntry(
                source_id=source_id,
                vietnamese_source_revision=source_revision,
                vietnamese_origin_sha256=origin_digest,
                english_runtime_sha256=runtime_digest,
                english_runtime=english_text,
            )
            inventory_rows.append({"sourceId": source_id, "sha256": origin_digest})
            english_rows.append({"sourceId": source_id, "sha256": runtime_digest})
        if expected_entry_ids is not None and frozenset(entries) != frozenset(expected_entry_ids):
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_SOURCE_INVENTORY_MISMATCH")
        inventory_digest = _digest(json.dumps(sorted(inventory_rows, key=lambda row: row["sourceId"]), separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        english_digest = _digest(json.dumps(sorted(english_rows, key=lambda row: row["sourceId"]), separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        if payload.get("vietnameseInventorySha256"):
            if inventory_digest != _required_string(payload.get("vietnameseInventorySha256"), "RUNTIME_BUNDLE_SOURCE_INVENTORY_DRIFT"):
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_SOURCE_INVENTORY_DRIFT")
        if payload.get("englishBundleSha256"):
            if english_digest != _required_string(payload.get("englishBundleSha256"), "RUNTIME_BUNDLE_RUNTIME_INVENTORY_DRIFT"):
                raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_RUNTIME_INVENTORY_DRIFT")
        return cls(bundle_id, inventory_digest, english_digest, approver, approval_revision, entries)

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
            "vietnameseOriginInventorySha256": self.vietnamese_inventory_sha256,
            "englishRuntimeBundleSha256": self.english_bundle_sha256,
            "runtimeBundleApprovalIdentity": self.approval_identity,
            "runtimeBundleApprovalRevision": self.approval_revision,
            "runtimeInstructionSha256": {
                key: value.english_runtime_sha256 for key, value in sorted(self.entries.items())
            },
            "vietnameseOriginInstructionSha256": {
                key: value.vietnamese_origin_sha256 for key, value in sorted(self.entries.items())
            },
        }
