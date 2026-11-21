"""Instruction loading without reviewer approval or SHA-256 requirements."""
import json
from pathlib import Path
import pytest
from runtime_instruction_bundle import ApprovedEnglishRuntimeBundle, RuntimeInstructionBundleError


def write_bundle(tmp_path, *, source="Nguồn tiếng Việt", english="English instruction", disabled=False):
    (tmp_path / "source.vi.md").write_text(source, encoding="utf-8")
    (tmp_path / "runtime.en.md").write_text(english, encoding="utf-8")
    payload = {
        "bundleSchemaVersion": "LCSP_EN_RUNTIME_BUNDLE_V1",
        "bundleId": "bundle-1",
        "approvalRequired": False,
        "entries": [{
            "sourceId": "root",
            "vietnameseSourcePath": "source.vi.md",
            "englishRuntimePath": "runtime.en.md",
        }],
    }
    if disabled:
        payload["approvalStatus"] = "REVOKED"
    path = tmp_path / "bundle.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_bundle_loads_without_human_approval_and_hashes(tmp_path):
    bundle = ApprovedEnglishRuntimeBundle.load(
        tmp_path, write_bundle(tmp_path), expected_entry_ids={"root"}
    )
    assert bundle.instruction("root") == "English instruction"
    assert bundle.manifest_metadata()["approvalRequired"] is False
    assert "runtimeInstructionSha256" not in bundle.manifest_metadata()


def test_edit_english_without_digest_update_is_allowed(tmp_path):
    path = write_bundle(tmp_path)
    (tmp_path / "runtime.en.md").write_text("Changed instruction", encoding="utf-8")
    bundle = ApprovedEnglishRuntimeBundle.load(tmp_path, path)
    assert bundle.instruction("root") == "Changed instruction"


def test_change_vietnamese_without_human_approval_is_allowed(tmp_path):
    path = write_bundle(tmp_path)
    (tmp_path / "source.vi.md").write_text("Nguồn tiếng Việt cập nhật", encoding="utf-8")
    assert ApprovedEnglishRuntimeBundle.load(tmp_path, path).instruction("root")


def test_rejects_missing_or_unsafe_assets_and_duplicates(tmp_path):
    path = write_bundle(tmp_path)
    with pytest.raises(RuntimeInstructionBundleError, match="SOURCE_INVENTORY_MISMATCH"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path, expected_entry_ids={"root", "other"})
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["entries"][0]["englishRuntimePath"] = "../outside.md"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError, match="RUNTIME_MISSING_OR_INVALID"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path)
    manifest["entries"][0]["englishRuntimePath"] = "runtime.en.md"
    manifest["entries"].append(dict(manifest["entries"][0]))
    path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError, match="DUPLICATE_SOURCE_ID"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path)


def test_disabled_or_empty_english_instruction_fails_closed(tmp_path):
    path = write_bundle(tmp_path, disabled=True)
    with pytest.raises(RuntimeInstructionBundleError, match="REVOKED"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path)
    path = write_bundle(tmp_path, english=" ")
    with pytest.raises(RuntimeInstructionBundleError, match="RUNTIME_MISSING_OR_INVALID"):
        ApprovedEnglishRuntimeBundle.load(tmp_path, path)
