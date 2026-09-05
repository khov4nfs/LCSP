"""Managed boundary for persisted Customer Interview answers."""

from __future__ import annotations

import json
from typing import Any, Callable

from tools.common.capabilities.managed.boundary import AgentBoundaryBase
from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
    PostGuardContinuationStore,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedStructuredBusinessContext,
    normalize_confirmed_structured_business_context,
)

INTERVIEW_RESUME_COMMAND = "command.assessment-interview.resume-agent.v1"
CURRENT_CONTEXT = "CURRENT"
DUPLICATE_CONTEXT = "DUPLICATE"
STALE_CONTEXT = "STALE"
STALE_PROVENANCE_CONTEXT = "STALE_PROVENANCE"
_TERMINAL_GUARDED_OUTCOMES = {"CONTEXT_READY", "CONTEXT_RESOLVED"}
_DOWNSTREAM_IMPACT_FLAG = "DOWNSTREAM_IMPACT"


class AssessmentInterviewResumeBoundary(AgentBoundaryBase):
    """Run Interview reasoning, persist its guard, then continue durably."""

    boundary_source = "assessment.interview-answer-submitted"
    source_event = INTERVIEW_RESUME_COMMAND
    requires_rbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        rbac_client=None,
        root_agent=None,
        api_client=None,
        dispatcher=None,
        downstream_handler=None,
        investigator_resumer: Callable[..., dict[str, Any]] | None = None,
        investigation_completer: Callable[..., None] | None = None,
        downstream_impact_handler: Callable[..., None] | None = None,
        continuation_store=None,
    ) -> None:
        super().__init__(config, rbac_client)
        self._root_agent = root_agent
        self._api_client = api_client
        self._dispatcher = dispatcher
        self._downstream_handler = downstream_handler
        self._investigator_resumer = investigator_resumer
        self._investigation_completer = investigation_completer
        self._downstream_impact_handler = downstream_impact_handler
        self._continuation_store = continuation_store or PostGuardContinuationStore.from_config(
            config
        )

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        assessment_id = _required_text(message, "assessmentId")
        thread_id = _required_text(message, "threadId")
        question_id = _required_text(message, "questionId")
        source_version = _required_text(message, "sourceVersion")
        pge_version = _required_text(message, "pgeVersion")
        context_revision = _required_int(message, "contextRevision")
        resume_reason = _required_text(message, "resumeReason")
        api_client = self._api_client or self._load_api_client()

        context = api_client.get_interview_private_context(
            assessment_id,
            context_revision,
            source_version=source_version,
            pge_version=pge_version,
        )
        status = str(context.get("status") or "")
        if status == STALE_PROVENANCE_CONTEXT:
            self._reenter_root_for_revalidation(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                correlationId=correlationId,
                root=self._root_agent or self._load_root_agent(),
            )
            return

        # A guard-accepted broker delivery may be retried after the worker crashes.
        # DUPLICATE therefore means no new Interview model turn, not automatically no-op.
        # Terminal guarded state is resumed until the durable post-guard record is COMPLETED.
        if status == DUPLICATE_CONTEXT and _terminal_guarded_state(context):
            guarded_state = self._guarded_state_from_duplicate(
                assessment_id=assessment_id,
                context_revision=context_revision,
                source_version=str(context.get("sourceVersion") or source_version),
                pge_version=str(context.get("pgeVersion") or pge_version),
                context=context,
            )
            self._run_guarded_continuation(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                source_version=str(context.get("sourceVersion") or source_version),
                pge_version=str(context.get("pgeVersion") or pge_version),
                guarded_state=guarded_state,
                correlationId=correlationId,
            )
            return

        targeted_need = context.get("targetedNeed")
        targeted_mode = isinstance(targeted_need, dict)
        same_revision_resume = resume_reason == "PROVIDE_MORE_CONTEXT" or targeted_mode
        if not same_revision_resume:
            if status in {DUPLICATE_CONTEXT, STALE_CONTEXT}:
                return
            if status != CURRENT_CONTEXT:
                raise ValueError(f"unexpected Interview private context status: {status}")
        else:
            if status == STALE_CONTEXT:
                return
            if status not in {CURRENT_CONTEXT, DUPLICATE_CONTEXT}:
                raise ValueError(f"unexpected Interview private context status: {status}")
            if status == DUPLICATE_CONTEXT and _same_revision_resume_materialized(context):
                # The first same-revision targeted/follow-up delivery may author a question.
                # Once that question or a non-terminal final state is materialized, duplicate
                # delivery is a no-op before model invocation. Terminal guard retry was handled
                # above so it cannot be accidentally swallowed here.
                return

        decision = self._run_interview(
            assessment_id=assessment_id,
            thread_id=thread_id,
            question_id=question_id,
            context_revision=context_revision,
            resume_reason=resume_reason,
            context=context,
            correlationId=correlationId,
        )
        guarded_state = api_client.post_interview_agent_decision(
            assessment_id,
            decision,
        )
        self._run_guarded_continuation(
            assessment_id=assessment_id,
            thread_id=thread_id,
            question_id=question_id,
            context_revision=context_revision,
            source_version=str(context.get("sourceVersion") or source_version),
            pge_version=str(context.get("pgeVersion") or pge_version),
            guarded_state=guarded_state,
            correlationId=correlationId,
        )

    def _run_interview(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        resume_reason: str,
        context: dict[str, Any],
        correlationId: str,
    ) -> dict[str, Any]:
        dispatcher = self._dispatcher or self._load_dispatcher()
        instruction = _interview_instruction(
            assessment_id=assessment_id,
            question_id=question_id,
            context_revision=context_revision,
            resume_reason=resume_reason,
            context=context,
        )
        result = dispatcher.dispatch(
            subagent_type="interview",
            instruction=instruction,
            idempotency_key=(
                f"assessment-interview:{assessment_id}:{context_revision}:{resume_reason}"
            ),
            trigger=resume_reason,
            metadata={
                "assessment_id": assessment_id,
                "question_id": question_id,
                "context_revision": context_revision,
                "correlationId": correlationId,
            },
            thread_id=thread_id,
            reenter_root=False,
        )
        handoff = result.get("handoff") if isinstance(result, dict) else None
        if not isinstance(handoff, dict):
            raise ValueError("Interview specialist did not return a validated handoff")
        handoff["expectedContextRevision"] = context_revision
        targeted_need = context.get("targetedNeed")
        if isinstance(targeted_need, dict):
            if handoff.get("mode") != "TARGETED_INTERVIEW":
                raise ValueError(
                    "Targeted Interview specialist must return TARGETED_INTERVIEW mode"
                )
            question = handoff.get("activeQuestion")
            if isinstance(question, dict) and question.get("needId") not in {
                None,
                targeted_need.get("needId"),
            }:
                raise ValueError("Targeted Interview question escaped its registered need")
        return handoff

    def _run_guarded_continuation(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        source_version: str,
        pge_version: str,
        guarded_state: dict[str, Any],
        correlationId: str,
    ) -> None:
        outcome = str(guarded_state.get("outcome") or "")
        if outcome not in _TERMINAL_GUARDED_OUTCOMES:
            return
        payload = _continuation_store_payload(guarded_state)
        record = self._continuation_store.begin(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
            payload=payload,
        )
        if record.completed:
            return
        effective_state = dict(guarded_state)
        if not isinstance(effective_state.get("continuation"), dict):
            stored_continuation = record.payload.get("continuation")
            if isinstance(stored_continuation, dict):
                effective_state["continuation"] = dict(stored_continuation)
        self._continue_after_guard(
            assessment_id=assessment_id,
            thread_id=thread_id,
            question_id=question_id,
            context_revision=context_revision,
            source_version=source_version,
            pge_version=pge_version,
            guarded_state=effective_state,
            correlationId=correlationId,
        )
        self._continuation_store.complete(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
        )

    def _guarded_state_from_duplicate(
        self,
        *,
        assessment_id: str,
        context_revision: int,
        source_version: str,
        pge_version: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        public_state = context.get("publicState")
        if not isinstance(public_state, dict):
            raise RuntimeError("duplicate guarded continuation is missing worker state")
        guarded_state = dict(public_state)
        outcome = str(guarded_state.get("outcome") or "")
        record = self._continuation_store.get(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
        )
        if record is not None and record.completed:
            return guarded_state
        if outcome == "CONTEXT_RESOLVED":
            continuation = record.payload.get("continuation") if record is not None else None
            if not isinstance(continuation, dict):
                targeted_need = context.get("targetedNeed")
                if not isinstance(targeted_need, dict):
                    raise RuntimeError(
                        "duplicate resolved continuation is missing targeted need provenance"
                    )
                from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
                    reconstruct_managed_investigator_continuation,
                )

                continuation = reconstruct_managed_investigator_continuation(
                    config=self._config,
                    assessment_id=assessment_id,
                    targeted_need=targeted_need,
                    source_version=source_version,
                    pge_version=pge_version,
                )
            guarded_state["continuation"] = continuation
        return guarded_state

    def _continue_after_guard(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        source_version: str,
        pge_version: str,
        guarded_state: dict[str, Any],
        correlationId: str,
    ) -> None:
        outcome = str(guarded_state.get("outcome") or "")
        if outcome not in _TERMINAL_GUARDED_OUTCOMES:
            return
        if self._downstream_handler is not None:
            self._downstream_handler(
                {
                    "assessmentId": assessment_id,
                    "threadId": thread_id,
                    "questionId": question_id,
                    "contextRevision": context_revision,
                    "sourceVersion": source_version,
                    "pgeVersion": pge_version,
                    "outcome": outcome,
                    "flags": list(guarded_state.get("flags") or []),
                },
                correlationId,
            )
            return
        if outcome == "CONTEXT_READY":
            evidence_report_id = pge_version.split(":", 1)[0].strip()
            if not evidence_report_id:
                raise ValueError(
                    "guarded CONTEXT_READY is missing technical evidence report provenance"
                )
            from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
                InterviewGatedEngineeringAssessmentBoundary,
            )

            InterviewGatedEngineeringAssessmentBoundary(
                self._config,
                api_client=self._api_client,
            ).handle(
                {
                    "assessmentId": assessment_id,
                    "evidenceReportId": evidence_report_id,
                    "workflowRunId": thread_id,
                },
                correlationId,
            )
            return

        continuation = guarded_state.get("continuation")
        if not isinstance(continuation, dict):
            raise ValueError(
                "guarded CONTEXT_RESOLVED is missing server-owned continuation"
            )
        _validate_guarded_continuation_pins(
            continuation,
            source_version=source_version,
            pge_version=pge_version,
        )
        confirmed_context = guarded_state.get("confirmedContext")
        if not isinstance(confirmed_context, dict):
            raise ValueError(
                "guarded CONTEXT_RESOLVED is missing authoritative confirmedContext"
            )
        typed_confirmed_context = normalize_confirmed_structured_business_context(
            guarded_state,
            assessment_id=assessment_id,
        )
        if _has_downstream_impact(guarded_state):
            self._route_downstream_impact_to_orchestration(
                assessment_id=assessment_id,
                thread_id=thread_id,
                context_revision=context_revision,
                continuation=continuation,
                confirmed_context=typed_confirmed_context,
                correlationId=correlationId,
            )
            return

        self._resume_exact_investigator(
            assessment_id=assessment_id,
            context_revision=context_revision,
            continuation=continuation,
            confirmed_context=typed_confirmed_context,
            correlationId=correlationId,
        )

    def _route_downstream_impact_to_orchestration(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        context_revision: int,
        continuation: dict[str, Any],
        confirmed_context: ConfirmedStructuredBusinessContext,
        correlationId: str,
    ) -> None:
        if self._downstream_impact_handler is not None:
            self._downstream_impact_handler(
                assessment_id=assessment_id,
                thread_id=thread_id,
                context_revision=context_revision,
                continuation=continuation,
                confirmed_context=confirmed_context,
                correlation_id=correlationId,
            )
            return
        from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
            assert_managed_investigator_artifact_pins,
        )

        api_client = self._api_client or self._load_api_client()
        assert_managed_investigator_artifact_pins(api_client, continuation)
        affected_rule_ids = continuation.get("affectedRuleIds")
        artifact_versions = continuation.get("artifactVersions")
        if not isinstance(affected_rule_ids, list) or not affected_rule_ids:
            raise RuntimeError("downstream impact re-evaluation requires affectedRuleIds")
        if not isinstance(artifact_versions, dict) or not artifact_versions:
            raise RuntimeError("downstream impact re-evaluation requires artifact pins")
        root = self._root_agent or self._load_root_agent()
        root.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "A guarded Targeted Interview resolved the requested Customer context "
                            "and flagged DOWNSTREAM_IMPACT. Do not exact-resume the old Investigator. "
                            "Root Orchestration must choose the bounded selective rerun/rescope path "
                            "for the affected EngineeringRule scope while preserving the pinned legal, "
                            "technical-evidence, and repository artifacts below. Interview has only "
                            "raised the flag; this orchestration step owns the downstream decision.\n"
                            + json.dumps(
                                {
                                    "assessmentId": assessment_id,
                                    "contextRevision": context_revision,
                                    "affectedRuleIds": affected_rule_ids,
                                    "artifactVersions": artifact_versions,
                                    "confirmedContext": (
                                        confirmed_context.to_prompt_dict()
                                    ),
                                },
                                ensure_ascii=False,
                                sort_keys=True,
                            )
                        ),
                    }
                ]
            },
            config={
                "configurable": {
                    "thread_id": f"{thread_id}:downstream-impact:{context_revision}"
                },
                "metadata": {
                    "lcsp_thread_id": thread_id,
                    "assessment_id": assessment_id,
                    "context_revision": context_revision,
                    "affected_rule_ids": list(affected_rule_ids),
                    "artifact_versions": dict(artifact_versions),
                    "correlationId": correlationId,
                    "trigger": "INTERVIEW_DOWNSTREAM_IMPACT_REEVALUATION",
                },
            },
        )

    def _resume_exact_investigator(
        self,
        *,
        assessment_id: str,
        context_revision: int,
        continuation: dict[str, Any],
        confirmed_context: ConfirmedStructuredBusinessContext,
        correlationId: str,
    ) -> None:
        resumer = self._investigator_resumer
        if resumer is None:
            from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
                resume_managed_investigator,
            )

            resumer = resume_managed_investigator

        api_client = self._api_client or self._load_api_client()
        result = resumer(
            config=self._config,
            api_client=api_client,
            assessment_id=assessment_id,
            context_revision=context_revision,
            continuation=continuation,
            confirmed_context=confirmed_context,
            correlation_id=correlationId,
        )
        if not isinstance(result, dict):
            raise RuntimeError("exact Investigator resume returned an invalid result")
        if result.get("executionId") != continuation.get("investigatorExecutionId"):
            raise RuntimeError("exact Investigator resume execution identity drifted")
        if result.get("threadId") != continuation.get("workflowRunId"):
            raise RuntimeError("exact Investigator resume thread identity drifted")
        if result.get("fromCheckpointId") != continuation.get("checkpointId"):
            raise RuntimeError("exact Investigator resume checkpoint identity drifted")
        handoff = result.get("handoff")
        if not isinstance(handoff, dict):
            raise RuntimeError("exact Investigator resume did not return a typed handoff")
        if handoff.get("status") != "READY":
            raise RuntimeError(
                "exact Investigator resume must complete the original bounded investigation"
            )

        completer = self._investigation_completer
        if completer is None:
            from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
                complete_resumed_investigation,
            )

            completer = complete_resumed_investigation
        completer(
            config=self._config,
            api_client=api_client,
            assessment_id=assessment_id,
            context_revision=context_revision,
            continuation=continuation,
            confirmed_context=confirmed_context,
            resumed_handoff=handoff,
            correlation_id=correlationId,
        )

    def _reenter_root_for_revalidation(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        correlationId: str,
        root: Any,
    ) -> None:
        root.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Persisted Customer Interview context was stale against current "
                            "source/PGE provenance. Revalidate via Root Orchestration before "
                            "any Interview Agent sufficiency or downstream resume. "
                            f"Assessment: {assessment_id}. Thread: {thread_id}. "
                            f"Question: {question_id}. Requested revision: {context_revision}."
                        ),
                    }
                ]
            },
            config={
                "configurable": {"thread_id": thread_id},
                "metadata": {
                    "lcsp_thread_id": thread_id,
                    "assessment_id": assessment_id,
                    "question_id": question_id,
                    "context_revision": context_revision,
                    "correlationId": correlationId,
                    "trigger": "ASSESSMENT_INTERVIEW_REVALIDATION_REQUIRED",
                },
            },
        )

    def _load_api_client(self):
        from tools.common.capabilities.platform.api_client import WorkerApiClient
        from tools.common.capabilities.platform.config import load_config

        config = load_config()
        return WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)

    @staticmethod
    def _load_dispatcher():
        from orchestration.dispatcher import RootSubagentDispatcher

        return RootSubagentDispatcher()

    @staticmethod
    def _load_root_agent():
        from agent import agent

        return agent


