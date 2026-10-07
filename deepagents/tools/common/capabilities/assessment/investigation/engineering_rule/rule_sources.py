"""Resolve the pinned EngineeringRules for one assessment run from the ACTIVE portfolio.

The assessment only reads (and pins) the portfolio the API reports as ACTIVE. There is no
lazy compile, recovery, EngineeringRule cache or bundle: a missing portfolio is a legal
preparation state, never inline compilation. Deterministic; no model.

TRANSITIONAL: the V1 per-rule assessment loop still consumes V1 ``EngineeringRule``
objects, so ``_to_v1_rule`` bridges portfolio rows into them. The bridge and its consumer
are removed together with the V1 loop (W3/W4 replacement, W7 deletion).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from legal_preparation.portfolio_reader import ActivePortfolio, read_active_portfolio
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from tools.common.capabilities.platform.logging import get_logger
from tools.legal.corpus.engineering_rules.contract.legal_reasoning_contract import (
    build_legal_reasoning_contract,
)
from tools.legal.corpus.engineering_rules.contract.models import (
    ENGINEERING_RULE_SCHEMA_VERSION,
    EngineeringRule,
    GraphQueryTemplate,
)

logger = get_logger(__name__)

NO_ACTIVE_LEGAL_PORTFOLIO = "NO_ACTIVE_LEGAL_PORTFOLIO"
NO_ACTIVE_LEGAL_CORPUS_SOURCE = "NO_ACTIVE_LEGAL_CORPUS_SOURCE"
NO_ENGINEERING_RULES_IN_PORTFOLIO = "NO_ENGINEERING_RULES_IN_PORTFOLIO"
PORTFOLIO_COMPILER_MODEL = "legal-preparation-agent"


@dataclass(frozen=True)
class RuleResolution:
    """READY (rules non-empty) or a reason the run cannot analyse rules."""

    status: str  # READY | BLOCKED
    catalog_version_id: str = ""  # transitional name: the pinned portfolio version id
    corpus_version_id: str = ""
    legal_rules: tuple[dict[str, Any], ...] = ()
    rules: tuple[Any, ...] = ()
    cache_hits: int = 0
    limitations: tuple[str, ...] = ()
    reason: str = ""
    observability: dict[str, Any] = field(default_factory=dict)


def resolve_engineering_rules(
    *,
    api_client: Any,
    retriever: Any,
    workflow_run_id: str,
    correlation_id: str | None,
) -> RuleResolution:
    portfolio = read_active_portfolio(api_client)
    if portfolio is None:
        return RuleResolution(
            "BLOCKED",
            limitations=(ENGINEERING_LIMITATION_CODES["no_legal_rule_catalog"],),
            reason=NO_ACTIVE_LEGAL_PORTFOLIO,
        )
    pin = portfolio.portfolio_version_id
    corpus = portfolio.legal_corpus_version_id

    chunks = _load_pinned_corpus_chunks(api_client, retriever, corpus)
    if not chunks:
        return RuleResolution(
            "BLOCKED", pin, corpus,
            limitations=(ENGINEERING_LIMITATION_CODES["no_legal_corpus_source"],),
            reason=NO_ACTIVE_LEGAL_CORPUS_SOURCE,
        )

    legal_rules = tuple(_to_legal_rule(rule) for rule in portfolio.legal_rules)
    rules: list[Any] = []
    failed: list[str] = []
    for engineering_rule in portfolio.engineering_rules:
        try:
            rules.append(_to_v1_rule(portfolio, engineering_rule))
        except Exception as error:  # noqa: BLE001
            failed.append(str(engineering_rule.get("engineeringRuleId") or "unknown"))
            logger.warning(
                "ENGINEERING_RULE_PORTFOLIO_BRIDGE_FAILED",
                engineering_rule_id=failed[-1], error_type=type(error).__name__,
                error_message=str(error)[:500], workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
    limitations = (
        (ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"],) if failed else ()
    )
    observability = {
        "legal_portfolio": {
            "portfolio_version_id": pin,
            "portfolio_version": portfolio.version,
            "portfolio_digest": portfolio.portfolio_digest,
            "legal_rule_count": len(legal_rules),
            "engineering_rule_count": len(portfolio.engineering_rules),
            "bridge_failed_engineering_rule_ids": failed,
        }
    }
    if not rules:
        return RuleResolution(
            "BLOCKED", pin, corpus, legal_rules, (), 0,
            tuple(dict.fromkeys([*limitations, ENGINEERING_LIMITATION_CODES["no_engineering_rule_candidates"]])),
            NO_ENGINEERING_RULES_IN_PORTFOLIO, observability,
        )
    return RuleResolution("READY", pin, corpus, legal_rules, tuple(rules), 0, limitations, "", observability)


def _load_pinned_corpus_chunks(api_client: Any, retriever: Any, corpus_id: str) -> list[dict[str, Any]]:
    chunks = api_client.get_legal_corpus_chunks(corpus_id).get("chunks") or []
    chunks = [item for item in chunks if isinstance(item, dict)] if isinstance(chunks, list) else []
    if chunks:
        retriever.index_corpus(corpus_id, chunks)
    return chunks


def _to_legal_rule(rule: dict[str, Any]) -> dict[str, Any]:
    legal_rule_id = str(rule["legalRuleId"])
    return {
        "id": legal_rule_id,
        "legalRuleId": legal_rule_id,
        "title": rule.get("title", ""),
        "proposition": rule.get("proposition", ""),
        "status": "ACTIVE",
        # Applicability is decided by the assessment agent; no deterministic facts gate it.
        "requiredFacts": [],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
    }


def _to_v1_rule(portfolio: ActivePortfolio, rule: dict[str, Any]) -> EngineeringRule:
    legal_rule_ids = sorted(rule.get("legalRuleIds") or ())
    if not legal_rule_ids:
        raise ValueError("engineering rule has no legal rule")
    sources = [source for source in rule.get("sources") or () if isinstance(source, dict)]
    legal_context = [
        {
            "id": source["chunkId"],
            "documentId": source["documentId"],
            "locator": source["locator"],
            "legalStatus": source.get("sourceEffectStatus", ""),
            "contentSha256": source["contentSha256"],
            "role": "SOURCE",
        }
        for source in sources
    ]
    required = tuple(rule.get("requiredEvidence") or ())
    supporting = tuple(rule.get("supportingEvidence") or ())
    negative = tuple(rule.get("negativeEvidence") or ())
    contract = build_legal_reasoning_contract(
        legal_rule={"legalRuleId": legal_rule_ids[0]},
        legal_rule_catalog_version_id=portfolio.portfolio_version_id,
        legal_corpus_version_id=portfolio.legal_corpus_version_id,
        legal_context=legal_context,
        required_evidence=required,
        supporting_evidence=supporting,
        negative_evidence=negative,
    )
    return EngineeringRule(
        engineering_rule_id=str(rule["engineeringRuleId"]),
        legal_rule_id=legal_rule_ids[0],
        legal_rule_catalog_version_id=portfolio.portfolio_version_id,
        legal_corpus_version_id=portfolio.legal_corpus_version_id,
        concept=str(rule["concept"]),
        legal_intent={
            "statement": rule.get("legalIntent", ""),
            "applicabilityGuidance": rule.get("applicabilityGuidance", ""),
            "criteria": list(rule.get("criteria") or ()),
            "legalRuleIds": legal_rule_ids,
        },
        investigation_goals=tuple(rule.get("investigationGoals") or ()),
        starting_node_types=tuple(rule.get("startingNodeTypes") or ()),
        target_node_types=tuple(rule.get("targetNodeTypes") or ()),
        edge_strategies=tuple(rule.get("edgeStrategies") or ()),
        graph_queries=tuple(
            GraphQueryTemplate(
                str(query["name"]),
                tuple(query.get("startNodeTypes") or ()),
                str(query["direction"]),
                tuple(query.get("followEdges") or ()),
                tuple(query.get("stopNodeTypes") or ()),
                tuple(query.get("semanticTypes") or ()),
            )
            for query in rule.get("graphQueries") or ()
        ),
        keywords=tuple(rule.get("keywords") or ()),
        common_apis=tuple(rule.get("commonApis") or ()),
        common_libraries=tuple(rule.get("commonLibraries") or ()),
        patterns=tuple(rule.get("patterns") or ()),
        required_evidence=required,
        supporting_evidence=supporting,
        negative_evidence=negative,
        unresolved_conditions=tuple(rule.get("unresolvedConditions") or ()),
        source_chunk_ids=tuple(source["chunkId"] for source in sources),
        source_locators=tuple(source["locator"] for source in sources),
        legal_reasoning_contract=contract,
        source_fingerprint=str(rule.get("sourceFingerprint", "")),
        compiler_model=PORTFOLIO_COMPILER_MODEL,
        compiler_version=portfolio.version,
        prompt_version=portfolio.portfolio_digest[:12],
        schema_version=ENGINEERING_RULE_SCHEMA_VERSION,
    )


__all__ = ["RuleResolution", "resolve_engineering_rules"]
