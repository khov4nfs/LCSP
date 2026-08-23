from __future__ import annotations
from types import SimpleNamespace
import pytest

from lcsp_workers.legal.engineering_rules.compiler import EngineeringRuleCompiler
from lcsp_workers.legal.engineering_rules.chunk_triage import (
    LegalChunkEngineeringRuleTriage,
)
from lcsp_workers.legal.engineering_rules.models import (
    ENGINEERING_RULE_SCHEMA_VERSION,
    EngineeringRule,
    build_legal_reasoning_contract,
)
from lcsp_workers.legal.engineering_rules.legal_reasoning_contract import (
    LEGAL_REASONING_PLANNER_AUTHORITY,
    LegalReasoningContract,
    LegalReasoningContractValidationError,
    validate_legal_reasoning_contract,
)
from lcsp_workers.legal.engineering_rules.service import EngineeringRuleService
from lcsp_workers.legal.engineering_rules.validator import EngineeringRuleValidationError, validate_engineering_rule

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

class FakeLlm:
    def __init__(self) -> None: self.calls = 0
    def complete_structured(self, **kwargs):
        self.calls += 1
        if kwargs.get("node_name") == "triage_legal_chunks_for_engineering_rules":
            payload = {
                "chunkAnalyses": [
                    {
                        "chunkId": "LAW134:art-14::cl-1::pt-d",
                        "verdict": "ENGINEERING_RULE_CANDIDATE",
                        "reason": "Chunk imposes provider monitoring and intervention obligations.",
                        "engineeringObligation": "Maintain human monitoring and intervention controls.",
                        "verificationTargets": ["human review", "override", "monitoring"],
                    }
                ]
            }
            return SimpleNamespace(structured_response=payload, content="", model="fake-llm")
        payload = {"engineeringRules": [{"engineeringRuleId": "VN-AI-134-14-HUMAN-OVERSIGHT::ENG::1", "concept": "HUMAN_OVERSIGHT", "legalIntent": {"requirement": "HUMAN_MONITORING_AND_INTERVENTION"}, "investigationGoals": ["Trace AI output to consequential business action", "Find human review or override before final action"], "startingNodeTypes": ["AI_MODEL_INVOCATION"], "targetNodeTypes": ["HUMAN_REVIEW", "HUMAN_OVERRIDE", "REJECTION", "APPROVAL"], "edgeStrategies": ["CALLS", "RETURNS", "ASSIGNS", "PASSES_ARGUMENT", "BRANCHES_ON", "REVIEWED_BY", "OVERRIDDEN_BY"], "graphQueries": [{"name": "trace_ai_to_action", "startNodeTypes": ["AI_MODEL_INVOCATION"], "direction": "FORWARD", "followEdges": ["CALLS", "RETURNS", "ASSIGNS", "PASSES_ARGUMENT", "BRANCHES_ON"], "stopNodeTypes": ["REJECTION", "APPROVAL"], "semanticTypes": []}], "keywords": ["review", "approve", "override"], "requiredEvidence": ["AI_OUTPUT_PATH", "DOWNSTREAM_BUSINESS_ACTION"], "supportingEvidence": ["HUMAN_REVIEW_PATH"], "negativeEvidence": ["NO_HUMAN_CONTROL_ON_BOUNDED_PATH"], "unresolvedConditions": ["DYNAMIC_DISPATCH"]}]}
        return SimpleNamespace(structured_response=payload, content="", model="fake-llm")

class FakeRetriever:
    def __init__(self, context=None) -> None: self.context = list(context or CONTEXT); self.calls = 0
    def retrieve_exact_context(self, corpus_version_id, chunk_ids): self.calls += 1; return list(self.context)

class FakeCache:
    def __init__(self) -> None: self.values = {}; self.get_calls = 0; self.put_calls = 0
    def get(self, fingerprint): self.get_calls += 1; return list(self.values.get(fingerprint, []))
    def put(self, fingerprint, rules): self.put_calls += 1; self.values[fingerprint] = list(rules)


def test_cache_miss_compiles_once_then_same_law_is_token_free() -> None:
    llm, cache, retriever = FakeLlm(), FakeCache(), FakeRetriever()
    service = EngineeringRuleService(compiler=EngineeringRuleCompiler(llm), retriever=retriever, cache=cache)
    first, first_cached = service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v1", workflow_run_id="run-1")
    second, second_cached = service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v1", workflow_run_id="run-2")
    assert first_cached is False and second_cached is True
    assert llm.calls == 2 and cache.put_calls == 1
    assert [r.engineering_rule_id for r in first] == [r.engineering_rule_id for r in second]