def _terminal_guarded_state(context: dict[str, Any]) -> bool:
    state = context.get("publicState")
    return isinstance(state, dict) and str(state.get("outcome") or "") in _TERMINAL_GUARDED_OUTCOMES


def _same_revision_resume_materialized(context: dict[str, Any]) -> bool:
    state = context.get("publicState")
    if not isinstance(state, dict):
        return False
    if isinstance(state.get("activeQuestion"), dict):
        return True
    outcome = str(state.get("outcome") or "")
    if outcome in {"CONTEXT_READY", "CONTEXT_RESOLVED", "FAILED"}:
        return True
    return state.get("orchestrationRequested") is False


def _has_downstream_impact(state: dict[str, Any]) -> bool:
    flags = state.get("flags")
    return isinstance(flags, list) and _DOWNSTREAM_IMPACT_FLAG in flags


def _validate_guarded_continuation_pins(
    continuation: dict[str, Any],
    *,
    source_version: str,
    pge_version: str,
) -> None:
    if str(continuation.get("sourceVersion") or "") != source_version:
        raise RuntimeError("guarded continuation source version is stale")
    if str(continuation.get("pgeVersion") or "") != pge_version:
        raise RuntimeError("guarded continuation PGE version is stale")
    if not str(continuation.get("originatingInvestigationReference") or "").strip():
        raise RuntimeError("guarded continuation is missing origin")
    affected_rule_ids = continuation.get("affectedRuleIds")
    if not isinstance(affected_rule_ids, list) or not affected_rule_ids:
        raise RuntimeError("guarded continuation is missing affectedRuleIds")
    artifact_versions = continuation.get("artifactVersions")
    if not isinstance(artifact_versions, dict) or not artifact_versions:
        raise RuntimeError("guarded continuation is missing artifactVersions")


