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


def production_runtime_bundle() -> "ApprovedEnglishRuntimeBundle":
    """Business purpose: Load the release-authorized English instruction snapshot before inference.

    Business rules:
    - The manifest digest must come from deployment governance; approval cannot be inferred from candidate fields.
    Execution flow:
    1. Verify the deployment pin, strict inventory, trusted approval and each source revision.
    Failure cases:
    - Missing, corrupt, stale, unapproved or untrusted assets reject runtime availability.
    Side effects:
    - Read deployment configuration and verified assets; generate no translation or approval.
    """
    import hmac
    from instruction_source_inventory import ROOT, validate_inventory

    configured = os.environ.get("LCSP_RUNTIME_INSTRUCTION_MANIFEST")
    approved_digest = os.environ.get("LCSP_APPROVED_INSTRUCTION_MANIFEST_SHA256", "")
    if not configured:
        raise RuntimeInstructionBundleError("BUNDLE_MISSING")
    if len(approved_digest) != 64 or any(c not in "0123456789abcdef" for c in approved_digest):
        raise RuntimeInstructionBundleError("BUNDLE_APPROVAL_UNTRUSTED")
    path = Path(configured)
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise RuntimeInstructionBundleError("BUNDLE_MISSING") from error
    if not hmac.compare_digest(_digest(raw), approved_digest):
        raise RuntimeInstructionBundleError("BUNDLE_APPROVAL_UNTRUSTED")
    inventory = validate_inventory(require_complete=True)
    bundle = ApprovedEnglishRuntimeBundle.load(
        ROOT, path, expected_entry_ids=inventory["requiredSourceIds"],
        approval_verifier=lambda _: hmac.compare_digest(_digest(path.read_bytes()), approved_digest),
    )
    for row in inventory["entries"]:
        entry = bundle.entries[row["sourceId"]]
        if entry.vietnamese_origin_sha256 != row["sourceSha256"] or entry.vietnamese_source_revision != row["vietnameseSourceRevision"]:
            raise RuntimeInstructionBundleError("BUNDLE_STALE")
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
    """Business purpose: Verify artifact bytes against their declared content identity.

    Business rules:
    - Only exact SHA-256 matches may become instruction inputs.
    Execution flow:
    1. Resolve the safe path, read bytes and compare the expected digest.
    Failure cases:
    - Missing files or digest drift raise the caller-specified bundle error.
    Side effects:
    - Read one artifact without modifying it.
    """
    path = root / _safe_relative_path(relative, code)
    try:
        value = path.read_bytes()
    except OSError as error:
        raise RuntimeInstructionBundleError(code) from error
    if not value or _digest(value) != _required_string(expected, code):
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
    ) -> "ApprovedEnglishRuntimeBundle":
        """Business purpose: Build an immutable instruction view from a trusted approved manifest.

        Business rules:
        - A verifier is mandatory; revoked, stale, duplicate and incomplete entries cannot be loaded.
        Execution flow:
        1. Validate approval, read and hash each origin/runtime asset, then verify aggregate digests and required IDs.
        Failure cases:
        - Schema, approval, UTF-8, path or digest failures reject the bundle.
        Side effects:
        - Read trusted artifacts and return their verified runtime representation.
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
        if payload.get("approvalStatus") != "APPROVED":
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_NOT_APPROVED")
        bundle_id = _required_string(payload.get("bundleId"), "RUNTIME_BUNDLE_ID_INVALID")
        approver = _required_string(payload.get("approvalIdentity"), "RUNTIME_BUNDLE_APPROVER_MISSING")
        approval_revision = _required_string(payload.get("approvalRevision"), "RUNTIME_BUNDLE_APPROVAL_REVISION_MISSING")
        if approval_verifier is None or not approval_verifier(payload):
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
            source_revision = _required_string(item.get("vietnameseSourceRevision"), "RUNTIME_BUNDLE_SOURCE_REVISION_MISSING")
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
        if inventory_digest != _required_string(payload.get("vietnameseInventorySha256"), "RUNTIME_BUNDLE_SOURCE_INVENTORY_DRIFT"):
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_SOURCE_INVENTORY_DRIFT")
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
