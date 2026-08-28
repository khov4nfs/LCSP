from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from tools.common.capabilities.evidence.graph.schema.vocabulary import EDGE_TYPES, NODE_TYPES
from tools.legal.corpus.engineering_rules.compilation.chunk_triage import (
    LegalChunkEngineeringRuleTriage,
    _triage_response_schema,
)
from tools.legal.corpus.engineering_rules.compilation.compiler import (
    EngineeringRuleCompiler,
    _engineering_rules_response_schema,
)
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
from tools.legal.corpus.engineering_rules.orchestration.service import EngineeringRuleService


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
    def __init__(self) -> None:
        self.calls = 0

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
            return SimpleNamespace(
                structured_response=payload,
                content="",
                model="fake-llm",
            )
        payload = {
            "engineeringRules": [
                {
                    "engineeringRuleId": "VN-AI-134-14-HUMAN-OVERSIGHT::ENG::1",
                    "concept": "HUMAN_OVERSIGHT",
                    "legalIntent": {
                        "requirement": "HUMAN_MONITORING_AND_INTERVENTION"
                    },
                    "investigationGoals": [
                        "Trace AI output to consequential business action",
                        "Find human review or override before final action",
                    ],
                    "startingNodeTypes": ["AI_MODEL_INVOCATION"],
                    "targetNodeTypes": [
                        "HUMAN_REVIEW",
                        "HUMAN_OVERRIDE",
                        "REJECTION",
                        "APPROVAL",
                    ],
                    "edgeStrategies": [
                        "CALLS",
                        "RETURNS",
                        "ASSIGNS",
                        "PASSES_ARGUMENT",
                        "BRANCHES_ON",
                        "REVIEWED_BY",
                        "OVERRIDDEN_BY",
                    ],
                    "graphQueries": [
                        {
                            "name": "trace_ai_to_action",
                            "startNodeTypes": ["AI_MODEL_INVOCATION"],
                            "direction": "FORWARD",
                            "followEdges": [
                                "CALLS",
                                "RETURNS",
                                "ASSIGNS",
                                "PASSES_ARGUMENT",
                                "BRANCHES_ON",
                            ],
                            "stopNodeTypes": ["REJECTION", "APPROVAL"],
                            "semanticTypes": [],
                        }
                    ],
                    "keywords": ["review", "approve", "override"],
                    "requiredEvidence": [
                        "AI_OUTPUT_PATH",
                        "DOWNSTREAM_BUSINESS_ACTION",
                    ],
                    "supportingEvidence": ["HUMAN_REVIEW_PATH"],
                    "negativeEvidence": ["NO_HUMAN_CONTROL_ON_BOUNDED_PATH"],
                    "unresolvedConditions": ["DYNAMIC_DISPATCH"],
                }
            ]
        }
        return SimpleNamespace(
            structured_response=payload,
            content="",
            model="fake-llm",
        )


class FakeAgent:
    def __init__(self, llm: FakeLlm) -> None:
        self._llm = llm

    def invoke(self, _payload, *, config):
        response = self._llm.complete_structured(
            node_name=config["metadata"]["node_name"],
        )
        return {"structured_response": response.structured_response}


@pytest.fixture
def native_agent(monkeypatch):
    llm = FakeLlm()
    monkeypatch.setattr(
        sys.modules[EngineeringRuleCompiler.__module__],
        "create_agent",
        lambda **_kwargs: FakeAgent(llm),
    )
    monkeypatch.setattr(
        sys.modules[LegalChunkEngineeringRuleTriage.__module__],
        "create_agent",
        lambda **_kwargs: FakeAgent(llm),
    )
    return llm


class FakeRetriever:
    def __init__(self, context=None) -> None:
        self.context = list(context or CONTEXT)
        self.calls = 0

    def retrieve_exact_context(self, corpus_version_id, chunk_ids):
        self.calls += 1
        return list(self.context)


class FakeCache:
    def __init__(self) -> None:
        self.values = {}
        self.get_calls = 0
        self.put_calls = 0
        self.get_keys: list[str] = []

    def get(self, fingerprint):
        self.get_calls += 1
        self.get_keys.append(fingerprint)
        return list(self.values.get(fingerprint, []))

    def put(self, fingerprint, rules):
        self.put_calls += 1
        self.values[fingerprint] = list(rules)


def test_assessment_cache_miss_never_calls_legacy_llm_agents(native_agent) -> None:
    llm, cache, retriever = native_agent, FakeCache(), FakeRetriever()
    service = EngineeringRuleService(
        compiler=EngineeringRuleCompiler(),
        retriever=retriever,
        cache=cache,
    )

    first, first_cached = service.get_or_compile(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        workflow_run_id="run-1",
    )
    second, second_cached = service.get_or_compile(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        workflow_run_id="run-2",
    )

    assert first == [] and second == []
    assert first_cached is False and second_cached is False
    assert llm.calls == 0
    assert cache.put_calls == 0


def test_changed_legal_chunk_hash_changes_ready_lookup_without_llm(native_agent) -> None:
    llm, cache, retriever = native_agent, FakeCache(), FakeRetriever()
    service = EngineeringRuleService(
        compiler=EngineeringRuleCompiler(),
        retriever=retriever,
        cache=cache,
    )

    service.get_or_compile(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        workflow_run_id="run-1",
    )
    first_fingerprint = cache.get_keys[-1]
    retriever.context[0] = {
        **retriever.context[0],
        "contentSha256": "sha256:changed",
        "content": (
            "Nhà cung cấp hệ thống trí tuệ nhân tạo phải báo cáo, giám sát "
            "và duy trì cơ chế con người can thiệp."
        ),
    }
    _, cached = service.get_or_compile(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v2",
        workflow_run_id="run-2",
    )
    second_fingerprint = cache.get_keys[-1]

    assert cached is False
    assert first_fingerprint != second_fingerprint
    assert llm.calls == 0
    assert cache.put_calls == 0


