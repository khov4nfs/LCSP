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
    """Load only a release-pinned approved artifact; never infer release approval.

    The manifest digest must be supplied out-of-band by deployment governance.
    There is deliberately no development bypass or approval registry generated
    from the candidate artifact itself.
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
    """Resolve actual English bytes; keyed assets never fall back to legacy text."""
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
    return sha256(value).hexdigest()


def _required_string(value: object, code: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeInstructionBundleError(code)
    return value


def _safe_relative_path(value: object, code: str) -> Path:
    raw = _required_string(value, code)
    path = Path(raw)
    if path.is_absolute() or ".." in path.parts:
        raise RuntimeInstructionBundleError(code)
    return path


def _read_hashed(root: Path, relative: object, expected: object, code: str) -> bytes:
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
        """Load and verify an approved bundle without any locale-based fallback."""
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
        """Return one verified English model-facing instruction unit."""
        try:
            return self.entries[source_id].english_runtime
        except KeyError as error:
            raise RuntimeInstructionBundleError("RUNTIME_BUNDLE_ENTRY_MISSING") from error

    def manifest_metadata(self) -> dict[str, Any]:
        """Return bounded receipt metadata, never source or instruction bodies."""
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
