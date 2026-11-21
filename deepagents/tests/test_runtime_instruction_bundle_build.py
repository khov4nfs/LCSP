import json
import pytest

from runtime_instruction_bundle import RuntimeInstructionBundleError
from runtime_instruction_bundle_build import SCHEMA_VERSION, compile_candidate


def test_compiles_pending_candidate_from_utf8_vietnamese_source(tmp_path):
    (tmp_path / "root.vi.md").write_text("Hướng dẫn", encoding="utf-8")
    (tmp_path / "root.en.md").write_text("Instruction", encoding="utf-8")
    inventory = {"schemaVersion": SCHEMA_VERSION, "bundleId": "candidate-r1", "entries": [{"sourceId": "assessment-root.system", "vietnameseSourcePath": "root.vi.md", "vietnameseSourceRevision": "r1", "englishCandidatePath": "root.en.md"}]}
    source = tmp_path / "inventory.json"
    source.write_text(json.dumps(inventory), encoding="utf-8")
    built = compile_candidate(tmp_path, source, tmp_path / "candidate.json")
    assert built["approvalRequired"] is False
    assert "approvalStatus" not in built
    assert "vietnameseInventorySha256" not in built
    assert "englishBundleSha256" not in built


def test_compiler_rejects_duplicate_or_unsafe_inventory_entries(tmp_path):
    source = tmp_path / "inventory.json"
    source.write_text(json.dumps({"schemaVersion": SCHEMA_VERSION, "bundleId": "x", "entries": [{"sourceId": "x", "vietnameseSourcePath": "../bad", "vietnameseSourceRevision": "r1", "englishCandidatePath": "bad"}]}), encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError):
        compile_candidate(tmp_path, source, tmp_path / "candidate.json")


@pytest.mark.parametrize("mutation,code", [("missing", "SOURCE_INVALID"), ("utf8", "CANDIDATE_INVALID"), ("drive", "UNSAFE_PATH")])
def test_candidate_compiler_rejects_missing_invalid_encoding_and_drive_paths(tmp_path, mutation, code):
    (tmp_path / "vi.md").write_text("Nguồn luật và hướng dẫn", encoding="utf-8")
    (tmp_path / "en.md").write_text("English candidate", encoding="utf-8")
    row = {"sourceId": "test.root", "vietnameseSourcePath": "vi.md",
           "vietnameseSourceRevision": "r1", "englishCandidatePath": "en.md"}
    if mutation == "missing":
        row["vietnameseSourcePath"] = "does-not-exist.md"
    elif mutation == "utf8":
        (tmp_path / "en.md").write_bytes(bytes([0xff]))
    else:
        row["englishCandidatePath"] = "C:relative"
    path = tmp_path / "inventory.json"
    path.write_text(json.dumps({"schemaVersion": SCHEMA_VERSION, "bundleId": "test", "entries": [row]}), encoding="utf-8")
    output = tmp_path / "candidate.json"
    with pytest.raises(RuntimeInstructionBundleError, match=code):
        compile_candidate(tmp_path, path, output)
    assert not output.exists()


def test_compiler_keeps_updated_instructions_without_a_sha_revision(tmp_path):
    (tmp_path / "vi.md").write_text("Nguồn gốc", encoding="utf-8")
    english = tmp_path / "en.md"
    english.write_text("First instruction", encoding="utf-8")
    inventory = {"schemaVersion": SCHEMA_VERSION, "bundleId": "live", "entries": [{
        "sourceId": "one", "vietnameseSourcePath": "vi.md", "englishCandidatePath": "en.md"
    }]}
    path = tmp_path / "inventory.json"
    path.write_text(json.dumps(inventory), encoding="utf-8")
    first = compile_candidate(tmp_path, path, tmp_path / "manifest.json")
    english.write_text("Changed instruction", encoding="utf-8")
    second = compile_candidate(tmp_path, path, tmp_path / "manifest.json")
    assert first == second
    assert "sha256" not in json.dumps(second).lower()
