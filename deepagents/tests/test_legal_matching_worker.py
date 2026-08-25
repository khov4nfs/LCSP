from tools.legal.retrieval.legal_basis.rule_applicability_evaluator import (
    RuleApplicabilityEvaluator,
    RuleEvaluationResult,
)
from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import (
    ChromaDbCitationRetriever,
    RetrievedChunk,
)
from tools.legal.retrieval.legal_basis.legal_match_builder import LegalMatchBuilder


def test_rule_applicability_evaluator_marks_match_when_required_facts_present_and_evidence_backed():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {
            "businessProcess": "AUTOMATED_DECISION",
            "automationLevel": "FULLY_AUTOMATED",
            "inputDataTypes": ["PERSONAL_DATA"],
            "affectedSubjects": ["CUSTOMERS"],
        },
        "factEvidenceRefs": {
            "businessProcess": ["ev-1"],
            "automationLevel": ["ev-2"],
        },
        "evidenceRefs": ["ev-1", "ev-2"],
    }
    rule = {
        "legalRuleId": "RULE-A",
        "requiredFacts": [
            {"field": "businessProcess", "expectedValue": "AUTOMATED_DECISION"},
            {"field": "automationLevel", "expectedValue": "FULLY_AUTOMATED"},
        ],
        "optionalFacts": [],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
        "citationLocatorRefs": [{"documentId": "doc-1", "locator": "art-1"}],
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert isinstance(result, RuleEvaluationResult)
    assert result.status == "MATCHED"
    assert result.rule_id == "RULE-A"


def test_rule_applicability_evaluator_blocks_when_required_fact_is_not_evidence_backed():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {
            "businessProcess": "AUTOMATED_DECISION",
        },
        "factEvidenceRefs": {},
        "evidenceRefs": [],
    }
    rule = {
        "legalRuleId": "RULE-B",
        "requiredFacts": [
            {"field": "businessProcess", "expectedValue": "AUTOMATED_DECISION"},
        ],
        "optionalFacts": [],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
        "citationLocatorRefs": [{"documentId": "doc-1", "locator": "art-1"}],
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert result.status == "BLOCKED_UNKNOWN_FACT"
    assert "lacks eligible evidence refs" in result.rationale[0]


def test_rule_applicability_evaluator_does_not_use_unrelated_global_evidence():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {
            "businessProcess": "AUTOMATED_DECISION",
            "automationLevel": "FULLY_AUTOMATED",
        },
        "factEvidenceRefs": {
            "businessProcess": ["ev-business"],
        },
        "evidenceRefs": ["ev-business", "ev-unrelated"],
    }
    rule = {
        "legalRuleId": "RULE-FIELD-BACKING",
        "requiredFacts": [
            {"field": "automationLevel", "expectedValue": "FULLY_AUTOMATED"},
        ],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert result.status == "BLOCKED_UNKNOWN_FACT"
    assert result.matched_required_facts == []
    assert "automationLevel lacks eligible evidence refs" in result.rationale[0]


def test_rule_applicability_evaluator_treats_evidence_backed_known_mismatch_as_not_applicable():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {"automationLevel": "ASSISTIVE"},
        "factEvidenceRefs": {"automationLevel": ["ev-automation"]},
    }
    rule = {
        "legalRuleId": "RULE-KNOWN-MISMATCH",
        "requiredFacts": [
            {"field": "automationLevel", "expectedValue": "FULLY_AUTOMATED"},
        ],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert result.status == "NOT_APPLICABLE"
    assert "did not match" in result.rationale[0]


def test_rule_applicability_evaluator_does_not_use_unbacked_mismatch_to_exclude_rule():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {"automationLevel": "ASSISTIVE"},
        "factEvidenceRefs": {},
    }
    rule = {
        "legalRuleId": "RULE-UNBACKED-MISMATCH",
        "requiredFacts": [
            {"field": "automationLevel", "expectedValue": "FULLY_AUTOMATED"},
        ],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert result.status == "BLOCKED_UNKNOWN_FACT"
    assert "lacks eligible evidence refs" in result.rationale[0]


def test_rule_applicability_evaluator_blocks_not_determinable_from_code_as_unknown():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {
            "riskDocumentationEvidence": "NOT_DETERMINABLE_FROM_CODE",
        },
        "factEvidenceRefs": {
            "riskDocumentationEvidence": ["ev-1"],
        },
    }
    rule = {
        "legalRuleId": "RULE-UNKNOWN-PROCESS-FACT",
        "requiredFacts": [
            {
                "field": "riskDocumentationEvidence",
                "expectedValue": "NOT_DETERMINABLE_FROM_CODE",
            },
        ],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert result.status == "BLOCKED_UNKNOWN_FACT"
    assert "is unknown" in result.rationale[0]


def test_rule_applicability_evaluator_blocks_unknown_marker_inside_list_fact():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {"potentialHarmCategories": ["UNKNOWN"]},
        "factEvidenceRefs": {"potentialHarmCategories": ["ev-1"]},
    }
    rule = {
        "legalRuleId": "RULE-UNKNOWN-LIST",
        "requiredFacts": [
            {
                "field": "potentialHarmCategories",
                "expectedValue": ["POTENTIAL_HIGH_IMPACT"],
            },
        ],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert result.status == "BLOCKED_UNKNOWN_FACT"


def test_rule_applicability_evaluator_matches_required_list_as_subset():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {
            "potentialHarmCategories": [
                "POTENTIAL_HIGH_IMPACT",
                "PERSONAL_DATA_IMPACT",
            ],
        },
        "factEvidenceRefs": {"potentialHarmCategories": ["ev-1"]},
    }
    rule = {
        "legalRuleId": "RULE-LIST-SUBSET",
        "requiredFacts": [
            {
                "field": "potentialHarmCategories",
                "expectedValue": ["POTENTIAL_HIGH_IMPACT"],
            },
        ],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert result.status == "MATCHED"


def test_rule_applicability_evaluator_blocks_malformed_or_empty_required_facts():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "mergedProfile": {"automationLevel": "FULLY_AUTOMATED"},
        "factEvidenceRefs": {"automationLevel": ["ev-1"]},
    }

    for required_facts in ({}, [], [{"field": "automationLevel"}]):
        result = evaluator.evaluate_rule(
            rule={
                "legalRuleId": "RULE-MALFORMED",
                "requiredFacts": required_facts,
                "blockingFacts": [],
                "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
            },
            verified_profile=profile,
        )
        assert result.status == "BLOCKED_UNKNOWN_FACT"
        assert "invalid" in result.rationale[0]


