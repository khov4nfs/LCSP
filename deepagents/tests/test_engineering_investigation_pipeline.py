"""Per-rule EngineeringRule assessment runtime coverage.

The Scanner/Planner/Investigator pipeline was deleted and replaced by a
per-EngineeringRule runtime (``rule_assessment/run.py`` + ``result.py`` + the
applicability/completion gates). These tests pin the new runtime's invariants:

- EVIDENCE_FOUND with positive evidence decides via the deterministic evaluator
  (SUPPORTS_REQUIREMENT -> COMPLIANT; DEMONSTRATES_VIOLATION -> NON_COMPLIANT).
- NOT_OBSERVED is epistemic only: it always maps to an unresolved claim and can
  never yield NON_COMPLIANT.
- FINAL_ABSENCE stays disabled: absence never finalizes a rule.
- The completion gate downgrades terminal conclusions until every required
  criterion is ready; stale/failed rule results are deferred, never concluded.
- One rule's failure never aborts the other rules (per-rule failure isolation).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_completion_gate import (
    apply_rule_completion_gate,
)
from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_evaluator import (
    EngineeringRuleEvaluator,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.result import (
    EngineeringInvestigationResult,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.rule_sources import (
    resolve_engineering_rules,
)
from tools.common.capabilities.assessment.rule_assessment.absence_policy import (
    absence_may_finalize,
)
from tools.common.capabilities.assessment.rule_assessment.run import (
    analyze_rule,
    finalize_rule_results,
    rule_runtime_version,
    technical_evidence_display,
    usable_rule_result,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_ANALYSIS_STATUSES,
    RULE_ASSESSMENT_VALIDATOR_ID,
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)
from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule

_COMMIT_SHA = "abc123"
_ASSESSMENT_ID = "assessment-1"


def _rule(rule_id: str = "eng-1", required: tuple[str, ...] = ("HUMAN_OVERSIGHT",)):
    return EngineeringRule(
        engineering_rule_id=rule_id,
        legal_rule_id="legal-1",
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        concept="HUMAN_OVERSIGHT",
        legal_intent={},
        investigation_goals=("Find review controls",),
        starting_node_types=(),
        target_node_types=(),
        edge_strategies=(),
        graph_queries=(),
        required_evidence=required,
        source_chunk_ids=("LAW:A1",),
        source_locators=("art-1::cl-1",),
    )


def _evidence_entry(
    *,
    rule_id: str = "eng-1",
    criterion: str = "HUMAN_OVERSIGHT",
    ref: str = "ref:review-control",
    path: str = "src/review.py",
) -> dict:
    return {
        "ref": ref,
        "path": path,
        "startLine": 10,
        "endLine": 20,
        "symbol": "review_control",
        "provenance": {
            "assessmentId": _ASSESSMENT_ID,
            "repositoryVersion": _COMMIT_SHA,
            "engineeringRuleId": rule_id,
            "criterionId": criterion,
            "validator": RULE_ASSESSMENT_VALIDATOR_ID,
        },
    }


def _found_criterion(
    *,
    rule_id: str = "eng-1",
    criterion: str = "HUMAN_OVERSIGHT",
    kind: str | None = None,
) -> dict:
    entry = _evidence_entry(rule_id=rule_id, criterion=criterion)
    return {
        "criterionId": criterion,
        "status": RULE_CRITERION_STATUSES["evidenceFound"],
        "evidenceKind": kind or RULE_EVIDENCE_KINDS["supportsRequirement"],
        "evidenceRefs": [entry["ref"]],
        "evidence": [entry],
        "technicalFacts": [],
        "limitations": [],
    }


def _assessment(rule, *, criteria: list[dict] | None = None, status: str | None = None) -> dict:
    if criteria is None:
        default_criterion = next(iter(rule.required_evidence), "HUMAN_OVERSIGHT")
        criteria = [
            _found_criterion(
                rule_id=rule.engineering_rule_id, criterion=default_criterion
            )
        ]
    return {
        "resultId": f"rar-{rule.engineering_rule_id}",
        "assessmentId": _ASSESSMENT_ID,
        "engineeringRuleId": rule.engineering_rule_id,
        "engineeringRuleVersion": rule_runtime_version(rule),
        "repositoryVersion": _COMMIT_SHA,
        "contextRevision": 1,
        "status": status or RULE_ANALYSIS_STATUSES["completed"],
        "criteria": criteria,
        "limitations": [],
        "execution": {"attempt": 1},
    }


def _finalize(rules, assessments, applicability) -> list:
    return finalize_rule_results(
        assessment_id=_ASSESSMENT_ID,
        rules=rules,
        api=MagicMock(),
        applicability_facts={},
        context_revision=1,
        assessments=assessments,
        applicability=applicability,
        commit_sha=_COMMIT_SHA,
    )


class _NoRecovery:
    """Legal preparation is deferred to Triage; the assessment loop never recovers."""

    def run(self, payload, correlation_id):
        raise RuntimeError("legal preparation is deferred to Triage")


def _api_client(rules=None):
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": rules
        if rules is not None
        else [{"legalRuleId": "rule-1", "status": "APPROVED"}],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }
    return api_client


def test_finalize_returns_direct_compliant_rule_evaluation() -> None:
    rule = _rule()
    assessment = _assessment(rule)

    assert usable_rule_result(
        rule, assessment, commit_sha=_COMMIT_SHA, applicability_status="MATCHED"
    ) is True
    evaluations = _finalize([rule], [assessment], {"eng-1": {"status": "MATCHED"}})

    assert len(evaluations) == 1
    assert evaluations[0].status == "COMPLIANT"
    assert evaluations[0].source_chunk_ids == ("LAW:A1",)
    result = EngineeringInvestigationResult(
        status="COMPLETE",
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        rules_considered=1,
        engineering_rules_executed=1,
        engineering_rule_cache_hits=1,
        evaluations=tuple(evaluations),
    )
    assert result.to_assessment_data()["summary"] == {
        "compliant": 1,
        "non_compliant": 0,
        "unknown": 0,
        "not_applicable": 0,
        "total": 1,
    }


def test_finalize_violation_evidence_yields_non_compliant() -> None:
    rule = _rule()
    assessment = _assessment(
        rule,
        criteria=[
            _found_criterion(kind=RULE_EVIDENCE_KINDS["demonstratesViolation"])
        ],
    )

    evaluations = _finalize([rule], [assessment], {"eng-1": {"status": "MATCHED"}})

    # Positive violation evidence (DEMONSTRATES_VIOLATION) may yield NON_COMPLIANT
    # via the deterministic evaluator; absence never does (see below).
    assert evaluations[0].status == "NON_COMPLIANT"


def test_not_observed_maps_to_unknown_never_non_compliant() -> None:
    rule = _rule()
    assessment = _assessment(
        rule,
        criteria=[
            {
                "criterionId": "HUMAN_OVERSIGHT",
                "status": RULE_CRITERION_STATUSES["notObserved"],
                "evidenceRefs": [],
                "evidence": [],
                "technicalFacts": [],
                "limitations": (
                    ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],
                ),
            }
        ],
        status=RULE_ANALYSIS_STATUSES["unresolved"],
    )

    evaluations = _finalize([rule], [assessment], {"eng-1": {"status": "MATCHED"}})

    # NOT_OBSERVED is epistemic only ("not established by this investigation") and
    # always maps to an unresolved claim -> UNKNOWN, never NON_COMPLIANT.
    assert evaluations[0].status == "UNKNOWN"


def test_final_absence_stays_disabled() -> None:
    assert absence_may_finalize(None) is False
    assert absence_may_finalize({}) is False
    assert (
        absence_may_finalize(
            {
                "graphQueryExhausted": True,
                "coverageComplete": True,
                "criterionSpecific": True,
            }
        )
        is False
    )


def test_completion_gate_withholds_terminal_conclusion_until_ready() -> None:
    rule = _rule(required=("CRIT_A", "CRIT_B"))
    assessment = _assessment(
        rule,
        criteria=[_found_criterion(criterion="CRIT_A")],
    )

    evaluations = _finalize([rule], [assessment], {"eng-1": {"status": "MATCHED"}})

    assert evaluations[0].status == "UNKNOWN"
    assert (
        ENGINEERING_LIMITATION_CODES["rule_conclusion_withheld"]
        in evaluations[0].limitations
    )

    # A ready terminal conclusion for one criterion must still be downgraded while
    # another required criterion is unresolved.
    ready_rule = _rule(required=("CRIT_A",))
    ready_assessment = _assessment(
        ready_rule, criteria=[_found_criterion(criterion="CRIT_A")]
    )
    (ready_evaluation,) = _finalize(
        [ready_rule], [ready_assessment], {"eng-1": {"status": "MATCHED"}}
    )
    assert ready_evaluation.status == "COMPLIANT"
    gated, provenance = apply_rule_completion_gate(
        ready_evaluation,
        {
            "ruleId": "eng-1",
            "ruleConclusionReady": False,
            "unresolvedCriterionIds": ["CRIT_B"],
            "activeNeedIds": [],
            "applicability": "MATCHED",
            "contextRevision": 1,
        },
    )
    assert gated.status == "UNKNOWN"
    assert provenance is not None and provenance["withheldStatus"] == "COMPLIANT"


def test_failed_rule_is_isolated_from_healthy_rule() -> None:
    from orchestration.context import LCSPRunContext

    good = _rule("eng-good", required=("HUMAN_OVERSIGHT",))
    bad = _rule("eng-bad", required=("HUMAN_OVERSIGHT",))
    confirmed = SimpleNamespace(context_revision=1, to_prompt_dict=lambda: {})

    class _FailingDispatcher:
        def dispatch(self, **kwargs):
            raise RuntimeError("model failed")

    class _MemoryApi:
        def __init__(self):
            self.rows: list[dict] = []

        def list_rule_assessments(self, assessment_id):
            return [row for row in self.rows if row.get("assessmentId") == assessment_id]

        def put_rule_assessment(self, assessment_id, rule_id, payload):
            self.rows.append(payload)
            return payload

    api = _MemoryApi()
    context = LCSPRunContext(
        assessment_id=_ASSESSMENT_ID,
        user_id="user-1",
        workflow_run_id="workflow-1",
        commit_sha=_COMMIT_SHA,
        artifact_versions={},
    )
    failed = analyze_rule(
        rule=bad,
        context=context,
        dispatcher=_FailingDispatcher(),
        api=api,
        confirmed_context=confirmed,
    )

    # One rule's failure writes a FAILED row for that rule only; the loop continues.
    assert failed["status"] == RULE_ANALYSIS_STATUSES["failed"]
    assert tuple(failed["limitations"]) == (
        ENGINEERING_LIMITATION_CODES["engineering_investigation_runtime_error"],
    )
    assert usable_rule_result(
        bad, failed, commit_sha=_COMMIT_SHA, applicability_status="MATCHED"
    ) is False

    healthy = _assessment(good)
    evaluations = _finalize(
        [good, bad],
        [healthy, failed],
        {"eng-good": {"status": "MATCHED"}, "eng-bad": {"status": "MATCHED"}},
    )
    by_rule = {item.engineering_rule_id: item for item in evaluations}
    assert by_rule["eng-good"].status == "COMPLIANT"
    # A failed persisted result is deferred (explicit UNKNOWN), never concluded from.
    assert by_rule["eng-bad"].status == "UNKNOWN"


def test_stale_rule_version_is_deferred_not_concluded() -> None:
    rule = _rule()
    assessment = _assessment(rule)
    assessment["engineeringRuleVersion"] = "sha256:stale-version"

    assert usable_rule_result(
        rule, assessment, commit_sha=_COMMIT_SHA, applicability_status="MATCHED"
    ) is False
    (evaluation,) = _finalize([rule], [assessment], {"eng-1": {"status": "MATCHED"}})

    assert evaluation.status == "UNKNOWN"


def test_not_applicable_rules_never_reach_analysis() -> None:
    rule = _rule()

    (evaluation,) = _finalize(
        [rule], [], {"eng-1": {"status": "NOT_APPLICABLE"}}
    )

    assert evaluation.status == "NOT_APPLICABLE"
    assert evaluation.evidence_refs == ()


def test_resolve_keeps_healthy_rules_when_one_compilation_fails() -> None:
    api_client = _api_client(
        [
            {"legalRuleId": "rule-bad", "status": "APPROVED"},
            {"legalRuleId": "rule-good", "status": "APPROVED"},
        ]
    )
    good = _rule("eng-good")
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = [
        ValueError("unresolvable"),
        ([good], False),
    ]

    resolution = resolve_engineering_rules(
        api_client=api_client,
        retriever=MagicMock(),
        rule_service=rule_service,
        recovery_driver=_NoRecovery(),
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
    )

    assert resolution.status == "READY"
    assert resolution.rules == (good,)
    assert (
        ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"]
        in resolution.limitations
    )


def test_resolve_waits_when_no_approved_source_rules_exist() -> None:
    api_client = _api_client([{"legalRuleId": "rule-1", "status": "DRAFT"}])
    rule_service = MagicMock()

    resolution = resolve_engineering_rules(
        api_client=api_client,
        retriever=MagicMock(),
        rule_service=rule_service,
        recovery_driver=_NoRecovery(),
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
    )

    # No approved legal rules means Triage has work pending: WAIT, don't fail.
    assert resolution.status == "WAITING"
    assert resolution.rules == ()
    assert resolution.limitations == (
        ENGINEERING_LIMITATION_CODES["no_engineering_rule_source_rules"],
    )
    rule_service.get_or_compile.assert_not_called()


def test_resolve_deduplicates_compilation_failure_to_machine_code() -> None:
    api_client = _api_client(
        [
            {"legalRuleId": "rule-1", "status": "APPROVED"},
            {"legalRuleId": "rule-2", "status": "APPROVED"},
        ]
    )
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = RuntimeError("provider failure detail")

    resolution = resolve_engineering_rules(
        api_client=api_client,
        retriever=MagicMock(),
        rule_service=rule_service,
        recovery_driver=_NoRecovery(),
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
    )

    assert resolution.status == "BLOCKED"
    assert resolution.rules == ()
    assert resolution.limitations == (
        ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"],
        ENGINEERING_LIMITATION_CODES["no_engineering_rule_candidates"],
    )
    assert rule_service.get_or_compile.call_count == 2


def test_technical_evidence_display_keeps_source_location_without_source_body() -> None:
    rule = _rule()
    assessment = _assessment(rule)

    displays = technical_evidence_display(assessment)

    assert displays == [
        {
            "kind": "SOURCE_LOCATION",
            "label": "review_control",
            "file_path": "src/review.py",
            "symbol_ref": "review_control",
            "start_line": 10,
            "end_line": 20,
        }
    ]
    assert "code" not in displays[0]
    assert "source" not in displays[0]


def test_rule_evaluator_treats_scope_claim_as_not_applicable() -> None:
    claim = EvidenceClaim(
        claim_id="claim-scope-1",
        engineering_rule_id="eng-1",
        claim_type="RULE_SCOPE_NOT_APPLICABLE",
        value=None,
        evidence_refs=(),
        customer_context_refs=("stmt-national-data",),
        confidence=0.0,
        criterion="TARGETED_SCOPE_EXCLUDED",
    )

    evaluation = EngineeringRuleEvaluator().evaluate(_rule(), [claim])

    assert evaluation.status == "NOT_APPLICABLE"
    assert evaluation.evidence_refs == ()
