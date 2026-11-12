import json
from hashlib import sha256
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
    assert built["approvalStatus"] == "PENDING"
    assert "approvalIdentity" not in built


def test_compiler_rejects_duplicate_or_unsafe_inventory_entries(tmp_path):
    source = tmp_path / "inventory.json"
    source.write_text(json.dumps({"schemaVersion": SCHEMA_VERSION, "bundleId": "x", "entries": [{"sourceId": "x", "vietnameseSourcePath": "../bad", "vietnameseSourceRevision": "r1", "englishCandidatePath": "bad"}]}), encoding="utf-8")
    with pytest.raises(RuntimeInstructionBundleError):
        compile_candidate(tmp_path, source, tmp_path / "candidate.json")


@pytest.mark.parametrize("mutation,code", [("source", "SOURCE_DRIFT"), ("utf8", "CANDIDATE_INVALID"), ("drive", "UNSAFE_PATH")])
def test_candidate_compiler_rejects_source_drift_invalid_encoding_and_drive_paths(tmp_path, mutation, code):
    vi = "Nguồn luật và hướng dẫn".encode("utf-8")
    (tmp_path / "vi.md").write_bytes(vi)
    (tmp_path / "en.md").write_bytes(b"English candidate")
    row = {"sourceId": "test.root", "vietnameseSourcePath": "vi.md", "vietnameseSourceRevision": "r1",
           "sourceSha256": sha256(vi).hexdigest(), "englishCandidatePath": "en.md"}
    if mutation == "source":
        (tmp_path / "vi.md").write_bytes(vi + b" changed")
    elif mutation == "utf8":
        (tmp_path / "en.md").write_bytes(b"\xff")
    else:
        row["englishCandidatePath"] = "C:relative"
    path = tmp_path / "inventory.json"
    path.write_text(json.dumps({"schemaVersion": SCHEMA_VERSION, "bundleId": "test", "entries": [row]}), encoding="utf-8")
    output = tmp_path / "candidate.json"
    with pytest.raises(RuntimeInstructionBundleError, match=code):
        compile_candidate(tmp_path, path, output)
    assert not output.exists()