def test_changed_legal_chunk_hash_invalidates_fingerprint() -> None:
    llm, cache, retriever = FakeLlm(), FakeCache(), FakeRetriever()
    service = EngineeringRuleService(compiler=EngineeringRuleCompiler(llm), retriever=retriever, cache=cache)
    service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v1", workflow_run_id="run-1")
    retriever.context[0] = {
        **retriever.context[0],
        "contentSha256": "sha256:changed",
        "content": (
            "Nhà cung cấp hệ thống trí tuệ nhân tạo phải báo cáo, giám sát "
            "và duy trì cơ chế con người can thiệp."
        ),
    }
    _, cached = service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v2", workflow_run_id="run-2")
    assert cached is False and llm.calls == 4


def test_same_legal_chunk_hash_reuses_cache_across_corpus_versions() -> None:
    llm, cache, retriever = FakeLlm(), FakeCache(), FakeRetriever()
    service = EngineeringRuleService(compiler=EngineeringRuleCompiler(llm), retriever=retriever, cache=cache)
    service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v1", workflow_run_id="run-1")
    rules, cached = service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v2", workflow_run_id="run-2")
    assert cached is True
    assert llm.calls == 2
    assert rules[0].legal_corpus_version_id == "corpus-v2"
    assert rules[0].legal_reasoning_contract is not None
    assert rules[0].legal_reasoning_contract.legal_corpus_version_id == "corpus-v2"


def test_repealed_legal_context_blocks_compilation() -> None:
    retriever = FakeRetriever([{**CONTEXT[0], "legalStatus": "REPEALED"}]); llm = FakeLlm()
    service = EngineeringRuleService(compiler=EngineeringRuleCompiler(llm), retriever=retriever, cache=FakeCache())
    with pytest.raises(ValueError, match="repealed"): service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v1", workflow_run_id="run-1")
    assert llm.calls == 0


def test_context_only_chunk_is_skipped_without_compilation_failure() -> None:
    class OvereagerLlm(FakeLlm):
        def complete_structured(self, **kwargs):
            self.calls += 1
            if kwargs.get("node_name") == "triage_legal_chunks_for_engineering_rules":
                return SimpleNamespace(
                    structured_response={
                        "chunkAnalyses": [
                            {
                                "chunkId": "LAW134:art-3",
                                "verdict": "ENGINEERING_RULE_CANDIDATE",
                                "reason": "Mentions AI system definition.",
                                "engineeringObligation": "Treat definition as control.",
                                "verificationTargets": ["AI system"],
                            }
                        ]
                    },
                    content="",
                    model="fake-llm",
                )
            return super().complete_structured(**kwargs)

    llm = OvereagerLlm()
    context = [
        {
            "id": "LAW134:art-3",
            "locator": "art-3",
            "legalStatus": "ACTIVE",
            "contentSha256": "sha256:def",
            "role": "PRIMARY_MATCH",
            "content": (
                "Điều 3. Giải thích từ ngữ\n"
                "1. Hệ thống trí tuệ nhân tạo là hệ thống dựa trên máy."
            ),
            "hierarchy": {"articleTitle": "Giải thích từ ngữ"},
        }
    ]
    service = EngineeringRuleService(
        compiler=EngineeringRuleCompiler(llm),
        retriever=FakeRetriever(context),
        cache=FakeCache(),
    )

    rules, cached = service.get_or_compile(
        legal_rule={**LEGAL_RULE, "citationLocatorRefs": [{"chunkId": "LAW134:art-3"}]},
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        workflow_run_id="run-1",
    )

    assert rules == []
    assert cached is False
    assert llm.calls == 1
    assert service.cache.put_calls == 0


def test_chunk_triage_rejects_invalid_structured_response() -> None:
    class InvalidTriageLlm:
        def complete_structured(self, **kwargs):
            assert kwargs.get("node_name") == "triage_legal_chunks_for_engineering_rules"
            return SimpleNamespace(
                structured_response={"unexpected": []},
                content="",
                model="fake-llm",
            )

    with pytest.raises(ValueError, match="chunkAnalyses"):
        LegalChunkEngineeringRuleTriage(InvalidTriageLlm()).analyze(
            legal_rule=LEGAL_RULE,
            legal_context=CONTEXT,
            workflow_run_id="run-1",
        )


def test_compiler_empty_rule_output_is_skipped_without_failure() -> None:
    class EmptyCompilerLlm(FakeLlm):
        def complete_structured(self, **kwargs):
            self.calls += 1
            if kwargs.get("node_name") == "triage_legal_chunks_for_engineering_rules":
                payload = {
                    "chunkAnalyses": [
                        {
                            "chunkId": "LAW134:art-14::cl-1::pt-d",
                            "verdict": "ENGINEERING_RULE_CANDIDATE",
                            "reason": "Chunk imposes provider monitoring and intervention obligations.",
                            "engineeringObligation": "Maintain human monitoring and intervention controls.",
                            "verificationTargets": [
                                "human review",
                                "override",
                                "monitoring",
                            ],
                        }
                    ]
                }
                return SimpleNamespace(
                    structured_response=payload,
                    content="",
                    model="fake-llm",
                )
            return SimpleNamespace(
                structured_response={"engineeringRules": []},
                content="",
                model="fake-llm",
            )

    llm = EmptyCompilerLlm()
    service = EngineeringRuleService(
        compiler=EngineeringRuleCompiler(llm),
        retriever=FakeRetriever(),
        cache=FakeCache(),
    )

    rules, cached = service.get_or_compile(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        workflow_run_id="run-1",
    )

    assert rules == []
    assert cached is False
    assert service.cache.put_calls == 0