def _continuation_store_payload(state: dict[str, Any]) -> dict[str, Any]:
    continuation = state.get("continuation")
    if isinstance(continuation, dict):
        return {"continuation": dict(continuation)}
    return {}


def _interview_instruction(
    *,
    assessment_id: str,
    question_id: str,
    context_revision: int,
    resume_reason: str,
    context: dict[str, Any],
) -> str:
    private_revision = context.get("privateRevision")
    public_state = context.get("publicState")
    bounded_payload = {
        "assessmentId": assessment_id,
        "questionId": question_id,
        "contextRevision": context_revision,
        "resumeReason": resume_reason,
        "sourceVersion": context.get("sourceVersion"),
        "pgeVersion": context.get("pgeVersion"),
        "publicThreadState": public_state,
        "privateCustomerRevision": private_revision,
        "targetedNeed": context.get("targetedNeed"),
    }
    return (
        "Evaluate exactly one governed Assessment Interview turn. The JSON below is a "
        "private worker-only input and must not be copied into Customer-safe evidence or "
        "downstream prompts. Preserve hedging/contradictions, choose ASK vs CLARIFY, and "
        "return only the typed InterviewResult candidate. HTTP persistence is not proof "
        "of sufficiency. PROVIDE_MORE_CONTEXT means author the next bounded question from "
        "the existing thread; do not restart a targeted Interview.\n\n"
        + json.dumps(bounded_payload, ensure_ascii=False, sort_keys=True)
    )


def _required_text(message: dict[str, Any], field: str) -> str:
    value = str(message.get(field) or "").strip()
    if not value:
        raise ValueError(f"assessment Interview resume command requires {field}")
    return value


def _required_int(message: dict[str, Any], field: str) -> int:
    value = message.get(field)
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"assessment Interview resume command requires numeric {field}")
    return value
