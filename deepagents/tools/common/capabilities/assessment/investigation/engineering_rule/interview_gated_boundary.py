"""Gate accepted PGE evidence through Initial Interview before EngineeringRule work."""

from __future__ import annotations

import json
from typing import Any

from orchestration.dispatcher import RootSubagentDispatcher

from .engineering_assessment_boundary import EngineeringAssessmentBoundary
from .managed_targeted_investigator import (
    ManagedTargetedInvestigatorPipeline,
    TargetedInterviewPending,
)


_TERMINAL_WAITING_OUTCOMES = {
    "WAITING_FOR_CUSTOMER",
    "BLOCKED_OR_UNRESOLVED",
    "FAILED",
}


class _ConfirmedContextPipeline:
    """Inject only server-guarded confirmed Customer context into the existing pipeline."""

    def __init__(self, delegate: Any, confirmed_context: dict[str, Any]) -> None:
        self._delegate = delegate
        self._confirmed_context = dict(confirmed_context)

    def run(self, *args: Any, **kwargs: Any) -> Any:
        kwargs["confirmed_customer_context"] = dict(self._confirmed_context)
        return self._delegate.run(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)


class InterviewGatedEngineeringAssessmentBoundary(EngineeringAssessmentBoundary):
    """Production accepted-evidence boundary with decision-before-downstream Interview gating."""

    def __init__(
        self,
        *args: Any,
        interview_dispatcher: Any | None = None,
        recovery_root: Any | None = None,
        **kwargs: Any,
    ) -> None:
        injected_pipeline = kwargs.get("investigation_pipeline")
        super().__init__(*args, **kwargs)
        self._interview_dispatcher = interview_dispatcher
        self._recovery_root = recovery_root
        if injected_pipeline is None:
            self._pipeline = ManagedTargetedInvestigatorPipeline(
                delegate=self._pipeline,
                config=self._config,
                api_client=self._api_client,
            )

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        evidence_report_id = self._evidence_report_id(message)
        evidence_report = self._api_client.get_accepted_technical_evidence_report(
            evidence_report_id
        )
        assessment_id = str(
            evidence_report.get("assessment_id")
            or evidence_report.get("assessmentId")
            or message.get("assessmentId")
            or message.get("assessment_id")
            or ""
        )
        if not assessment_id:
            raise ValueError("accepted evidence report is missing assessment_id")

        confirmed_context = self._prepare_interview(
            evidence_report=evidence_report,
            evidence_report_id=evidence_report_id,
            assessment_id=assessment_id,
            correlation_id=correlationId,
        )
        if confirmed_context is None:
            return

        original_pipeline = self._pipeline
        self._pipeline = _ConfirmedContextPipeline(original_pipeline, confirmed_context)
        try:
            try:
                super().handle(message, correlationId)
            except TargetedInterviewPending:
                # The managed Investigator already persisted the exact child
                # execution/checkpoint and queued Targeted Interview. Do not emit a
                # classification callback or continue deterministic evaluation until
                # that exact execution is resumed with guarded Customer context.
                return
        finally:
            self._pipeline = original_pipeline

    def _prepare_interview(
        self,
        *,
        evidence_report: dict[str, Any],
        evidence_report_id: str,
        assessment_id: str,
        correlation_id: str,
    ) -> dict[str, Any] | None:
        coverage_state, coverage_notes = _technical_coverage(evidence_report)
        if coverage_state == "UNAVAILABLE":
            self._route_unavailable_coverage_to_recovery(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                coverage_notes=coverage_notes,
                correlation_id=correlation_id,
            )
            return None

        state = self._api_client.get_interview_worker_state(assessment_id)
        outcome = str(state.get("outcome") or "")
        context_revision = int(state.get("contextRevision") or 0)
        active_question = state.get("activeQuestion")

        if outcome == "CONTEXT_READY":
            confirmed = state.get("confirmedContext")
            return dict(confirmed) if isinstance(confirmed, dict) else {}

        if outcome in _TERMINAL_WAITING_OUTCOMES and (
            active_question is not None
            or context_revision > 0
            or outcome != "WAITING_FOR_CUSTOMER"
        ):
            return None

        if outcome != "WAITING_FOR_CUSTOMER" or context_revision != 0:
            return None

        dispatcher = self._interview_dispatcher or RootSubagentDispatcher()
        result = dispatcher.dispatch(
            subagent_type="interview",
            instruction=_initial_interview_instruction(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                evidence_report=evidence_report,
            ),
            idempotency_key=f"assessment-interview-initial:{assessment_id}:{evidence_report_id}",
            trigger="TECHNICAL_EVIDENCE_ACCEPTED",
            metadata={
                "assessment_id": assessment_id,
                "technical_evidence_report_id": evidence_report_id,
                "correlationId": correlation_id,
            },
            thread_id=f"interview:{assessment_id}",
            reenter_root=False,
        )
        handoff = result.get("handoff") if isinstance(result, dict) else None
        if not isinstance(handoff, dict):
            raise ValueError("Initial Interview specialist did not return a validated handoff")
        if handoff.get("outcome") != "WAITING_FOR_CUSTOMER" or not isinstance(
            handoff.get("activeQuestion"), dict
        ):
            raise ValueError(
                "Initial Interview must persist a Customer question before EngineeringRule work"
            )
        handoff["expectedContextRevision"] = 0
        self._api_client.post_interview_initial_question(assessment_id, handoff)
        return None

    def _route_unavailable_coverage_to_recovery(
        self,
        *,
        assessment_id: str,
        evidence_report_id: str,
        coverage_notes: list[str],
        correlation_id: str,
    ) -> None:
        root = self._recovery_root
        if root is None:
            from agent import agent

            root = agent
        root.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Technical evidence coverage is UNAVAILABLE. Do not enter Initial Interview, "
                            "EngineeringRule, Planner, or Investigator. Run Root Orchestration recovery "
                            "for the pinned technical evidence first (for example targeted re-analysis or "
                            "a governed re-scan), then re-enter the assessment only from newly accepted "
                            "technical evidence. "
                            f"Assessment: {assessment_id}. Evidence report: {evidence_report_id}. "
                            f"Bounded coverage notes: {json.dumps(coverage_notes, ensure_ascii=False)}"
                        ),
                    }
                ]
            },
            config={
                "configurable": {
                    "thread_id": f"assessment:{assessment_id}:coverage-recovery"
                },
                "metadata": {
                    "assessment_id": assessment_id,
                    "technical_evidence_report_id": evidence_report_id,
                    "correlationId": correlation_id,
                    "trigger": "TECHNICAL_COVERAGE_UNAVAILABLE_RECOVERY",
                },
            },
        )


