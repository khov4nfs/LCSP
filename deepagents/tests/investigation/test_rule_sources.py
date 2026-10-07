"""The assessment reads the ACTIVE legal portfolio only: no compile, cache or recovery."""

from __future__ import annotations

import hashlib
import inspect
from unittest.mock import MagicMock

import pytest

from legal_preparation.portfolio_reader import ACTIVE_PORTFOLIO_NOT_FOUND
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from tools.common.capabilities.assessment.investigation.engineering_rule import rule_sources
from tools.common.capabilities.assessment.investigation.engineering_rule.rule_sources import (
    NO_ACTIVE_LEGAL_CORPUS_SOURCE,
    NO_ACTIVE_LEGAL_PORTFOLIO,
    NO_ENGINEERING_RULES_IN_PORTFOLIO,
    resolve_engineering_rules,
)
from tools.common.capabilities.platform.api_client import WorkerCallbackError

PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111"
CORPUS_ID = "22222222-2222-4222-8222-222222222222"
DOC = "SYNTHETIC-NOTICE-INSTRUMENT"


def _sha(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def _source(locator: str = "art-1::cl-1") -> dict:
    return {
        "chunkId": f"chunk-{locator}",
        "documentId": DOC,
        "locator": locator,
        "contentSha256": _sha(locator),
        "sourceEffectStatus": "IN_FORCE",
    }


def _engineering_rule(rule_id: str = "ER-1", legal_rule_ids=("LR-1",), **overrides) -> dict:
    rule = {
        "engineeringRuleId": rule_id,
        "engineeringRuleVersion": "corpus.p1",
        "legalRuleIds": list(legal_rule_ids),
        "concept": "Retention",
        "legalIntent": "Records are retained.",
        "applicabilityGuidance": "Applies to stored records.",
        "criteria": [{"criterionId": "C-1", "statement": "A retention period exists."}],
        "investigationGoals": ["find retention config"],
        "startingNodeTypes": [], "targetNodeTypes": [], "edgeStrategies": [],
        "graphQueries": [
            {"name": "q", "startNodeTypes": ["File"], "direction": "FORWARD",
             "followEdges": ["IMPORTS"], "stopNodeTypes": [], "semanticTypes": []}
        ],
        "keywords": ["retention"], "commonApis": [], "commonLibraries": [], "patterns": [],
        "requiredEvidence": ["retention config"], "supportingEvidence": [], "negativeEvidence": [],
        "unresolvedConditions": [],
        "sourceFingerprint": _sha("fingerprint"),
        "sources": [_source()],
    }
    rule.update(overrides)
    return rule


def _portfolio(engineering_rules=None) -> dict:
    return {
        "portfolioVersionId": PORTFOLIO_ID,
        "version": "corpus.p1",
        "legalCorpusVersionId": CORPUS_ID,
        "portfolioDigest": _sha("portfolio"),
        "legalRules": [{"legalRuleId": "LR-1", "title": "Retention", "proposition": "Retain records."}],
        "engineeringRules": [_engineering_rule()] if engineering_rules is None else engineering_rules,
        "contextRelations": [],
    }


def _api(portfolio=None, *, chunks=True, error: Exception | None = None):
    api = MagicMock()
    if error is not None:
        api.get_active_legal_portfolio.side_effect = error
    else:
        api.get_active_legal_portfolio.return_value = portfolio if portfolio is not None else _portfolio()
    api.get_legal_corpus_chunks.return_value = {"chunks": [{"id": "chunk-art-1::cl-1"}] if chunks else []}
    return api


def _resolve(api, retriever=None):
    return resolve_engineering_rules(
        api_client=api,
        retriever=retriever or MagicMock(),
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
    )


def test_ready_rules_come_from_the_active_portfolio_and_pin_it() -> None:
    retriever = MagicMock()
    api = _api()
    result = _resolve(api, retriever)

    assert result.status == "READY"
    assert (result.catalog_version_id, result.corpus_version_id) == (PORTFOLIO_ID, CORPUS_ID)
    assert result.cache_hits == 0
    [rule] = result.rules
    assert rule.engineering_rule_id == "ER-1"
    assert rule.legal_rule_id == "LR-1"
    assert rule.legal_rule_catalog_version_id == PORTFOLIO_ID  # transitional pin carrier
    assert rule.legal_corpus_version_id == CORPUS_ID
    assert rule.compiler_model == "legal-preparation-agent"
    assert rule.source_chunk_ids == ("chunk-art-1::cl-1",)
    assert rule.source_locators == ("art-1::cl-1",)
    assert rule.graph_queries[0].follow_edges == ("IMPORTS",)
    assert rule.legal_reasoning_contract.citation_set[0]["contentSha256"] == _sha("art-1::cl-1")
    assert result.legal_rules[0]["legalRuleId"] == "LR-1"
    assert result.observability["legal_portfolio"]["portfolio_version_id"] == PORTFOLIO_ID
    api.get_active_legal_portfolio.assert_called_once_with()
    retriever.index_corpus.assert_called_once()
    assert retriever.index_corpus.call_args.args[0] == CORPUS_ID  # the pinned corpus, not "active corpus"


def test_missing_portfolio_blocks_instead_of_compiling_inline() -> None:
    error = WorkerCallbackError("missing", status_code=404, error_code=ACTIVE_PORTFOLIO_NOT_FOUND)
    api = _api(error=error)
    result = _resolve(api)

    assert result.status == "BLOCKED"
    assert result.reason == NO_ACTIVE_LEGAL_PORTFOLIO
    assert result.limitations == (ENGINEERING_LIMITATION_CODES["no_legal_rule_catalog"],)
    api.get_active_legal_corpus.assert_not_called()
    api.get_legal_corpus_chunks.assert_not_called()


def test_other_api_failures_are_not_treated_as_a_missing_portfolio() -> None:
    api = _api(error=WorkerCallbackError("boom", status_code=403, error_code="FORBIDDEN"))
    with pytest.raises(WorkerCallbackError):
        _resolve(api)


def test_missing_corpus_text_blocks() -> None:
    result = _resolve(_api(chunks=False))
    assert result.status == "BLOCKED" and result.reason == NO_ACTIVE_LEGAL_CORPUS_SOURCE
    assert result.limitations == (ENGINEERING_LIMITATION_CODES["no_legal_corpus_source"],)


def test_portfolio_without_engineering_rules_blocks() -> None:
    result = _resolve(_api(_portfolio(engineering_rules=[])))
    assert result.status == "BLOCKED" and result.reason == NO_ENGINEERING_RULES_IN_PORTFOLIO
    assert ENGINEERING_LIMITATION_CODES["no_engineering_rule_candidates"] in result.limitations


def test_one_malformed_rule_does_not_hide_the_healthy_ones() -> None:
    broken = _engineering_rule("ER-BAD", legal_rule_ids=())
    result = _resolve(_api(_portfolio([broken, _engineering_rule("ER-GOOD")])))

    assert result.status == "READY"
    assert [rule.engineering_rule_id for rule in result.rules] == ["ER-GOOD"]
    assert ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"] in result.limitations
    assert result.observability["legal_portfolio"]["bridge_failed_engineering_rule_ids"] == ["ER-BAD"]


def test_a_rule_implementing_several_legal_rules_uses_the_first_as_primary() -> None:
    result = _resolve(_api(_portfolio([_engineering_rule(legal_rule_ids=("LR-B", "LR-A"))])))
    [rule] = result.rules
    assert rule.legal_rule_id == "LR-A"
    assert rule.legal_intent["legalRuleIds"] == ["LR-A", "LR-B"]


def test_the_resolver_has_no_compile_cache_or_recovery_surface() -> None:
    signature = inspect.signature(resolve_engineering_rules)
    assert set(signature.parameters) == {"api_client", "retriever", "workflow_run_id", "correlation_id"}
    for retired in ("_recover", "_prepare", "get_or_compile", "recovery_driver", "rule_service", "_is_approved"):
        assert not hasattr(rule_sources, retired), retired
    source = inspect.getsource(rule_sources)
    for forbidden in ("get_active_legal_rule_catalog", "get_active_legal_corpus(", "LegalCorpusRecoveryDriver"):
        assert forbidden not in source, forbidden
