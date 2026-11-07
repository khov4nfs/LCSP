"""The bundle gate is deterministic and never invents translation approval."""
from hashlib import sha256
import json

import pytest

from runtime_instruction_bundle import (
    ApprovedEnglishRuntimeBundle,
    RuntimeInstructionBundleError,
)


def digest(value: bytes) -> str:
    return sha256(value).hexdigest()


def trusted_approval(manifest):
    return (
        manifest["approvalIdentity"] == "translation-reviewer-42"
        and manifest["approvalRevision"] == "review-7"
    )


def write_bundle(tmp_path, *, approval="APPROVED"):
    vi = "Nguồn hướng dẫn tiếng Việt".encode("utf-8")
    en = b"Approved English runtime instruction"
    (tmp_path / "source.vi.md").write_bytes(vi)
    (tmp_path / "runtime.en.md").write_bytes(en)
    inventory = [{"sourceId": "root", "sha256": digest(vi)}]
    runtime = [{"sourceId": "root", "sha256": digest(en)}]
    manifest = {
        "bundleSchemaVersion": "LCSP_EN_RUNTIME_BUNDLE_V1",
        "bundleId": "bundle-1",
        "approvalStatus": approval,
        "approvalIdentity": "translation-reviewer-42",
        "approvalRevision": "review-7",
        "vietnameseInventorySha256": digest(json.dumps(inventory, separators=(",", ":"), ensure_ascii=False).encode("utf-8")),
        "englishBundleSha256": digest(json.dumps(runtime, separators=(",", ":"), ensure_ascii=False).encode("utf-8")),
        "entries": [{
            "sourceId": "root",
            "vietnameseSourcePath": "source.vi.md",
            "vietnameseSourceRevision": "vi-r1",
            "vietnameseSourceSha256": digest(vi),
            "englishRuntimePath": "runtime.en.md",
            "englishRuntimeSha256": digest(en),
        }],
    }
    path = tmp_path / "bundle.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def test_approved_bundle_is_byte_stable_for_every_customer_locale(tmp_path):
    bundle = ApprovedEnglishRuntimeBundle.load(
        tmp_path,
        write_bundle(tmp_path),
        expected_entry_ids={"root"},
        approval_verifier=trusted_approval,
    )
    assert bundle.instruction("root") == "Approved English runtime instruction"
    assert bundle.manifest_metadata()["runtimeInstructionSha256"]["root"] == digest(b"Approved English runtime instruction")


def test_bundle_rejects_missing_approval_before_instruction_lookup(tmp_path):
    with pytest.raises(RuntimeInstructionBundleError, match="NOT_APPROVED"):
        ApprovedEnglishRuntimeBundle.load(
            tmp_path, write_bundle(tmp_path, approval="PENDING"), approval_verifier=trusted_approval
        )


def test_bundle_rejects_vietnamese_source_or_english_runtime_drift(tmp_path):
    path = write_bundle(tmp_path)
    (tmp_path / "source.vi.md").write_text("đã thay đổi", encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError, match="SOURCE_DRIFT"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path, approval_verifier=trusted_approval)
    path = write_bundle(tmp_path)
    (tmp_path / "runtime.en.md").write_text("changed", encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError, match="RUNTIME_DRIFT"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path, approval_verifier=trusted_approval)


def test_bundle_rejects_self_asserted_or_revoked_approval_and_inventory_mismatch(tmp_path):
    path = write_bundle(tmp_path)
    with pytest.raises(RuntimeInstructionBundleError, match="APPROVAL_UNVERIFIABLE"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path)
    with pytest.raises(RuntimeInstructionBundleError, match="SOURCE_INVENTORY_MISMATCH"):
        ApprovedEnglishRuntimeBundle.load(
            tmp_path,
            path,
            expected_entry_ids={"root", "researcher"},
            approval_verifier=trusted_approval,
        )
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["approvalStatus"] = "REVOKED"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError, match="REVOKED"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path, approval_verifier=trusted_approval)