def _technical_coverage(evidence_report: dict[str, Any]) -> tuple[str, list[str]]:
    payload = evidence_report.get("evidence_payload") or evidence_report.get(
        "evidencePayload"
    )
    graph = payload.get("evidence_graph") if isinstance(payload, dict) else None
    coverage_state = "UNKNOWN"
    coverage_notes: list[str] = []
    if isinstance(graph, dict):
        coverage_state = str(
            graph.get("coverage_state") or graph.get("coverageState") or "UNKNOWN"
        ).upper()
        raw_notes = graph.get("coverage_notes") or graph.get("coverageNotes") or []
        if isinstance(raw_notes, list):
            coverage_notes = [str(item)[:240] for item in raw_notes[:8]]
    return coverage_state, coverage_notes


def _initial_interview_instruction(
    *,
    assessment_id: str,
    evidence_report_id: str,
    evidence_report: dict[str, Any],
) -> str:
    coverage_state, coverage_notes = _technical_coverage(evidence_report)
    safe_context = {
        "assessmentId": assessment_id,
        "technicalEvidenceReportId": evidence_report_id,
        "coverageState": coverage_state,
        "coverageNotes": coverage_notes,
        "snapshotId": evidence_report.get("snapshot_id")
        or evidence_report.get("snapshotId"),
        "schemaVersion": evidence_report.get("schema_version")
        or evidence_report.get("schemaVersion"),
    }
    return (
        "Run INITIAL_INTERVIEW before any EngineeringRule, Planner or Investigator work. "
        "Use only this bounded technical coverage/provenance summary to decide the first Customer question. "
        "Missing technical evidence is not proof that a business behavior does not exist. "
        "Do not infer Customer confirmation from PGE/documentary evidence. "
        "Return WAITING_FOR_CUSTOMER with exactly one bounded activeQuestion.\n"
        f"Bounded initial context: {json.dumps(safe_context, ensure_ascii=False, sort_keys=True)}"
    )


__all__ = ["InterviewGatedEngineeringAssessmentBoundary"]
