"""Regression checks for the pending FactNeed provenance schema candidate."""
import hashlib
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
REVISION = ROOT / "instructions/candidates/r4"


class InstructionRevisionR4Tests(unittest.TestCase):
    def test_revision_preserves_history_and_matches_evidence(self):
        evidence = json.loads((REVISION / "repair-evidence.json").read_text(encoding="utf-8"))
        manifest = json.loads((REVISION / "manifest.pending.json").read_text(encoding="utf-8"))
        self.assertEqual(evidence["status"], "PENDING")
        self.assertEqual(manifest["approvalStatus"], "PENDING")
        entries = {entry["sourceId"]: entry for entry in manifest["entries"]}
        for row in evidence["changes"]:
            with self.subTest(source=row["sourceId"]):
                entry = entries[row["sourceId"]]
                for path_key, digest_key in (
                    ("previousSourcePath", "previousSourceSha256"),
                    ("sourcePath", "sourceSha256"),
                    ("previousCandidatePath", "previousCandidateSha256"),
                    ("candidatePath", "candidateSha256"),
                ):
                    data = (ROOT / row[path_key]).read_bytes()
                    self.assertEqual(hashlib.sha256(data).hexdigest(), row[digest_key])
                self.assertEqual(entry["englishRuntimePath"], row["candidatePath"])
                self.assertEqual(entry["vietnameseSourceSha256"], row["sourceSha256"])
                self.assertEqual(entry["englishRuntimeSha256"], row["candidateSha256"])

    def test_active_schema_candidate_has_complete_key_set(self):
        source = json.loads(
            (ROOT / "instructions/vi/tool-schema-guidance.json").read_text(encoding="utf-8")
        )
        candidate = json.loads(
            (REVISION / "tools.schema-guidance.txt").read_text(encoding="utf-8")
        )
        inventory = json.loads((ROOT / "instructions/inventory.json").read_text(encoding="utf-8"))
        row = next(entry for entry in inventory["entries"] if entry["sourceId"] == "tools.schema-guidance")
        self.assertEqual(set(source), set(candidate))
        self.assertTrue(all(isinstance(value, str) and value.strip() for value in candidate.values()))
        self.assertEqual(row["reviewStatus"], "PENDING_INDEPENDENT_REVIEW")
        self.assertEqual(row["englishCandidatePath"], "instructions/candidates/r4/tools.schema-guidance.txt")
        self.assertEqual(row["translationProvenance"]["translationRevision"], "r4")


if __name__ == "__main__":
    unittest.main()
