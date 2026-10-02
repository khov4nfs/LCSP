"""Resolve the pinned, READY EngineeringRules for one assessment run.

Moved from the retired planned pipeline: load the active legal catalog/corpus, recover the
legal sources once when they are missing, and materialize EngineeringRules from the governed
registry. Deterministic; no model. A run that cannot resolve rules reports WAITING (legal
preparation pending) or BLOCKED, and the boundary turns that into the classification result.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from tools.common.capabilities.platform.logging import get_logger

logger = get_logger(__name__)

LEGAL_RULE_ONLY_RECOVERY_REASONS = frozenset(
    {
        "LEGAL_RULE_SOURCE_LOAD_FAILED",
        "NO_ACTIVE_LEGAL_RULE_CATALOG",
        "NO_APPROVED_ENGINEERING_RULE_SOURCE_RULES",
    }
)
_APPROVED_STATES = {"", "ACTIVE", "APPROVED", "PUBLISHED"}


@dataclass(frozen=True)
class RuleResolution:
    """READY (rules non-empty) or a reason the run cannot analyse rules."""

    status: str  # READY | WAITING | BLOCKED
    catalog_version_id: str = ""
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
    rule_service: Any,
    recovery_driver: Any | None,
    workflow_run_id: str,
    correlation_id: str | None,
    source_crawl_requests: list[dict[str, Any]] | None = None,
) -> RuleResolution:
    def load() -> tuple[str, str, list[dict[str, Any]], list[dict[str, Any]]]:
        return _load_legal_sources(api_client, retriever)

    def recover(reason: str) -> bool:
        return _recover(
            api_client, recovery_driver, workflow_run_id, correlation_id, reason, source_crawl_requests
        )

    def reload(reason: str) -> tuple[str, str, list[dict[str, Any]], list[dict[str, Any]]]:
        try:
            return load()
        except Exception as error:  # noqa: BLE001
            _log("ENGINEERING_RULE_SOURCE_RELOAD_FAILED", reason, error, workflow_run_id, correlation_id)
            return ("", "", [], [])

    try:
        catalog, corpus, chunks, legal_rules = load()
    except Exception as error:  # noqa: BLE001
        _log("ENGINEERING_RULE_SOURCE_LOAD_FAILED", "LEGAL_RULE_SOURCE_LOAD_FAILED", error, workflow_run_id, correlation_id)
        catalog, corpus, chunks, legal_rules = (
            reload("LEGAL_RULE_SOURCE_LOAD_FAILED")
            if recover("LEGAL_RULE_SOURCE_LOAD_FAILED")
            else ("", "", [], [])
        )
    if not catalog:
        return RuleResolution(
            "BLOCKED", limitations=(ENGINEERING_LIMITATION_CODES["no_legal_rule_catalog"],),
            reason="NO_ACTIVE_LEGAL_RULE_CATALOG",
        )
    blocked_corpus = RuleResolution(
        "BLOCKED", catalog, corpus, limitations=(ENGINEERING_LIMITATION_CODES["no_legal_corpus_source"],),
        reason="NO_ACTIVE_LEGAL_CORPUS_SOURCE",
    )
    if not corpus or not chunks:
        if recover("NO_ACTIVE_LEGAL_CORPUS_SOURCE"):
            catalog, corpus, chunks, legal_rules = reload("NO_ACTIVE_LEGAL_CORPUS_SOURCE")
        if not corpus or not chunks:
            return blocked_corpus
    waiting_rules = RuleResolution(
        "WAITING", catalog, corpus, limitations=(ENGINEERING_LIMITATION_CODES["no_engineering_rule_source_rules"],),
        reason="NO_APPROVED_ENGINEERING_RULE_SOURCE_RULES",
    )
    if not legal_rules:
        if recover("NO_APPROVED_ENGINEERING_RULE_SOURCE_RULES"):
            catalog, corpus, chunks, legal_rules = reload("NO_APPROVED_ENGINEERING_RULE_SOURCE_RULES")
        if not legal_rules:
            return waiting_rules

    limitations, cache_hits, rules, observability = _prepare(
        rule_service, legal_rules, catalog, corpus, workflow_run_id, correlation_id
    )
    if not rules and recover("NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE"):
        catalog, corpus, chunks, legal_rules = reload("NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE")
        if not corpus or not chunks:
            return blocked_corpus
        if not legal_rules:
            return waiting_rules
        limitations, cache_hits, rules, observability = _prepare(
            rule_service, legal_rules, catalog, corpus, workflow_run_id, correlation_id
        )
    if not rules:
        return RuleResolution(
            "BLOCKED", catalog, corpus, tuple(legal_rules), (), cache_hits,
            tuple(dict.fromkeys([*limitations, ENGINEERING_LIMITATION_CODES["no_engineering_rule_candidates"]])),
            "NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE", observability,
        )
    return RuleResolution(
        "READY", catalog, corpus, tuple(legal_rules), tuple(rules), cache_hits,
        tuple(limitations), "", observability,
    )


def _load_legal_sources(api_client: Any, retriever: Any):
    catalog = api_client.get_active_legal_rule_catalog()
    corpus = api_client.get_active_legal_corpus()
    catalog_id = _required_id(catalog, "versionId", "version_id", "id", label="legal rule catalog version")
    corpus_id = _required_id(
        corpus, "versionId", "version_id", "corpusVersionId", "corpus_version_id", "id",
        label="legal corpus version",
    )
    chunks = api_client.get_legal_corpus_chunks(corpus_id).get("chunks") or []
    if not isinstance(chunks, list):
        raise ValueError("active legal corpus chunks are invalid")
    chunks = [item for item in chunks if isinstance(item, dict)]
    retriever.index_corpus(corpus_id, chunks)
    legal_rules = [
        rule for rule in (catalog.get("rules") or []) if isinstance(rule, dict) and _is_approved(rule)
    ]
    return catalog_id, corpus_id, chunks, legal_rules


def _prepare(rule_service, legal_rules, catalog_id, corpus_id, workflow_run_id, correlation_id):
    limitations: list[str] = []
    cache_hits = 0
    rules: list[Any] = []
    failures: list[dict[str, Any]] = []
    skipped: list[str] = []
    counts: list[dict[str, Any]] = []
    for legal_rule in legal_rules:
        legal_rule_id = str(
            legal_rule.get("legalRuleId") or legal_rule.get("legal_rule_id") or legal_rule.get("id") or "unknown"
        )
        try:
            engineering_rules, cache_hit = rule_service.get_or_compile(
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=catalog_id,
                legal_corpus_version_id=corpus_id,
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )
        except Exception as error:  # noqa: BLE001
            _log("ENGINEERING_RULE_COMPILATION_FAILED", legal_rule_id, error, workflow_run_id, correlation_id)
            limitations.append(ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"])
            failures.append({"legal_rule_id": legal_rule_id, "error_type": type(error).__name__})
            continue
        cache_hits += bool(cache_hit)
        # Empty + no cache decision = triage has not run yet (missing work); a cached empty
        # result is a finished "no EngineeringRule" decision.
        if not engineering_rules and not cache_hit:
            skipped.append(legal_rule_id)
        counts.append(
            {"legal_rule_id": legal_rule_id, "engineering_rule_count": len(engineering_rules), "cache_hit": cache_hit}
        )
        rules.extend(engineering_rules)
    return limitations, cache_hits, rules, {
        "engineering_rule_preparation": {
            "legal_rules_seen": len(legal_rules),
            "candidate_count": len(rules),
            "compile_failed_count": len(failures),
            "compile_failed_legal_rule_ids": [item["legal_rule_id"] for item in failures],
            "compile_failures": failures,
            "compile_skipped_count": len(skipped),
            "compile_skipped_legal_rule_ids": skipped,
            "compiled_engineering_rule_counts": counts,
        }
    }


def _recover(api_client, driver, workflow_run_id, correlation_id, reason, source_crawl_requests) -> bool:
    logger.info("ENGINEERING_RULE_SOURCE_RECOVERY_REQUESTED", reason=reason, workflow_run_id=workflow_run_id)
    if driver is None:
        from tools.legal.sources.recovery.legal_corpus_recovery_driver import LegalCorpusRecoveryDriver

        driver = LegalCorpusRecoveryDriver(api_client=api_client)
    modes = (
        ((True, "legal-rules-only"), (False, "corpus-rebuild"))
        if reason in LEGAL_RULE_ONLY_RECOVERY_REASONS
        else ((False, "corpus-rebuild"),)
    )
    for legal_rules_only, mode in modes:
        payload: dict[str, Any] = {
            "idempotencyKey": f"{workflow_run_id}:engineering-rule-source-recovery",
            "maxRuns": 0,
            "recoverLegalRulesOnly": legal_rules_only,
        }
        if source_crawl_requests:
            payload["sourceCrawlRequests"] = source_crawl_requests
        try:
            driver.run(payload, correlation_id or workflow_run_id)
        except Exception as error:  # noqa: BLE001
            _log("ENGINEERING_RULE_SOURCE_RECOVERY_FAILED", f"{reason}:{mode}", error, workflow_run_id, correlation_id)
            continue
        return True
    return False


def _required_id(payload: dict[str, Any], *keys: str, label: str) -> str:
    for key in keys:
        if payload.get(key):
            return str(payload[key])
    raise ValueError(f"missing {label}")


def _is_approved(rule: dict[str, Any]) -> bool:
    status = str(rule.get("status") or rule.get("lifecycleState") or rule.get("lifecycle_state") or "")
    return status.upper() in _APPROVED_STATES


def _log(event: str, reason: str, error: Exception, workflow_run_id: str, correlation_id: str | None) -> None:
    logger.warning(
        event, reason=reason, error_type=type(error).__name__, error_message=str(error)[:500],
        workflow_run_id=workflow_run_id, correlationId=correlation_id,
    )


__all__ = ["RuleResolution", "resolve_engineering_rules"]
