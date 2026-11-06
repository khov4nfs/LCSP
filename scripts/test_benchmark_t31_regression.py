"""Provider-free regression tests for the read-only T31 forensic QA."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "benchmark_t31_regression",
    Path(__file__).with_name("benchmark_t31_regression.py"),
)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class T31BenchmarkQaTests(unittest.TestCase):
    def test_detects_verdict_summary_conflict_and_keeps_original_immutable(self):
        decision = {
            "assessmentRuleId": "R1",
            "decisionId": "d1",
            "decisionRevision": 4,
            "decision": {"applicability": "APPLICABLE", "compliance": "NON_COMPLIANT"},
            "state": "ACCEPTED",
        }
        report = {
            "findings": [{
                "assessmentRuleId": "R1",
                "decisionId": "d1",
                "decisionRevision": 4,
                "decision": decision["decision"],
                "summary": "Not applicable: no obligation",
                "recommendations": [],
            }]
        }
        session = {
            "session": {"assessmentId": "a1"},
            "repository": {"commitSha": "c" * 40},
            "assessmentResults": {
                "decisions": [decision],
                "finalReportStatus": "AVAILABLE",
            },
            "executionHistory": {
                "fileAccessObservations": {
                    "files": [{"path": "app.py"}, {"path": ".lcsp/agent/scratch.md"}],
                },
                "runtimeEvents": [],
            },
            "inputSnapshot": {"humanAnswerHistory": []},
            "executionMetrics": {"modelCalls": 0},
        }
        result = module.audit(session, report)
        self.assertEqual(result["narrativeContradictionRuleIds"], ["R1"])
        self.assertEqual(result["nonCompliantMissingRecommendationRuleIds"], ["R1"])
        self.assertEqual(result["unmatchedDecisionRefs"], [])
        self.assertEqual(result["repositoryFilesAfterExcludingAgentScratch"], ["app.py"])
        self.assertEqual(decision["state"], "ACCEPTED")
        self.assertEqual(report["findings"][0]["summary"], "Not applicable: no obligation")


if __name__ == "__main__":
    unittest.main()
