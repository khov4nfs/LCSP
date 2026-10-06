from __future__ import annotations

import json
from pathlib import Path
import unittest
from typing import Any


FIXTURE_PATH = (
    Path(__file__).parent
    / "fixtures"
    / "assessment_researcher_isolation"
    / "scenarios.json"
)


def read_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


class AssessmentResearcherIsolationFixtureTest(unittest.TestCase):
    def test_packets_keep_namespaces_pins_and_adverse_boundaries_distinct(self) -> None:
        fixture = read_fixture()
        self.assertEqual(fixture["evaluationBoundary"]["mode"], "STRUCTURE_ONLY")
        self.assertFalse(fixture["evaluationBoundary"]["agentCalls"])
        self.assertFalse(fixture["evaluationBoundary"]["databaseWrites"])
        self.assertFalse(fixture["evaluationBoundary"]["semanticPass"])
        self.assertEqual(fixture["evaluationBoundary"]["liveIsolationProof"], "NOT_PROVEN")

        namespaces = {item["id"]: item for item in fixture["namespaces"]}
        self.assertEqual(set(namespaces), {"alpha", "beta"})
        for field in (
            "tenantScope",
            "assessmentId",
            "rootThreadId",
            "rootExecutionId",
            "researcherTaskId",
            "repositorySnapshotId",
            "repositoryCommit",
            "codebaseMemoryProjectId",
            "codebaseMemoryIndexStamp",
            "sandboxNamespace",
        ):
            self.assertEqual(
                len({namespace[field] for namespace in namespaces.values()}),
                2,
                field,
            )

        canaries = {item["id"]: item for item in fixture["repositoryCanaries"]}
        self.assertEqual({item["path"] for item in canaries.values()}, {"src/canary.txt"})
        self.assertNotEqual(
            canaries["alpha-canary"]["sourceHash"],
            canaries["beta-canary"]["sourceHash"],
        )
        self.assertNotEqual(
            canaries["alpha-canary"]["contentMarker"],
            canaries["beta-canary"]["contentMarker"],
        )

        scenarios = {item["id"]: item for item in fixture["scenarios"]}
        self.assertEqual(
            set(scenarios),
            {
                "disjoint-namespace",
                "canary-overlap",
                "forged-ref",
                "stale-pin",
                "memory-as-evidence",
                "researcher-unauthorized-write",
            },
        )
        expected_violations = {
            violation
            for scenario in scenarios.values()
            for violation in scenario["expectedBoundaryViolations"]
        }
        self.assertEqual(
            expected_violations,
            {
                "NAMESPACE_MISMATCH",
                "SOURCE_HASH_MISMATCH",
                "FORGED_SOURCE_REF",
                "STALE_REPOSITORY_PIN",
                "STALE_CASE_REVISION",
                "MEMORY_NOT_EVIDENCE",
                "RESEARCHER_WRITE_FORBIDDEN",
                "ROOT_AUTHORITY_REQUIRED",
            },
        )

        for scenario in scenarios.values():
            namespace = namespaces[scenario["namespace"]]
            self.assertEqual(scenario["case"]["assessmentId"], namespace["assessmentId"])
            self.assertEqual(scenario["case"]["tenantScope"], namespace["tenantScope"])
            self.assertTrue(scenario["stateMustRemainUnchanged"])
            self.assertTrue(scenario["expectedBoundaryViolations"])
            result = scenario["researcherResult"]
            self.assertEqual(result["researcherTaskId"], namespace["researcherTaskId"])

        disjoint = scenarios["disjoint-namespace"]["researcherResult"]
        self.assertNotEqual(
            disjoint["assessmentId"],
            namespaces["alpha"]["assessmentId"],
        )
        self.assertNotEqual(
            disjoint["tenantScope"],
            namespaces["alpha"]["tenantScope"],
        )

        forged = scenarios["forged-ref"]["researcherResult"]
        self.assertFalse(forged["sourcePin"]["serverMinted"])
        self.assertNotIn("~", forged["evidenceRef"])

        stale = scenarios["stale-pin"]
        self.assertNotEqual(
            stale["researcherResult"]["sourcePin"]["repositorySnapshotId"],
            stale["currentPins"]["repositorySnapshotId"],
        )
        self.assertNotEqual(
            stale["researcherResult"]["sourcePin"]["repositoryCommit"],
            stale["currentPins"]["repositoryCommit"],
        )
        self.assertNotEqual(
            stale["researcherResult"]["sourcePin"]["caseRevisionObserved"],
            stale["currentPins"]["caseRevision"],
        )

        memory = scenarios["memory-as-evidence"]["researcherResult"]
        self.assertEqual(memory["memoryRecord"]["evidenceRefs"], [])
        self.assertEqual(memory["sourcePins"], [])

        self.assertEqual(
            set(scenarios["researcher-unauthorized-write"]["researcherResult"]["attemptedOperations"]),
            {
                "record_case_fact",
                "record_use_case",
                "submit_rule_decision",
                "ask_human",
                "write_file",
                "edit_file",
                "delete",
                "execute_mutating_shell",
            },
        )


if __name__ == "__main__":
    unittest.main()
