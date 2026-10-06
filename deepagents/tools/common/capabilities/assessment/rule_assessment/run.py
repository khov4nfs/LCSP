"""Plain functions that run and finalize one EngineeringRule assessment.

``analyze_rule`` delegates ONE rule to the Repository Analyst directly (shared lifecycle/billing/stream) and reads back what the governed ``submit_rule_assessment`` tool persisted.
``finalize_rule_results`` turns persisted criteria into claims and runs the deterministic
evaluator + completion gate. No engine, scheduler or state machine: callers loop.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any

from middleware.failure_policy import AgentRunBudgetExceeded
from orchestration.agent_stream import agent_stream_rule_scope, agent_stream_stage
from orchestration.agent_stream import AGENT_STREAM_STAGES
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    EvidenceClaimValidationError,
    EvidenceClaimValidator,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)
from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_completion_gate import (
    apply_rule_completion_gate,
    deferred_evaluation,
)
from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_evaluator import (
    ENGINEERING_RULE_EVALUATION_STATUSES,
    EngineeringRuleEvaluation,
    EngineeringRuleEvaluator,
)
from tools.common.capabilities.assessment.planning.engineering_rule.rule_applicability_gate import (
    APPLICABILITY_STATUSES,
    applicability_by_engineering_rule,
    evaluate_applicability,
    legal_rule_id_index,
)
from tools.common.capabilities.platform.logging import get_logger
from tools.legal.corpus.engineering_rules.contract.runtime_projection import (
    runtime_contract_content_hash,
)

from .need_id import canonical_need_id
from .neutral_text import assert_neutral_customer_text
from .values import (
    RULE_ANALYSIS_ACTIVITIES,
    RULE_ANALYSIS_STATUSES,
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)

logger = get_logger(__name__)

REPOSITORY_ANALYST = "repository-analyst"
# Applicability outcomes that allow analysis; everything else is owner-routed, never analysed.
ELIGIBLE_APPLICABILITY = frozenset(
    {APPLICABILITY_STATUSES["matched"], APPLICABILITY_STATUSES["not_gated"]}
)
_ACTIVITY_EVENTS = {
    "ruleAnalysisStarted": ("TOOL_STARTED", "RUNNING"),
    "ruleAnalysisResumed": ("TOOL_STARTED", "RUNNING"),
    "ruleAnalysisCompleted": ("TOOL_COMPLETED", "WAITING"),
    "ruleAnalysisUnresolved": ("TOOL_COMPLETED", "WAITING"),
    "ruleAnalysisNeedsContext": ("TOOL_WAITING_INPUT", "WAITING"),
    "ruleAnalysisFailed": ("TOOL_FAILED", "RUNNING"),
    "businessContextRequested": ("TOOL_WAITING_INPUT", "WAITING"),
    "businessContextResolved": ("TOOL_COMPLETED", "RUNNING"),
    "ruleApplicabilityEvaluated": ("TOOL_COMPLETED", "RUNNING"),
    "ruleCompletionGated": ("TOOL_COMPLETED", "WAITING"),
}
_STATUS_ACTIVITY = {
    RULE_ANALYSIS_STATUSES["completed"]: "ruleAnalysisCompleted",
    RULE_ANALYSIS_STATUSES["needsContext"]: "ruleAnalysisNeedsContext",
    RULE_ANALYSIS_STATUSES["unresolved"]: "ruleAnalysisUnresolved",
    RULE_ANALYSIS_STATUSES["failed"]: "ruleAnalysisFailed",
}


def emit_rule_activity(
    api: Any,
    scan_job_id: str | None,
    activity: str,
    rule_id: str,
    **details: Any,
) -> None:
    """Best-effort live-timeline row for one RULE_ANALYSIS_* activity (technical detail only)."""
    post = getattr(api, "post_scan_runtime_event", None)
    if not scan_job_id or post is None:
        return
    event_type, run_status = _ACTIVITY_EVENTS[activity]
    name = RULE_ANALYSIS_ACTIVITIES[activity]
    payload: dict[str, Any] = {
        "event_type": event_type,
        "run_status": run_status,
        "stage": "TECHNICAL_EVIDENCE",
        "tool_name": f"rule_analysis:{rule_id}",
        "summary": name,
        "output_summary": {"activity": name, "engineeringRuleId": rule_id, **details},
    }
    if event_type == "TOOL_WAITING_INPUT":
        payload["waiting_reason"] = name
    try:
        post(scan_job_id, payload)
    except Exception:  # noqa: BLE001 - progress must never fail an assessment
        pass


def emit_rule_analysis_summary(api: Any, scan_job_id: str | None, **counts: Any) -> None:
    """One deterministic loop-start summary row (rule counts by applicability; no model data)."""
    post = getattr(api, "post_scan_runtime_event", None)
    if not scan_job_id or post is None:
        return
    try:
        post(
            scan_job_id,
            {
                "event_type": "TOOL_COMPLETED",
                "run_status": "RUNNING",
                "stage": "TECHNICAL_EVIDENCE",
                "tool_name": "rule_analysis_summary",
                "summary": "RULE_ANALYSIS_SUMMARY",
                "output_summary": dict(counts),
            },
        )
    except Exception:  # noqa: BLE001 - progress must never fail an assessment
        pass


def evaluate_rule_applicability(
    rules: Sequence[Any],
    applicability_facts: Mapping[str, Any],
) -> dict[str, Mapping[str, Any]]:
    """engineeringRuleId -> applicability result (deterministic; no model)."""
    results = evaluate_applicability(
        applicability_facts.get("legal_rules") or (),
        ai_discovery=applicability_facts.get("ai_discovery"),
        confirmed_statements=applicability_facts.get("confirmed_statements") or (),
        engineering_rule_ids_by_legal=legal_rule_id_index(
            str(rule.engineering_rule_id) for rule in rules
        ),
    )
    return applicability_by_engineering_rule(results)


def rule_runtime_version(rule: Any) -> str:
    return runtime_contract_content_hash(rule)


def analyze_rule(
    *,
    rule: Any,
    context: Any,
    dispatcher: Any,
    api: Any,
    confirmed_context: Any | None,
    prior_result: Mapping[str, Any] | None = None,
    attempt: int = 1,
) -> dict[str, Any]:
    """Run the Repository Analyst on one rule; return its persisted AcceptedRuleAssessment.

    A provider/malformed-tool failure (or no submission) is retried once. A second failure
    writes a FAILED result for this rule only; the caller's loop continues.
    """
    rule_id = str(rule.engineering_rule_id)
    revision = int(getattr(confirmed_context, "context_revision", 0) or 0)
    # Trusted resume authorization: "criterionId|evidenceKind|ref" — a prior ref is
    # re-citable only for the criterion and kind it was accepted under.
    prior_refs = tuple(
        dict.fromkeys(
            f"{criterion.get('criterionId')}|{criterion.get('evidenceKind') or ''}|{ref}"
            for criterion in (prior_result or {}).get("criteria") or ()
            if criterion.get("status") == RULE_CRITERION_STATUSES["evidenceFound"]
            for ref in criterion.get("evidenceRefs") or ()
        )
    )
    activity = "ruleAnalysisResumed" if prior_result else "ruleAnalysisStarted"
    emit_rule_activity(api, context.scan_job_id, activity, rule_id, attempt=attempt)
    failure: BaseException | None = None
    for attempt_no in (attempt, attempt + 1):
        execution_id = f"{rule_id}:{revision}:{attempt_no}:{uuid.uuid4().hex[:8]}"
        # workflow_run_id doubles as the root thread id and the stamped execution runId, so
        # each attempt gets its own thread and its result is identifiable.
        run_context = replace(
            context,
            workflow_run_id=f"{context.workflow_run_id}:rule:{execution_id}",
            engineering_rule_ids=(rule_id,),
            engineering_rule_version=rule_runtime_version(rule),
            criterion_ids=tuple(rule.required_evidence),
            context_revision=revision,
            prior_evidence_refs=prior_refs,
            rule_execution_id=execution_id,
        )
        try:
            with agent_stream_stage(AGENT_STREAM_STAGES["rule_analysis"]), agent_stream_rule_scope(
                rule_id,
                concept=rule.concept,
                required_evidence=rule.required_evidence,
                investigation_goals=rule.investigation_goals,
            ):
                dispatcher.dispatch(
                    subagent_type=REPOSITORY_ANALYST,
                    instruction=_task_instruction(rule, run_context, confirmed_context, prior_result),
                    affected_rule_ids=[rule_id],
                    idempotency_key=f"rule-analysis:{context.assessment_id}:{execution_id}",
                    trigger="RULE_ANALYSIS",
                    metadata={
                        "assessment_id": context.assessment_id,
                        "engineering_rule_id": rule_id,
                    },
                    thread_id=run_context.workflow_run_id,
                    context=run_context,
                )
            failure = RuntimeError("repository-analyst finished without submit_rule_assessment")
        except Exception as error:  # noqa: BLE001 - one rule never fails the loop
            failure = error
        # A successful submission survives a later run error (e.g. the budget hard stop).
        row = _fresh_result(api, context.assessment_id, rule_id, run_context.workflow_run_id)
        if row is not None:
            emit_rule_activity(
                api,
                context.scan_job_id,
                _STATUS_ACTIVITY.get(row.get("status"), "ruleAnalysisUnresolved"),
                rule_id,
                status=row.get("status"),
            )
            return row
        logger.warning(
            "RULE_ANALYSIS_ATTEMPT_FAILED",
            engineering_rule_id=rule_id,
            attempt=attempt_no,
            error_type=type(failure).__name__,
        )
        if isinstance(failure, AgentRunBudgetExceeded):
            break  # terminal by policy: retrying would only double the spend
    if prior_result and prior_result.get("status") != RULE_ANALYSIS_STATUSES["failed"]:
        # A failed resume never erases the rule's previously accepted result.
        emit_rule_activity(api, context.scan_job_id, "ruleAnalysisFailed", rule_id, attempt=attempt)
        return dict(prior_result)
    return _persist_failed(api, context, rule, revision, attempt + 1, failure, confirmed_context)


def _fresh_result(api: Any, assessment_id: str, rule_id: str, run_id: str) -> dict[str, Any] | None:
    for row in api.list_rule_assessments(assessment_id):
        if row.get("engineeringRuleId") == rule_id and (row.get("execution") or {}).get("runId") == run_id:
            return row
    return None


def _persist_failed(
    api: Any, context: Any, rule: Any, revision: int, attempt: int, error: BaseException | None,
    confirmed_context: Any | None,
) -> dict[str, Any]:
    rule_id = str(rule.engineering_rule_id)
    limitation = ENGINEERING_LIMITATION_CODES["engineering_investigation_runtime_error"]
    criteria = [
        {
            "criterionId": criterion_id,
            "status": RULE_CRITERION_STATUSES["technicalUnresolved"],
            "evidenceRefs": [],
            "evidence": [],
            "technicalFacts": [],
            "limitations": [limitation],
        }
        for criterion_id in rule.required_evidence
    ]
    version = rule_runtime_version(rule)
    identity = json.dumps(
        [context.assessment_id, rule_id, version, context.commit_sha, revision, attempt, "FAILED"]
    )
    payload = {
        "resultId": "rar_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24],
        "assessmentId": context.assessment_id,
        "engineeringRuleId": rule_id,
        "engineeringRuleVersion": version,
        "repositoryVersion": context.commit_sha,
        "contextRevision": revision,
        "status": RULE_ANALYSIS_STATUSES["failed"],
        "criteria": criteria,
        "limitations": [limitation],
        "execution": {
            "attempt": attempt,
            "exceptionType": type(error).__name__ if error else None,
        },
    }
    api.put_rule_assessment(context.assessment_id, rule_id, payload)
    emit_rule_activity(api, context.scan_job_id, "ruleAnalysisFailed", rule_id, attempt=attempt)
    return payload


def _task_instruction(rule: Any, context: Any, confirmed: Any | None, prior: Mapping[str, Any] | None) -> str:
    task: dict[str, Any] = {
        "engineeringRuleId": rule.engineering_rule_id,
        "engineeringRuleVersion": context.engineering_rule_version,
        "repositoryVersion": context.commit_sha,
        "concept": rule.concept,
        "legalIntent": dict(rule.legal_intent or {}),
        "investigationGoals": list(rule.investigation_goals),
        "requiredEvidenceCriteria": list(rule.required_evidence),
        "supportingEvidence": list(rule.supporting_evidence),
        "negativeEvidence": list(rule.negative_evidence),
        "authoredUnresolvedConditionsHints": list(rule.unresolved_conditions),
        "confirmedCustomerContext": confirmed.to_prompt_dict() if confirmed is not None else None,
    }
    if prior:
        task["priorAcceptedResult"] = {
            "criteria": [
                {
                    key: criterion.get(key)
                    for key in ("criterionId", "status", "evidenceKind", "evidenceRefs", "technicalFacts", "limitations")
                }
                for criterion in prior.get("criteria") or ()
            ]
        }
    return (
        "Analyze this single EngineeringRule in the assessment repository and finish by calling "
        "submit_rule_assessment with exactly these identity fields. "
        + ("This is a resume after Customer context was confirmed; re-analyze only what is open. " if prior else "")
        + json.dumps(task, ensure_ascii=False, sort_keys=True, default=str)
    )


def register_business_needs(
    *, rule: Any, assessment: Mapping[str, Any], context: Any, api: Any, user_id: str | None
) -> list[str]:
    """Register each BUSINESS_CONTEXT_REQUIRED criterion as a BusinessContextNeed (targeted-need API)."""
    registered: list[str] = []
    if not user_id:
        return registered
    asked: set[tuple[str, tuple[str, ...]]] = set()
    for criterion in assessment.get("criteria") or ():
        need = criterion.get("businessContextNeed")
        if criterion.get("status") != RULE_CRITERION_STATUSES["businessContextRequired"] or not need:
            continue
        # Criteria that hinge on one Customer-owned distinction carry the identical need
        # (same question, same resolutionCriterionIds); the Customer must be asked it once.
        ask_key = (
            str(need.get("question") or "").strip(),
            tuple(sorted(str(c) for c in need.get("resolutionCriterionIds") or [criterion["criterionId"]])),
        )
        if ask_key in asked:
            continue
        asked.add(ask_key)
        assert_neutral_customer_text(need.get("question"), need.get("observation"))
        # Rows persisted before ids were canonicalized carry spaces the API rejects.
        need_id = canonical_need_id(need["needId"])
        payload = {
            "actorId": user_id,
            "needId": need_id,
            "engineeringRuleId": rule.engineering_rule_id,
            "criterionId": criterion["criterionId"],
            "authoredConditionIndex": need.get("authoredConditionIndex"),
            "question": need["question"],
            "observation": need.get("observation"),
            "resolutionCriterionIds": list(need.get("resolutionCriterionIds") or [criterion["criterionId"]]),
            "evidenceRefs": list(criterion.get("evidenceRefs") or ()),
            "contextRevision": assessment.get("contextRevision", 0),
            "workflowRunId": context.workflow_run_id,
            "artifactVersions": dict(context.artifact_versions),
        }
        result = api.post_interview_targeted_need(context.assessment_id, payload)
        if isinstance(result, dict) and result.get("registered") is not False:
            registered.append(need_id)
            emit_rule_activity(
                api, context.scan_job_id, "businessContextRequested", rule.engineering_rule_id,
                needId=need_id, criterionId=criterion["criterionId"],
            )
    return registered


def usable_rule_result(
    rule: Any,
    assessment: Mapping[str, Any] | None,
    *,
    commit_sha: str | None,
    applicability_status: str | None,
) -> bool:
    """Whether a persisted result may feed claims, display and the gate (else: deferred)."""
    return bool(
        assessment
        and applicability_status in ELIGIBLE_APPLICABILITY
        and assessment.get("status") != RULE_ANALYSIS_STATUSES["failed"]
        and assessment.get("engineeringRuleVersion") == rule_runtime_version(rule)
        and (not commit_sha or assessment.get("repositoryVersion") == commit_sha)
    )


def claims_for_rule(
    rule: Any, assessment: Mapping[str, Any], *, commit_sha: str | None = None
) -> tuple[EvidenceClaim, ...]:
    """Claims from accepted criteria; only governed-validated positive evidence is decided."""
    rule_id = str(rule.engineering_rule_id)
    validator = EvidenceClaimValidator()
    claims: list[EvidenceClaim] = []
    for criterion in assessment.get("criteria") or ():
        cid = criterion.get("criterionId") if isinstance(criterion, Mapping) else None
        if not cid:
            continue
        limitations = tuple(criterion.get("limitations") or ())
        evidence = [e for e in criterion.get("evidence") or () if isinstance(e, Mapping)]
        kind = criterion.get("evidenceKind")
        decided = criterion.get("status") == RULE_CRITERION_STATUSES["evidenceFound"] and evidence
        if decided:
            violation = kind == RULE_EVIDENCE_KINDS["demonstratesViolation"]
            claim = EvidenceClaim(
                claim_id=f"claim:{rule_id}:{cid}",
                engineering_rule_id=rule_id,
                claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES[
                    "requirement_not_met" if violation else "requirement_met"
                ],
                value=not violation,
                evidence_refs=tuple(e["ref"] for e in evidence),
                source_locations=tuple(
                    {"path": e["path"], "start_line": e["startLine"], "end_line": e["endLine"]}
                    for e in evidence
                ),
                confidence=1.0,  # deterministic: live-verified source, not a model estimate
                limitations=limitations,
                criterion=cid,
                source_verified=True,
                evidence_kind=kind,
                evidence_provenance=tuple(
                    dict(e["provenance"]) for e in evidence if isinstance(e.get("provenance"), Mapping)
                ),
            )
            try:
                claims.append(
                    validator.validate_governed(
                        claim,
                        assessment_id=str(assessment.get("assessmentId")),
                        commit_sha=str(commit_sha or assessment.get("repositoryVersion")),
                    )
                )
                continue
            except EvidenceClaimValidationError:
                limitations = (*limitations, ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"])
        claims.append(
            EvidenceClaim(
                claim_id=f"claim:{rule_id}:{cid}",
                engineering_rule_id=rule_id,
                claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                value=None,
                evidence_refs=(),
                confidence=0.0,
                limitations=limitations or (ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],),
                criterion=cid,
            )
        )
    return tuple(claims)


def technical_evidence_display(assessment: Mapping[str, Any] | None, limit: int = 12) -> list[dict[str, Any]]:
    """Bounded classification display rows from accepted evidence (path/lines only, no source)."""
    rows: list[dict[str, Any]] = []
    for criterion in (assessment or {}).get("criteria") or ():
        for e in criterion.get("evidence") or ():
            rows.append(
                {
                    "kind": "SOURCE_LOCATION",
                    "label": e.get("symbol") or e["path"],
                    "file_path": e["path"],
                    "symbol_ref": e.get("symbol"),
                    "start_line": e["startLine"],
                    "end_line": e["endLine"],
                }
            )
    return rows[:limit]


def finalize_rule_results(
    *,
    assessment_id: str,
    rules: Sequence[Any],
    api: Any,
    applicability_facts: Mapping[str, Any],
    context_revision: int,
    assessments: Sequence[Mapping[str, Any]] | None = None,
    applicability: Mapping[str, Mapping[str, Any]] | None = None,
    commit_sha: str | None = None,
) -> list[EngineeringRuleEvaluation]:
    """Applicability -> claims from accepted criteria -> evaluator -> completion gate.

    A persisted result for another rule version or repository commit is stale: the rule is
    deferred (explicit UNKNOWN) instead of concluding from it.
    """
    rows = list(assessments) if assessments is not None else api.list_rule_assessments(assessment_id)
    by_rule = {row.get("engineeringRuleId"): row for row in rows}
    applicable = applicability if applicability is not None else evaluate_rule_applicability(rules, applicability_facts)
    evaluator = EngineeringRuleEvaluator()
    evaluations: list[EngineeringRuleEvaluation] = []
    for rule in rules:
        rule_id = str(rule.engineering_rule_id)
        # Missing applicability is never NOT_GATED (that means "no authored facts" only): defer.
        status = (applicable.get(rule_id) or {}).get("status")
        item: dict[str, Any] = {
            "ruleId": rule_id,
            "ruleConclusionReady": False,
            "unresolvedCriterionIds": list(rule.required_evidence),
            "activeNeedIds": [],
            "applicability": status,
            "contextRevision": context_revision,
        }
        if status == APPLICABILITY_STATUSES["not_applicable"]:
            evaluations.append(_not_applicable(rule))
            continue
        assessment = by_rule.get(rule_id)
        if not usable_rule_result(rule, assessment, commit_sha=commit_sha, applicability_status=status):
            evaluation, _ = deferred_evaluation(rule, item)
            evaluations.append(evaluation)
            continue
        criteria = [c for c in assessment.get("criteria") or () if isinstance(c, Mapping)]
        found = {
            c.get("criterionId") for c in criteria if c.get("status") == RULE_CRITERION_STATUSES["evidenceFound"]
        }
        # Readiness is over the rule's REQUIRED criteria: a criterion missing from the row is unresolved.
        item["unresolvedCriterionIds"] = [cid for cid in rule.required_evidence if cid not in found]
        item["activeNeedIds"] = [
            canonical_need_id(str(c["businessContextNeed"]["needId"]))
            for c in criteria
            if (c.get("businessContextNeed") or {}).get("needId")
        ]
        # contextRevision staleness is enforced by the ledger upsert; readiness is criteria only.
        item["ruleConclusionReady"] = not item["unresolvedCriterionIds"]
        evaluation = evaluator.evaluate(rule, claims_for_rule(rule, assessment, commit_sha=commit_sha))
        evaluation, _ = apply_rule_completion_gate(evaluation, item)
        evaluations.append(evaluation)
    return evaluations


def _not_applicable(rule: Any) -> EngineeringRuleEvaluation:
    return EngineeringRuleEvaluation(
        engineering_rule_id=str(rule.engineering_rule_id),
        legal_rule_id=str(rule.legal_rule_id),
        concept=str(rule.concept),
        status=ENGINEERING_RULE_EVALUATION_STATUSES["not_applicable"],
        reason="Deterministic legal applicability evaluation found the parent rule not applicable.",
        evidence_refs=(),
        source_chunk_ids=tuple(rule.source_chunk_ids),
        source_locators=tuple(rule.source_locators),
        confidence=1.0,
        limitations=(),
    )


__all__ = [
    "ELIGIBLE_APPLICABILITY",
    "analyze_rule",
    "claims_for_rule",
    "emit_rule_activity",
    "emit_rule_analysis_summary",
    "evaluate_rule_applicability",
    "finalize_rule_results",
    "register_business_needs",
    "technical_evidence_display",
    "usable_rule_result",
]
