from __future__ import annotations

from unittest.mock import MagicMock

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.rule_sources import (
    resolve_engineering_rules,
)


def _api(*, rules=3, chunks=True):
    api = MagicMock()
    api.get_active_legal_rule_catalog.return_value = {
        "versionId": "cat-1",
        "rules": [
            {"id": f"rule-{i}", "legalRuleId": f"L{i}", "status": "APPROVED"} for i in range(rules)
        ],
    }
    api.get_active_legal_corpus.return_value = {"versionId": "corp-1"}
    api.get_legal_corpus_chunks.return_value = {"chunks": [{"id": "c1"}] if chunks else []}
    return api


def _resolve(api, rule_service):
    # recovery_driver stands in for the "deferred to Triage" driver the boundary passes.
    return resolve_engineering_rules(
        api_client=api,
        retriever=MagicMock(),
        rule_service=rule_service,
        recovery_driver=MagicMock(),
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
    )


def test_provider_failure_uses_compilation_failure_semantics() -> None:
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = RuntimeError("provider failed")

    result = _resolve(_api(), rule_service)

    assert rule_service.get_or_compile.call_count >= 3
    assert result.status == "BLOCKED"
    assert result.rules == ()
    assert ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"] in result.limitations
    assert all("BUDGET" not in limitation for limitation in result.limitations)


def test_ready_rules_are_resolved_with_pinned_versions() -> None:
    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([object()], True)

    result = _resolve(_api(rules=2), rule_service)

    assert result.status == "READY"
    assert (result.catalog_version_id, result.corpus_version_id) == ("cat-1", "corp-1")
    assert len(result.rules) == 2
    assert result.cache_hits == 2


def test_no_approved_legal_rules_waits_for_triage_instead_of_failing() -> None:
    result = _resolve(_api(rules=0), MagicMock())

    assert result.status == "WAITING"
    assert result.limitations == (ENGINEERING_LIMITATION_CODES["no_engineering_rule_source_rules"],)


def test_uncompiled_legal_rules_are_reported_as_missing_work_for_triage() -> None:
    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([], False)

    result = _resolve(_api(rules=2), rule_service)

    assert result.status == "BLOCKED"
    assert result.reason == "NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE"
    assert result.observability["engineering_rule_preparation"]["compile_skipped_legal_rule_ids"]