def test_rule_applicability_evaluator_blocks_only_when_evidence_backed_blocking_value_matches():
    evaluator = RuleApplicabilityEvaluator()
    rule = {
        "legalRuleId": "RULE-BLOCKING-VALUE",
        "requiredFacts": [
            {"field": "automationLevel", "expectedValue": "FULLY_AUTOMATED"},
        ],
        "blockingFacts": [
            {"field": "deploymentStage", "expectedValue": "INTERNAL_ONLY"},
        ],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }
    profile = {
        "mergedProfile": {
            "automationLevel": "FULLY_AUTOMATED",
            "deploymentStage": "PUBLIC",
        },
        "factEvidenceRefs": {
            "automationLevel": ["ev-automation"],
            "deploymentStage": ["ev-stage"],
        },
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)
    assert result.status == "MATCHED"

    profile["mergedProfile"]["deploymentStage"] = "INTERNAL_ONLY"
    blocked = evaluator.evaluate_rule(rule=rule, verified_profile=profile)
    assert blocked.status == "NOT_APPLICABLE"
    assert blocked.blocking_facts == ["deploymentStage"]


def test_rule_applicability_evaluator_blocks_when_present_blocking_fact_is_unbacked():
    evaluator = RuleApplicabilityEvaluator()
    rule = {
        "legalRuleId": "RULE-UNKNOWN-BLOCKER",
        "requiredFacts": [
            {"field": "automationLevel", "expectedValue": "FULLY_AUTOMATED"},
        ],
        "blockingFacts": [
            {"field": "deploymentStage", "expectedValue": "INTERNAL_ONLY"},
        ],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }
    profile = {
        "mergedProfile": {
            "automationLevel": "FULLY_AUTOMATED",
            "deploymentStage": "PUBLIC",
        },
        "factEvidenceRefs": {"automationLevel": ["ev-automation"]},
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)

    assert result.status == "BLOCKED_UNKNOWN_FACT"
    assert "blocking fact deploymentStage is unknown or unbacked" in result.rationale


