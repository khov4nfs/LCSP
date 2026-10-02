"""Postgres-backed vertical coverage for the per-rule assessment loop.

The deleted ``managed_targeted_investigator`` durable langgraph harness is gone:
per-rule durability now lives in the API-owned rule-assessment ledger
(``analyze_rule`` persists one accepted row per rule; a failed resume never erases
a previously accepted row).
These tests exercise that contract against the same Postgres-backed store path and
stay skipped unless ``LCSP_TEST_CHECKPOINT_DATABASE_URL`` is present.
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

from orchestration.context import LCSPRunContext
from tools.common.capabilities.assessment.rule_assessment.run import (
    analyze_rule,
    finalize_rule_results,
    rule_runtime_version,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_ANALYSIS_STATUSES,
    RULE_ASSESSMENT_VALIDATOR_ID,
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedBusinessContextStatement,
    ConfirmedStructuredBusinessContext,
)
from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
    PostGuardContinuationStore,
)


CHECKPOINT_URL = os.environ.get("LCSP_TEST_CHECKPOINT_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not CHECKPOINT_URL,
    reason="real Postgres checkpoint integration requires LCSP_TEST_CHECKPOINT_DATABASE_URL",
)

ARTIFACT_PINS = {
    "technicalEvidenceReportId": "ter-postgres-1",
    "repositorySnapshotId": "snapshot-postgres-1",
    "legalRuleCatalogVersionId": "catalog-postgres-1",
    "legalCorpusVersionId": "corpus-postgres-1",
}

_CRITERION = "decision_authority"
_COMMIT_SHA = "abc123"


def _engineering_rule():
    from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule

    return EngineeringRule(
        engineering_rule_id="ENG-POSTGRES-1",
        legal_rule_id="legal-postgres-1",
        legal_rule_catalog_version_id=ARTIFACT_PINS["legalRuleCatalogVersionId"],
        legal_corpus_version_id=ARTIFACT_PINS["legalCorpusVersionId"],
        concept="HUMAN_OVERSIGHT",
        legal_intent={},
        investigation_goals=("Who approves the recommendation?",),
        starting_node_types=(),
        target_node_types=(),
        edge_strategies=(),
        graph_queries=(),
        required_evidence=(_CRITERION,),
        source_chunk_ids=("LAW:A1",),
        source_locators=("art-1::cl-1",),
    )


def _confirmed_context(assessment_id: str) -> ConfirmedStructuredBusinessContext:
    return ConfirmedStructuredBusinessContext(
        assessment_id=assessment_id,
        context_revision=8,
        statements=(
            ConfirmedBusinessContextStatement(
                statement_id="stmt-decision-authority",
                topic="decision_authority",
                statement="human",
                normalized_value="human",
                scope={"needId": "need-postgres-1"},
                evidence_refs=("evidence:customer:postgres",),
                respondent_ref="actor:authenticated-postgres",
                created_at="2026-09-05T00:00:00Z",
                supersedes_statement_id=None,
            ),
        ),
        limitations=("customer-confirmed current statements only",),
        source_version_ref="snapshot-postgres-1:abc123",
        pge_version="ter-postgres-1:v1",
        guidance_version="guidance-postgres-1",
    )


class _LedgerApi:
    """In-memory stand-in for the Postgres-backed rule-assessment ledger."""

    def __init__(self):
        self.rows: list[dict] = []

    def list_rule_assessments(self, assessment_id):
        return [row for row in self.rows if row.get("assessmentId") == assessment_id]

    def put_rule_assessment(self, assessment_id, rule_id, payload):
        self.rows.append(payload)
        return payload

    def post_scan_runtime_event(self, scan_job_id, payload):
        return None


def _accepted_row(context, rule) -> dict:
    entry = {
        "ref": "ref:postgres-1",
        "path": "src/approval.py",
        "startLine": 3,
        "endLine": 9,
        "symbol": "approve",
        "provenance": {
            "assessmentId": context.assessment_id,
            "repositoryVersion": context.commit_sha,
            "engineeringRuleId": "ENG-POSTGRES-1",
            "criterionId": _CRITERION,
            "validator": RULE_ASSESSMENT_VALIDATOR_ID,
        },
    }
    return {
        "resultId": "rar-postgres-1",
        "assessmentId": context.assessment_id,
        "engineeringRuleId": "ENG-POSTGRES-1",
        "engineeringRuleVersion": context.engineering_rule_version,
        "repositoryVersion": context.commit_sha,
        "contextRevision": 8,
        "status": RULE_ANALYSIS_STATUSES["completed"],
        "criteria": [
            {
                "criterionId": _CRITERION,
                "status": RULE_CRITERION_STATUSES["evidenceFound"],
                "evidenceKind": RULE_EVIDENCE_KINDS["supportsRequirement"],
                "evidenceRefs": [entry["ref"]],
                "evidence": [entry],
                "technicalFacts": [],
                "limitations": [],
            }
        ],
        "limitations": [],
        "execution": {"attempt": 1, "runId": context.workflow_run_id},
    }


class _CountingDispatcher:
    """One Repository Analyst turn per dispatch."""

    def __init__(self, api: _LedgerApi, run_counter: list[int]):
        self.api = api
        self.run_counter = run_counter
        self.calls = 0

    def dispatch(self, **kwargs):
        self.calls += 1
        self.run_counter.append(1)
        context = kwargs["context"]
        # Persist under the attempt's own thread so analyze_rule reads it back.
        row = _accepted_row(context, None)
        row["execution"] = {"attempt": 1, "runId": kwargs["thread_id"]}
        self.api.put_rule_assessment(context.assessment_id, "ENG-POSTGRES-1", row)
        return {"status": "COMPLETED"}


def _context(suffix: str) -> LCSPRunContext:
    return LCSPRunContext(
        assessment_id=f"assessment-postgres-{suffix}",
        user_id="customer-postgres-1",
        workflow_run_id=f"workflow-postgres-{suffix}",
        commit_sha=_COMMIT_SHA,
        artifact_versions=dict(ARTIFACT_PINS),
    )


def test_post_guard_pending_completed_state_survives_store_reconstruction() -> None:
    suffix = uuid4().hex
    assessment_id = f"assessment-postguard-{suffix}"
    first = PostGuardContinuationStore(CHECKPOINT_URL)
    pending = first.begin(
        assessment_id=assessment_id,
        context_revision=7,
        outcome="CONTEXT_RESOLVED",
        payload={"continuation": {"investigatorExecutionId": f"exec-{suffix}"}},
    )
    assert pending.completed is False

    second = PostGuardContinuationStore(CHECKPOINT_URL)
    recovered = second.get(
        assessment_id=assessment_id,
        context_revision=7,
        outcome="CONTEXT_RESOLVED",
    )
    assert recovered is not None
    assert recovered.completed is False
    assert recovered.payload["continuation"]["investigatorExecutionId"] == f"exec-{suffix}"

    second.complete(
        assessment_id=assessment_id,
        context_revision=7,
        outcome="CONTEXT_RESOLVED",
    )
    third = PostGuardContinuationStore(CHECKPOINT_URL)
    completed = third.get(
        assessment_id=assessment_id,
        context_revision=7,
        outcome="CONTEXT_RESOLVED",
    )
    assert completed is not None and completed.completed


def test_accepted_rule_row_is_reused_without_rerunning_analyst() -> None:
    suffix = uuid4().hex
    rule = _engineering_rule()
    api = _LedgerApi()
    run_counter: list[int] = []
    dispatcher = _CountingDispatcher(api, run_counter)
    context = _context(suffix)
    confirmed = _confirmed_context(context.assessment_id)

    row = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=dispatcher,
        api=api,
        confirmed_context=confirmed,
    )
    assert row["status"] == RULE_ANALYSIS_STATUSES["completed"]
    assert run_counter == [1]

    # A repeat carrying the previously accepted row reuses it instead of running
    # the analyst again.
    class _NeverDispatcher:
        def dispatch(self, **kwargs):  # pragma: no cover - must not run
            raise AssertionError("analyst must not re-run for an accepted row")

    cached = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=_NeverDispatcher(),
        api=api,
        confirmed_context=confirmed,
        prior_result=row,
    )
    assert cached == row
    assert run_counter == [1]


def test_accepted_rule_result_resume_is_replay_safe() -> None:
    suffix = uuid4().hex
    rule = _engineering_rule()
    api = _LedgerApi()
    run_counter: list[int] = []
    dispatcher = _CountingDispatcher(api, run_counter)
    context = _context(suffix)
    confirmed = _confirmed_context(context.assessment_id)

    first = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=dispatcher,
        api=api,
        confirmed_context=confirmed,
    )
    assert first["status"] == RULE_ANALYSIS_STATUSES["completed"]
    assert len(run_counter) == 1

    def _finalize(rows):
        from unittest.mock import MagicMock

        return finalize_rule_results(
            assessment_id=context.assessment_id,
            rules=[rule],
            api=MagicMock(),
            applicability_facts={},
            context_revision=8,
            assessments=rows,
            applicability={"ENG-POSTGRES-1": {"status": "MATCHED"}},
            commit_sha=_COMMIT_SHA,
        )

    (evaluation,) = _finalize([first])
    assert evaluation.status == "COMPLIANT"

    # A resume carrying the accepted row survives an analyst failure unchanged,
    # and replaying it concludes identically without re-running the analyst.
    class _FailingDispatcher:
        def dispatch(self, **kwargs):
            raise RuntimeError("model failed")

    for _ in range(2):
        replayed = analyze_rule(
            rule=rule,
            context=context,
            dispatcher=_FailingDispatcher(),
            api=api,
            confirmed_context=confirmed,
            prior_result=first,
        )
        assert replayed == first
        (replayed_evaluation,) = _finalize([replayed])
        assert replayed_evaluation.status == "COMPLIANT"
    assert len(run_counter) == 1
    assert rule_runtime_version(rule) == first["engineeringRuleVersion"]
