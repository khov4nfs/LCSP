from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from typing import Any


TESTS_DIR = Path(__file__).parent
EVAL_DIR = TESTS_DIR / "fixtures" / "legal_preparation_eval"
ACCEPTED_DIR = TESTS_DIR / "fixtures" / "legal_portfolio_context"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


class LegalPreparationEvalFixtureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.cases = read_json(EVAL_DIR / "cases.json")
        self.rubric = read_json(EVAL_DIR / "rubric.json")
        self.pins = read_json(ACCEPTED_DIR / "pins.json")
        self.sources_by_version = {
            source["corpusVersion"]: source for source in self.pins["sources"]
        }

    def test_reuses_exact_accepted_source_pins_hashes_and_text(self) -> None:
        fixture_sources = self.cases["sourceCorpus"]["sources"]
        self.assertEqual(
            [source["corpusVersion"] for source in fixture_sources],
            ["SYNTHETIC-CORPUS-V1", "SYNTHETIC-CORPUS-V2"],
        )
        for fixture_source in fixture_sources:
            accepted = self.sources_by_version[fixture_source["corpusVersion"]]
            for field in (
                "corpusVersion",
                "documentId",
                "sourceFile",
                "sourceSha256",
                "byteLength",
            ):
                self.assertEqual(fixture_source[field], accepted[field], field)

            source_path = ACCEPTED_DIR / fixture_source["sourceFile"]
            source_bytes = source_path.read_bytes()
            self.assertEqual(len(source_bytes), fixture_source["byteLength"])
            self.assertEqual(
                f"sha256:{hashlib.sha256(source_bytes).hexdigest()}",
                fixture_source["sourceSha256"],
            )
            source_text = source_bytes.decode("utf-8")
            for snippet in fixture_source["textMustContain"]:
                self.assertIn(snippet, source_text)

        v1 = self.sources_by_version["SYNTHETIC-CORPUS-V1"]["chunkSha256"]
        v2 = self.sources_by_version["SYNTHETIC-CORPUS-V2"]["chunkSha256"]
        changed = {locator for locator in v1 if v1[locator] != v2[locator]}
        self.assertEqual(
            changed,
            set(self.cases["sourceCorpus"]["changedChunkLocatorsBetweenVersions"]),
        )
        self.assertEqual(
            {locator for locator in v1 if v1[locator] == v2[locator]},
            set(v1) - changed,
        )

    def test_valid_candidates_have_resolving_single_version_relationships(self) -> None:
        expected_ids = {
            "definition-retained",
            "qualifier-retained",
            "exception-retained",
            "cross-reference-context",
            "non-repository-duty-represented",
        }
        candidates = self.cases["validCandidates"]
        self.assertEqual({candidate["id"] for candidate in candidates}, expected_ids)
        rule_ids = {candidate["ruleId"] for candidate in candidates}

        for candidate in candidates:
            corpus_version = candidate["corpusVersion"]
            source = self.sources_by_version[corpus_version]
            for reference in [
                *candidate["sourceRefs"],
                *candidate["contextRefs"],
            ]:
                self.assertEqual(reference["corpusVersion"], corpus_version)
                self.assertEqual(reference["documentId"], source["documentId"])
                self.assertIn(reference["locator"], source["chunkSha256"])
            self.assertTrue(candidate["expected"]["refsResolve"])
            self.assertTrue(candidate["expected"]["singleCorpusVersion"])

        self.assertEqual(
            self.cases["coverage"],
            {
                "corpusVersion": "SYNTHETIC-CORPUS-V1",
                "documentId": "SYNTHETIC-NOTICE-INSTRUMENT",
                "coveredLocators": "ALL_ACCEPTED_PIN_LOCATORS",
                "missingLocators": [],
            },
        )
        self.assertEqual(len(rule_ids), len(candidates))

    def test_invalid_cases_keep_intentional_integrity_expectations(self) -> None:
        invalid_cases = self.cases["invalidCases"]
        expected_ids = {
            "fake-reference",
            "stale-reference",
            "repealed-reference",
            "duplicate-rule-id",
            "orphan-context-relation",
            "coverage-gap",
            "mixed-corpus-versions",
            "failed-attempt-preserves-earlier-active",
        }
        self.assertEqual({case["id"] for case in invalid_cases}, expected_ids)
        expectations = {
            case["id"]: case["expected"] for case in invalid_cases
        }
        self.assertEqual(
            expectations["fake-reference"],
            {"expectedAction": "REJECT", "reason": "UNRESOLVED_SOURCE_REFERENCE"},
        )
        self.assertEqual(
            expectations["stale-reference"],
            {"expectedAction": "REJECT", "reason": "STALE_SOURCE_HASH"},
        )
        self.assertEqual(
            expectations["repealed-reference"],
            {
                "expectedAction": "REJECT",
                "reason": "REPEALED_SOURCE_REFERENCE",
            },
        )
        self.assertEqual(
            expectations["duplicate-rule-id"],
            {"expectedAction": "REJECT", "reason": "DUPLICATE_RULE_ID"},
        )
        self.assertEqual(
            expectations["orphan-context-relation"],
            {"expectedAction": "REJECT", "reason": "ORPHAN_CONTEXT_RELATION"},
        )
        self.assertEqual(
            expectations["coverage-gap"],
            {"expectedAction": "REJECT", "reason": "INCOMPLETE_SOURCE_COVERAGE"},
        )
        self.assertEqual(
            expectations["mixed-corpus-versions"],
            {"expectedAction": "REJECT", "reason": "MIXED_CORPUS_VERSION"},
        )
        self.assertEqual(
            expectations["failed-attempt-preserves-earlier-active"],
            {
                "expectedAction": "REJECT_AND_PRESERVE_PREVIOUS_ACTIVE",
                "previousActiveUnchanged": True,
            },
        )

        fake_ref = next(case for case in invalid_cases if case["id"] == "fake-reference")
        fake = fake_ref["sourceRefs"][0]
        self.assertNotIn(fake["locator"], self.sources_by_version[fake["corpusVersion"]]["chunkSha256"])

        stale = next(case for case in invalid_cases if case["id"] == "stale-reference")
        v1_art5 = self.sources_by_version["SYNTHETIC-CORPUS-V1"]["chunkSha256"]["art-5::cl-1"]
        v2_art5 = self.sources_by_version["SYNTHETIC-CORPUS-V2"]["chunkSha256"]["art-5::cl-1"]
        self.assertEqual(stale["declaredSourceSha256"], v2_art5)
        self.assertNotEqual(stale["declaredSourceSha256"], v1_art5)

        repealed = next(case for case in invalid_cases if case["id"] == "repealed-reference")
        self.assertEqual(repealed["declaredLegalStatus"], "REPEALED")
        self.assertIn(
            repealed["sourceRef"]["locator"],
            self.sources_by_version[repealed["sourceRef"]["corpusVersion"]]["chunkSha256"],
        )

        duplicate = next(case for case in invalid_cases if case["id"] == "duplicate-rule-id")
        self.assertEqual(len(set(duplicate["ruleIds"])), 1)

        orphan = next(case for case in invalid_cases if case["id"] == "orphan-context-relation")
        known_rule_ids = {candidate["ruleId"] for candidate in self.cases["validCandidates"]}
        self.assertIn(orphan["relation"]["fromRuleId"], known_rule_ids)
        self.assertNotIn(orphan["relation"]["toRuleId"], known_rule_ids)

        gap = next(case for case in invalid_cases if case["id"] == "coverage-gap")
        self.assertEqual(gap["coverage"]["excludeLocators"], ["art-6::cl-1"])

        mixed = next(case for case in invalid_cases if case["id"] == "mixed-corpus-versions")
        self.assertEqual(
            {reference["corpusVersion"] for reference in mixed["sourceRefs"]},
            {"SYNTHETIC-CORPUS-V1", "SYNTHETIC-CORPUS-V2"},
        )

        preserved = next(
            case
            for case in invalid_cases
            if case["id"] == "failed-attempt-preserves-earlier-active"
        )
        self.assertEqual(preserved["invalidCaseId"], "fake-reference")
        self.assertTrue(preserved["expected"]["previousActiveUnchanged"])

    def test_rubric_assigns_meaning_to_agent_and_keeps_acceptance_unproven(self) -> None:
        self.assertEqual(
            {dimension["id"] for dimension in self.rubric["dimensions"]},
            {
                "DEFINITIONS",
                "QUALIFIERS",
                "EXCEPTIONS",
                "CROSS_REFERENCES",
                "NON_REPOSITORY_DUTIES",
                "CORPUS_VERSION_PINNING",
            },
        )
        candidate_ids = {candidate["id"] for candidate in self.cases["validCandidates"]}
        for dimension in self.rubric["dimensions"]:
            self.assertIn(dimension["fixtureCaseId"], candidate_ids)
            self.assertTrue(dimension["agentReviewQuestion"])
        self.assertEqual(
            set(self.rubric["invalidCaseExpectations"]),
            {case["id"] for case in self.cases["invalidCases"]},
        )
        self.assertEqual(self.rubric["semanticOwner"], "LEGAL_PREPARATION_AGENT")
        self.assertEqual(self.rubric["deterministicOwner"], "PORTFOLIO_INTEGRITY_BOUNDARY")
        self.assertEqual(self.rubric["testBoundary"]["semanticAcceptance"], "NOT_PROVEN")
        self.assertEqual(self.rubric["testBoundary"]["productionAcceptance"], "NOT_PROVEN")


if __name__ == "__main__":
    unittest.main()
