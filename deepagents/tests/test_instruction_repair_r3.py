"""Regression checks for the explicitly revised instruction sources and candidate assets."""
import hashlib
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
REVISION = ROOT / 'instructions/candidates/r3'


class InstructionRepairTests(unittest.TestCase):
    def test_revised_assets_match_evidence_and_preserve_original_candidates(self):
        evidence = json.loads((REVISION / 'repair-evidence.json').read_text(encoding='utf-8'))
        manifest = json.loads((REVISION / 'manifest.pending.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['approvalStatus'], 'PENDING')
        entries = {e['sourceId']: e for e in manifest['entries']}
        for row in evidence['changes']:
            with self.subTest(source=row['sourceId']):
                entry = entries[row['sourceId']]
                for path, expected in [
                    (entry['vietnameseSourcePath'], row['sourceSha256']),
                    (row['candidatePath'], row['candidateSha256']),
                    (row['previousCandidatePath'], row['previousCandidateSha256']),
                ]:
                    self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), expected)
                if row['sourceSha256'] != row['previousSourceSha256']:
                    original = ROOT / 'instructions/revisions/r3/before' / Path(entry['vietnameseSourcePath']).name
                    self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), row['previousSourceSha256'])
                    text = (ROOT / entry['vietnameseSourcePath']).read_text(encoding='utf-8')
                    self.assertNotRegex(text, r'\w\?\w|\?\?|\ufffd')

    def test_schema_and_upstream_key_sets_are_complete(self):
        for source, target in [
            ('tool-schema-guidance.json', 'tools.schema-guidance.txt'),
            ('upstream-assessment-tools.json', 'assessment-tools.upstream.txt'),
            ('budget-finalization.json', 'runtime.budget-finalization.txt'),
        ]:
            with self.subTest(source=source):
                vi = json.loads((ROOT / 'instructions/vi' / source).read_text(encoding='utf-8'))
                en = json.loads((REVISION / target).read_text(encoding='utf-8'))
                self.assertEqual(set(vi), set(en))
                self.assertTrue(all(isinstance(value, str) and value.strip() for value in en.values()))

    def test_budget_guards_are_explicit_in_the_revised_candidate(self):
        budget = json.loads((REVISION / 'runtime.budget-finalization.txt').read_text(encoding='utf-8'))
        for guard in ('AgentRunBudgetExceeded', 'cannot increase quota', 'API lifecycle', 'accepted work', 'truthful metering'):
            self.assertIn(guard, budget['HARD_STOP'])
        self.assertIn('do not repeat the same call', budget['TRIMMED_TOOL_RESULT_PLACEHOLDER'])
        self.assertIn('complete only when eligible', budget['NO_PROGRESS'])


if __name__ == '__main__':
    unittest.main()
