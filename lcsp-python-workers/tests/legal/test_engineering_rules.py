from __future__ import annotations
import json
from types import SimpleNamespace
import pytest

from lcsp_workers.legal.engineering_rules.compiler import EngineeringRuleCompiler
from lcsp_workers.legal.engineering_rules.models import EngineeringRule
from lcsp_workers.legal.engineering_rules.service import EngineeringRuleService
from lcsp_workers.legal.engineering_rules.validator import EngineeringRuleValidationError, validate_engineering_rule

LEGAL_RULE = {
    "legalRuleId": "VN-AI-134-14-HUMAN-OVERSIGHT",
    "requiredFacts": [{"field": "humanReview", "expectedValue": "PRESENT"}],
    "blockingFacts": [],
    "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    "citationLocatorRefs": [{"chunkId": "LAW134:art-14::cl-1::pt-d"}],
}
CONTEXT = [{"id": "LAW134:art-14::cl-1::pt-d", "locator": "art-14::cl-1::pt-d", "legalStatus": "ACTIVE", "contentSha256": "sha256:law", "role": "PRIMARY_MATCH", "content": "Human monitoring and intervention requirement."}]

class FakeLlm:
    def __init__(self) -> None: self.calls = 0
    def complete(self, **kwargs):
        self.calls += 1
        payload = {"engineeringRules": [{"engineeringRuleId": "VN-AI-134-14-HUMAN-OVERSIGHT::ENG::1", "concept": "HUMAN_OVERSIGHT", "legalIntent": {"requirement": "HUMAN_MONITORING_AND_INTERVENTION"}, "investigationGoals": ["Trace AI output to consequential business action", "Find human review or override before final action"], "startingNodeTypes": ["AI_MODEL_INVOCATION"], "targetNodeTypes": ["HUMAN_REVIEW", "HUMAN_OVERRIDE", "REJECTION", "APPROVAL"], "edgeStrategies": ["CALLS", "RETURNS", "ASSIGNS", "PASSES_ARGUMENT", "BRANCHES_ON", "REVIEWED_BY", "OVERRIDDEN_BY"], "graphQueries": [{"name": "trace_ai_to_action", "startNodeTypes": ["AI_MODEL_INVOCATION"], "direction": "FORWARD", "followEdges": ["CALLS", "RETURNS", "ASSIGNS", "PASSES_ARGUMENT", "BRANCHES_ON"], "stopNodeTypes": ["REJECTION", "APPROVAL"], "semanticTypes": []}], "keywords": ["review", "approve", "override"], "requiredEvidence": ["AI_OUTPUT_PATH", "DOWNSTREAM_BUSINESS_ACTION"], "supportingEvidence": ["HUMAN_REVIEW_PATH"], "negativeEvidence": ["NO_HUMAN_CONTROL_ON_BOUNDED_PATH"], "unresolvedConditions": ["DYNAMIC_DISPATCH"]}]}
        return SimpleNamespace(content=json.dumps(payload), model="fake-llm")

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
    assert llm.calls == 1 and cache.put_calls == 1
    assert [r.engineering_rule_id for r in first] == [r.engineering_rule_id for r in second]


def test_changed_legal_chunk_hash_invalidates_fingerprint() -> None:
    llm, cache, retriever = FakeLlm(), FakeCache(), FakeRetriever()
    service = EngineeringRuleService(compiler=EngineeringRuleCompiler(llm), retriever=retriever, cache=cache)
    service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v1", workflow_run_id="run-1")
    retriever.context[0] = {**retriever.context[0], "contentSha256": "sha256:changed", "content": "Changed approved legal text."}
    _, cached = service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v2", workflow_run_id="run-2")
    assert cached is False and llm.calls == 2


def test_repealed_legal_context_blocks_compilation() -> None:
    retriever = FakeRetriever([{**CONTEXT[0], "legalStatus": "REPEALED"}]); llm = FakeLlm()
    service = EngineeringRuleService(compiler=EngineeringRuleCompiler(llm), retriever=retriever, cache=FakeCache())
    with pytest.raises(ValueError, match="repealed"): service.get_or_compile(legal_rule=LEGAL_RULE, legal_rule_catalog_version_id="catalog-v1", legal_corpus_version_id="corpus-v1", workflow_run_id="run-1")
    assert llm.calls == 0


def test_validator_rejects_hallucinated_graph_vocabulary() -> None:
    base = EngineeringRule.from_dict({"engineeringRuleId": "bad", "legalRuleId": "law", "legalRuleCatalogVersionId": "catalog", "legalCorpusVersionId": "corpus", "concept": "TEST", "legalIntent": {}, "investigationGoals": ["test"], "startingNodeTypes": ["HUMAN_MIND_LINK"], "targetNodeTypes": [], "edgeStrategies": [], "graphQueries": [], "requiredEvidence": ["x"], "sourceChunkIds": ["chunk"], "sourceFingerprint": "sha256:test", "schemaVersion": "1.0.0"})
    with pytest.raises(EngineeringRuleValidationError, match="unknown graph node types"): validate_engineering_rule(base)