def test_chunk_triage_prompt_carries_compile_gate_and_locator_granularity() -> None:
    prompt = LegalChunkEngineeringRuleTriage._prompt(
        LEGAL_RULE,
        [
            CONTEXT[0],
            {
                "id": "LAW134:art-3",
                "locator": "art-3",
                "content": (
                    "Điều 3. Giải thích từ ngữ\n"
                    "1. Hệ thống trí tuệ nhân tạo là hệ thống dựa trên máy."
                ),
                "hierarchy": {"articleTitle": "Giải thích từ ngữ"},
            },
        ],
    )

    assert "repository-verifiable obligation" in prompt
    assert "deterministicNormativeClass" in prompt
    assert '"locatorGranularity": "POINT"' in prompt
    assert '"locatorGranularity": "ARTICLE"' in prompt
    assert '"deterministicGate": "PASS"' in prompt
    assert '"deterministicGate": "BLOCK"' in prompt
    assert "Definitions can supply vocabulary" in prompt


def test_chunk_triage_uses_deep_agent_structured_response() -> None:
    class StructuredTriageLlm:
        def complete_structured(self, **kwargs):
            assert kwargs.get("node_name") == "triage_legal_chunks_for_engineering_rules"
            payload = {
                "chunkAnalyses": [
                    {
                        "chunkId": "LAW134:art-14::cl-1::pt-d",
                        "verdict": "ENGINEERING_RULE_CANDIDATE",
                        "reason": "Chunk imposes provider monitoring and intervention obligations.",
                        "engineeringObligation": "Maintain human monitoring and intervention controls.",
                        "verificationTargets": ["human review", "override", "monitoring"],
                    }
                ]
            }
            return SimpleNamespace(
                structured_response=payload,
                content="ignored free-form model text",
                model="fake-llm",
            )

    decisions = LegalChunkEngineeringRuleTriage(StructuredTriageLlm()).analyze(
        legal_rule=LEGAL_RULE,
        legal_context=CONTEXT,
        workflow_run_id="run-1",
    )

    assert len(decisions) == 1
    assert decisions[0].verdict == "ENGINEERING_RULE_CANDIDATE"


def test_validator_rejects_hallucinated_graph_vocabulary() -> None:
    base = EngineeringRule.from_dict({"engineeringRuleId": "bad", "legalRuleId": LEGAL_RULE["legalRuleId"], "legalRuleCatalogVersionId": "catalog-v1", "legalCorpusVersionId": "corpus-v1", "concept": "TEST", "legalIntent": {}, "investigationGoals": ["test"], "startingNodeTypes": ["HUMAN_MIND_LINK"], "targetNodeTypes": [], "edgeStrategies": [], "graphQueries": [], "requiredEvidence": ["x"], "sourceChunkIds": ["LAW134:art-14::cl-1::pt-d"], "sourceFingerprint": "sha256:test", "legalReasoningContract": build_legal_reasoning_contract(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v1", legal_context=CONTEXT, required_evidence=("x",), supporting_evidence=(), negative_evidence=()), "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION})
    with pytest.raises(EngineeringRuleValidationError, match="unknown graph node types"): validate_engineering_rule(base)


def test_validator_rejects_engineering_rule_without_legal_reasoning_contract() -> None:
    base = EngineeringRule.from_dict({"engineeringRuleId": "missing-contract", "legalRuleId": LEGAL_RULE["legalRuleId"], "legalRuleCatalogVersionId": "catalog-v1", "legalCorpusVersionId": "corpus-v1", "concept": "TEST", "legalIntent": {}, "investigationGoals": ["test"], "startingNodeTypes": ["AI_MODEL_INVOCATION"], "targetNodeTypes": [], "edgeStrategies": [], "graphQueries": [], "requiredEvidence": ["x"], "sourceChunkIds": ["LAW134:art-14::cl-1::pt-d"], "sourceFingerprint": "sha256:test", "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION})
    with pytest.raises(EngineeringRuleValidationError, match="legal reasoning contract required"): validate_engineering_rule(base)


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
    assert prompt_contract["validationPolicy"]["plannerAuthority"] == LEGAL_REASONING_PLANNER_AUTHORITY
    assert prompt_contract["citationSet"][0]["chunkId"] == "LAW134:art-14::cl-1::pt-d"
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
