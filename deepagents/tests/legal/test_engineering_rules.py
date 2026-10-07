from __future__ import annotations

import pytest

from tools.common.capabilities.evidence.graph.schema.vocabulary import EDGE_TYPES, NODE_TYPES
from tools.legal.corpus.engineering_rules.contract.legal_reasoning_contract import (
    LEGAL_REASONING_PLANNER_AUTHORITY,
    LegalReasoningContract,
    LegalReasoningContractValidationError,
    validate_legal_reasoning_contract,
)
from tools.legal.corpus.engineering_rules.contract.models import (
    ENGINEERING_RULE_SCHEMA_VERSION,
    EngineeringRule,
    build_legal_reasoning_contract,
)
from tools.legal.corpus.engineering_rules.contract.validator import (
    ALLOWED_DIRECTIONS,
    EngineeringRuleValidationError,
    validate_engineering_rule,
)

LEGAL_RULE = {
    "legalRuleId": "VN-AI-134-14-HUMAN-OVERSIGHT",
    "requiredFacts": [{"field": "humanReview", "expectedValue": "PRESENT"}],
    "blockingFacts": [],
    "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    "citationLocatorRefs": [{"chunkId": "LAW134:art-14::cl-1::pt-d"}],
}
CONTEXT = [
    {
        "id": "LAW134:art-14::cl-1::pt-d",
        "locator": "art-14::cl-1::pt-d",
        "legalStatus": "ACTIVE",
        "contentSha256": "sha256:law",
        "role": "PRIMARY_MATCH",
        "content": (
            "Nhà cung cấp hệ thống trí tuệ nhân tạo phải thiết lập, duy trì "
            "cơ chế giám sát và cho phép con người can thiệp."
        ),
        "hierarchy": {"articleTitle": "Nghĩa vụ của nhà cung cấp"},
    }
]



def test_validator_rejects_hallucinated_graph_vocabulary() -> None:
    base = EngineeringRule.from_dict(
        {
            "engineeringRuleId": "bad",
            "legalRuleId": LEGAL_RULE["legalRuleId"],
            "legalRuleCatalogVersionId": "catalog-v1",
            "legalCorpusVersionId": "corpus-v1",
            "concept": "TEST",
            "legalIntent": {},
            "investigationGoals": ["test"],
            "startingNodeTypes": ["HUMAN_MIND_LINK"],
            "targetNodeTypes": [],
            "edgeStrategies": [],
            "graphQueries": [],
            "requiredEvidence": ["x"],
            "sourceChunkIds": ["LAW134:art-14::cl-1::pt-d"],
            "sourceFingerprint": "sha256:test",
            "legalReasoningContract": build_legal_reasoning_contract(
                legal_rule=LEGAL_RULE,
                legal_rule_catalog_version_id="catalog-v1",
                legal_corpus_version_id="corpus-v1",
                legal_context=CONTEXT,
                required_evidence=("x",),
                supporting_evidence=(),
                negative_evidence=(),
            ),
            "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION,
        }
    )
    with pytest.raises(
        EngineeringRuleValidationError,
        match="unknown graph node types",
    ):
        validate_engineering_rule(base)



def test_validator_rejects_engineering_rule_without_legal_reasoning_contract() -> None:
    base = EngineeringRule.from_dict(
        {
            "engineeringRuleId": "missing-contract",
            "legalRuleId": LEGAL_RULE["legalRuleId"],
            "legalRuleCatalogVersionId": "catalog-v1",
            "legalCorpusVersionId": "corpus-v1",
            "concept": "TEST",
            "legalIntent": {},
            "investigationGoals": ["test"],
            "startingNodeTypes": ["AI_MODEL_INVOCATION"],
            "targetNodeTypes": [],
            "edgeStrategies": [],
            "graphQueries": [],
            "requiredEvidence": ["x"],
            "sourceChunkIds": ["LAW134:art-14::cl-1::pt-d"],
            "sourceFingerprint": "sha256:test",
            "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION,
        }
    )
    with pytest.raises(
        EngineeringRuleValidationError,
        match="legal reasoning contract required",
    ):
        validate_engineering_rule(base)


def test_legal_reasoning_contract_is_the_mandatory_llm_boundary() -> None:
    contract = build_legal_reasoning_contract(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        legal_context=CONTEXT,
        required_evidence=("AI_OUTPUT_PATH",),
        supporting_evidence=("HUMAN_REVIEW_PATH",),
        negative_evidence=("NO_HUMAN_CONTROL_ON_BOUNDED_PATH",),
    )

    prompt_contract = contract.to_prompt_dict()
    assert prompt_contract["validationPolicy"]["noCitationNoLegalClaim"] is True
    assert prompt_contract["validationPolicy"]["noSourceAnchorNoRepoClaim"] is True
    assert prompt_contract["validationPolicy"]["failClosedOnMissingEvidence"] is True
    assert (
        prompt_contract["validationPolicy"]["plannerAuthority"]
        == LEGAL_REASONING_PLANNER_AUTHORITY
    )
    assert (
        prompt_contract["citationSet"][0]["chunkId"]
        == "LAW134:art-14::cl-1::pt-d"
    )
    assert prompt_contract["legalCorpusVersionId"] == "corpus-v1"
    assert prompt_contract["legalRuleCatalogVersionId"] == "catalog-v1"
    assert prompt_contract["acceptedEvidenceTypes"] == [
        "AI_OUTPUT_PATH",
        "HUMAN_REVIEW_PATH",
    ]


def test_legal_reasoning_contract_rejects_disabled_policy() -> None:
    contract = build_legal_reasoning_contract(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        legal_context=CONTEXT,
        required_evidence=("AI_OUTPUT_PATH",),
        supporting_evidence=(),
        negative_evidence=(),
    )
    tampered = contract.to_dict()
    tampered["validation_policy"]["noCitationNoLegalClaim"] = False

    with pytest.raises(
        LegalReasoningContractValidationError,
        match="policy mismatch: noCitationNoLegalClaim",
    ):
        validate_legal_reasoning_contract(LegalReasoningContract(**tampered))


def test_legal_reasoning_contract_rejects_incomplete_citation() -> None:
    with pytest.raises(
        LegalReasoningContractValidationError,
        match="citation identity incomplete",
    ):
        build_legal_reasoning_contract(
            legal_rule=LEGAL_RULE,
            legal_rule_catalog_version_id="catalog-v1",
            legal_corpus_version_id="corpus-v1",
            legal_context=[{**CONTEXT[0], "locator": ""}],
            required_evidence=("AI_OUTPUT_PATH",),
            supporting_evidence=(),
            negative_evidence=(),
        )