def test_citation_retriever_drops_repealed_chunks_and_builds_allowlist():
    retriever = ChromaDbCitationRetriever()
    chunks = [
        RetrievedChunk(
            id="doc-1::art-1::cl-1::pt-1",
            document_id="doc-1",
            locator="art-1::cl-1::pt-1",
            legal_status="ACTIVE",
            role="PRIMARY_MATCH",
        ),
        RetrievedChunk(
            id="doc-2::art-2::cl-2::pt-2",
            document_id="doc-2",
            locator="art-2::cl-2::pt-2",
            legal_status="REPEALED",
            role="PRIMARY_MATCH",
        ),
    ]

    result = retriever.build_citation_allowlist(chunks)

    assert result["allowlist"] == ["doc-1::art-1::cl-1::pt-1"]
    assert result["repealed_chunk_ids"] == ["doc-2::art-2::cl-2::pt-2"]


def test_citation_retriever_expands_parent_and_one_hop_references():
    class Collection:
        records = {
            "point": {
                "document_id": "doc-1",
                "locator": "art-1::cl-1::pt-a",
                "legal_status": "ACTIVE",
                "parent_chunk_id": "clause",
                "related_chunk_ids": '["referenced"]',
            },
            "clause": {
                "document_id": "doc-1",
                "locator": "art-1::cl-1",
                "legal_status": "ACTIVE",
            },
            "referenced": {
                "document_id": "doc-2",
                "locator": "art-2::cl-3",
                "legal_status": "ACTIVE",
            },
        }

        def get(self, *, ids, include):
            existing = [(value, self.records[value]) for value in ids if value in self.records]
            return {
                "ids": [value for value, _ in existing],
                "metadatas": [metadata for _, metadata in existing],
            }

    class Retriever(ChromaDbCitationRetriever):
        def _collection(self, corpus_version_id):
            return Collection()

    chunks = Retriever().retrieve_exact("corpus-v1", ["point"])

    assert [(chunk.id, chunk.role) for chunk in chunks] == [
        ("point", "PRIMARY_MATCH"),
        ("clause", "PARENT_CONTEXT"),
        ("referenced", "REFERENCED_CONTEXT"),
    ]


def test_legal_match_builder_builds_callback_payload_with_versions_and_empty_matches():
    builder = LegalMatchBuilder()
    payload = builder.build_payload(
        verified_profile_id="vp-1",
        assessment_id="assessment-1",
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        matches=[],
    )

    assert payload["verified_profile_id"] == "vp-1"
    assert payload["assessment_id"] == "assessment-1"
    assert payload["legal_rule_catalog_version_id"] == "catalog-v1"
    assert payload["corpus_version_id"] == "corpus-v1"
    assert payload["matches"] == []
    assert payload["citation_allowlist"] == []
    assert payload["overall_coverage_status"] == "NO_CITATION"


def test_rule_applicability_evaluator_supports_snake_case_merged_profile():
    evaluator = RuleApplicabilityEvaluator()
    profile = {
        "merged_profile": {
            "businessProcess": "AUTOMATED_DECISION",
            "automationLevel": "FULLY_AUTOMATED",
        },
        "factEvidenceRefs": {
            "businessProcess": ["ev-1"],
            "automationLevel": ["ev-2"],
        },
        "evidenceRefs": ["ev-1", "ev-2"],
    }
    rule = {
        "legalRuleId": "RULE-A",
        "requiredFacts": [
            {"field": "businessProcess", "expectedValue": "AUTOMATED_DECISION"},
            {"field": "automationLevel", "expectedValue": "FULLY_AUTOMATED"},
        ],
        "optionalFacts": [],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
        "citationLocatorRefs": [{"documentId": "doc-1", "locator": "art-1"}],
    }

    result = evaluator.evaluate_rule(rule=rule, verified_profile=profile)
    assert result.status == "MATCHED"