def test_same_legal_chunk_hash_stays_ready_only_across_corpus_versions(
    native_agent,
) -> None:
    llm, cache, retriever = native_agent, FakeCache(), FakeRetriever()
    service = EngineeringRuleService(
        compiler=EngineeringRuleCompiler(),
        retriever=retriever,
        cache=cache,
    )

    first, first_cached = service.get_or_compile(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        workflow_run_id="run-1",
    )
    second, second_cached = service.get_or_compile(
        legal_rule=LEGAL_RULE,
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v2",
        workflow_run_id="run-2",
    )

    assert first == [] and second == []
    assert first_cached is False and second_cached is False
    assert cache.get_keys[0] == cache.get_keys[1]
    assert llm.calls == 0
    assert cache.put_calls == 0


def test_repealed_legal_context_blocks_compilation(native_agent) -> None:
    retriever = FakeRetriever([{**CONTEXT[0], "legalStatus": "REPEALED"}])
    llm = native_agent
    service = EngineeringRuleService(
        compiler=EngineeringRuleCompiler(),
        retriever=retriever,
        cache=FakeCache(),
    )

    with pytest.raises(ValueError, match="repealed"):
        service.get_or_compile(
            legal_rule=LEGAL_RULE,
            legal_rule_catalog_version_id="catalog-v1",
            legal_corpus_version_id="corpus-v1",
            workflow_run_id="run-1",
        )
    assert llm.calls == 0


def test_context_only_chunk_is_not_triaged_inside_assessment(native_agent) -> None:
    llm = native_agent
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
        compiler=EngineeringRuleCompiler(),
        retriever=FakeRetriever(context),
        cache=FakeCache(),
    )

    rules, cached = service.get_or_compile(
        legal_rule={
            **LEGAL_RULE,
            "citationLocatorRefs": [{"chunkId": "LAW134:art-3"}],
        },
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        workflow_run_id="run-1",
    )

    assert rules == []
    assert cached is False
    assert llm.calls == 0
    assert service.cache.put_calls == 0


def test_chunk_triage_rejects_invalid_structured_response(native_agent) -> None:
    def invalid_complete(**_kwargs):
        native_agent.calls += 1
        return SimpleNamespace(
            structured_response={"unexpected": []},
            content="",
            model="fake-llm",
        )

    native_agent.complete_structured = invalid_complete
    with pytest.raises(ValueError, match="chunkAnalyses"):
        LegalChunkEngineeringRuleTriage().analyze(
            legal_rule=LEGAL_RULE,
            legal_context=CONTEXT,
            workflow_run_id="run-1",
        )


def test_compiler_empty_rule_output_is_skipped_without_failure(native_agent) -> None:
    llm = native_agent
    original_complete = llm.complete_structured

    def empty_compiler_complete(**kwargs):
        if kwargs.get("node_name") == "compile_engineering_rules":
            llm.calls += 1
            return SimpleNamespace(
                structured_response={"engineeringRules": []},
                content="",
                model="fake-llm",
            )
        return original_complete(**kwargs)

    llm.complete_structured = empty_compiler_complete
    service = EngineeringRuleService(
        compiler=EngineeringRuleCompiler(),
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
    assert llm.calls == 0
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


def test_chunk_triage_uses_native_agent_structured_response(native_agent) -> None:
    decisions = LegalChunkEngineeringRuleTriage().analyze(
        legal_rule=LEGAL_RULE,
        legal_context=CONTEXT,
        workflow_run_id="run-1",
    )

    assert len(decisions) == 1
    assert decisions[0].verdict == "ENGINEERING_RULE_CANDIDATE"


def test_chunk_triage_schema_requires_one_decision_per_input_chunk() -> None:
    chunk_ids = ("LAW134:art-10::cl-1", "LAW134:art-10::cl-2")
    analyses_schema = _triage_response_schema(chunk_ids)["properties"][
        "chunkAnalyses"
    ]

    assert analyses_schema["minItems"] == len(chunk_ids)
    assert analyses_schema["maxItems"] == len(chunk_ids)
    assert analyses_schema["items"]["properties"]["chunkId"]["enum"] == list(
        chunk_ids
    )


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


def test_structured_response_schema_constrains_graph_vocabulary() -> None:
    schema = _engineering_rules_response_schema()
    rule_properties = schema["properties"]["engineeringRules"]["items"]["properties"]
    query_properties = rule_properties["graphQueries"]["items"]["properties"]

    expected_node_types = sorted(NODE_TYPES)
    expected_edge_types = sorted(EDGE_TYPES)
    assert rule_properties["startingNodeTypes"]["items"]["enum"] == expected_node_types
    assert rule_properties["targetNodeTypes"]["items"]["enum"] == expected_node_types
    assert rule_properties["edgeStrategies"]["items"]["enum"] == expected_edge_types
    assert query_properties["startNodeTypes"]["items"]["enum"] == expected_node_types
    assert query_properties["stopNodeTypes"]["items"]["enum"] == expected_node_types
    assert query_properties["followEdges"]["items"]["enum"] == expected_edge_types
    assert query_properties["direction"]["enum"] == sorted(ALLOWED_DIRECTIONS)


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
