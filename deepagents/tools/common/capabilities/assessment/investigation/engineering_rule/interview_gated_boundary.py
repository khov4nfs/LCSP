"""Gate accepted PGE evidence through Initial Interview before EngineeringRule work."""

from __future__ import annotations

from orchestration.agent_stream import invoke_with_stream

import hashlib
import json
import re
from typing import Any

from orchestration.dispatcher import RootSubagentDispatcher
from decision.shadow import InterviewRoutingPacket, observer_from_api_client
from tools.common.capabilities.platform.api_client import InterviewCoverageCallbackError

from .engineering_assessment_boundary import EngineeringAssessmentBoundary
from .managed_targeted_investigator import (
    ManagedTargetedInvestigatorPipeline,
    TargetedInterviewPending,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedStructuredBusinessContext,
    normalize_confirmed_structured_business_context,
)


_TERMINAL_WAITING_OUTCOMES = {
    "WAITING_FOR_CUSTOMER",
    "BLOCKED_OR_UNRESOLVED",
    "FAILED",
}

_CANONICAL_COVERAGE_STATES = {
    "READY": "READY",
    "SUFFICIENT": "READY",
    "PARTIAL": "PARTIAL",
    "LIMITED": "PARTIAL",
    "UNAVAILABLE": "UNAVAILABLE",
}


class _ConfirmedContextPipeline:
    """Inject only server-guarded confirmed Customer context into the existing pipeline."""

    def __init__(
        self,
        delegate: Any,
        confirmed_context: ConfirmedStructuredBusinessContext,
    ) -> None:
        self._delegate = delegate
        self._confirmed_context = confirmed_context

    def run(self, *args: Any, **kwargs: Any) -> Any:
        kwargs["confirmed_customer_context"] = self._confirmed_context
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
        evidence_report = self._get_accepted_evidence_report(evidence_report_id)
        assessment_id = str(
            evidence_report.get("assessment_id")
            or evidence_report.get("assessmentId")
            or message.get("assessmentId")
            or message.get("assessment_id")
            or ""
        )
        if not assessment_id:
            raise ValueError("accepted evidence report is missing assessment_id")

        workflow_run_id = self._workflow_run_id(
            message,
            evidence_report,
            evidence_report_id,
        )
        confirmed_context = self._prepare_interview(
            evidence_report=evidence_report,
            evidence_report_id=evidence_report_id,
            assessment_id=assessment_id,
            correlation_id=correlationId,
            workflow_run_id=workflow_run_id,
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
        workflow_run_id: str | None = None,
    ) -> ConfirmedStructuredBusinessContext | None:
        coverage_state, coverage_notes = _technical_coverage(evidence_report)
        ai_discovery = _ai_discovery(evidence_report)

        # Customer authority is part of the absence closure. Load persisted Interview
        # state before evaluating the Scanner/PGE no-AI gate so a later repository-only
        # scan cannot erase already confirmed external/off-repository AI context.
        state = self._api_client.get_interview_worker_state(assessment_id)
        outcome = str(state.get("outcome") or "")
        context_revision = int(state.get("contextRevision") or 0)
        active_question = state.get("activeQuestion")
        authoritative_customer_ai = _has_authoritative_customer_ai_context(state)

        # The no-AI fast path is governed Scanner/PGE truth, not an Interview/LLM
        # conclusion. It is valid only when technical coverage is READY and there is no
        # authoritative Customer confirmation of AI usage outside repository evidence.
        if ai_discovery and ai_discovery.get("gate") == "AI_ABSENT_CONFIRMED":
            if coverage_state == "READY" and ai_discovery.get("coverage_state") == "READY":
                if not authoritative_customer_ai:
                    return None
            else:
                self._route_ai_discovery_to_recovery(
                    assessment_id=assessment_id,
                    evidence_report_id=evidence_report_id,
                    ai_discovery=ai_discovery,
                    correlation_id=correlation_id,
                )
                return None

        if not _can_start_initial_interview(coverage_state, coverage_notes, evidence_report):
            self._route_coverage_to_recovery(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                coverage_state=coverage_state,
                coverage_notes=coverage_notes,
                correlation_id=correlation_id,
            )
            return None

        # Scanner/PGE-owned uncertainty is independent of Customer-owned clarification.
        # A Customer question may exist, but downstream assessment must not resume while
        # material technical frontiers remain unresolved.
        if ai_discovery and ai_discovery.get("gate") == "AI_UNKNOWN" and _has_technical_ai_uncertainty(ai_discovery):
            self._route_ai_discovery_to_recovery(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                ai_discovery=ai_discovery,
                correlation_id=correlation_id,
            )
            return None

        if outcome == "CONTEXT_READY":
            return normalize_confirmed_structured_business_context(
                state,
                assessment_id=assessment_id,
            )

        if outcome in _TERMINAL_WAITING_OUTCOMES and (
            active_question is not None
            or context_revision > 0
            or outcome != "WAITING_FOR_CUSTOMER"
        ):
            return None

        if outcome != "WAITING_FOR_CUSTOMER" or context_revision != 0:
            return None

        from uuid import UUID
        from orchestration.context import LCSPRunContext
        from subagents.interview.customer_safe_projection import (
            TurnEvidenceLedger,
            build_why_are_we_asking_explanation,
            evaluate_question_eligibility,
            extract_governed_evidence_refs,
            reset_active_turn_evidence_ledger,
            sanitize_customer_facing_text,
            set_active_turn_evidence_ledger,
            validate_evidence_refs,
        )

        if not workflow_run_id or not str(workflow_run_id).strip():
            raise ValueError(
                "Initial Interview requires a valid workflowRunId from orchestration"
            )
        valid_wf_id = str(workflow_run_id).strip()
        if correlation_id and valid_wf_id == correlation_id:
            raise ValueError(
                "workflowRunId cannot be identical to correlationId"
            )


        authenticated_actor_id = (
            str(state.get("authenticatedActorId") or "").strip()
            or str(state.get("actorId") or "").strip()
            or str(state.get("userId") or "").strip()
            or str(evidence_report.get("user_id") or "").strip()
            or str(evidence_report.get("userId") or "").strip()
            or str(evidence_report.get("ownerId") or "").strip()
            or str(evidence_report.get("owner_id") or "").strip()
        )
        if not authenticated_actor_id:
            raise ValueError("Initial Interview requires a trusted authenticated principal / user_id")

        snapshot_id = str(
            evidence_report.get("snapshotId")
            or evidence_report.get("snapshot_id")
            or ""
        )

        run_context = LCSPRunContext(
            assessment_id=assessment_id,
            user_id=authenticated_actor_id,
            workflow_run_id=valid_wf_id,
            artifact_versions={
                "technicalEvidenceReportId": evidence_report_id,
                "repositorySnapshotId": snapshot_id,
                "sourceVersion": str(
                    evidence_report.get("sourceVersion")
                    or evidence_report.get("source_version")
                    or "1.0.0"
                ),
                "pgeVersion": str(
                    evidence_report.get("pgeVersion")
                    or evidence_report.get("pge_version")
                    or "2.0.0"
                ),
                "guidanceVersion": str(
                    evidence_report.get("guidanceVersion")
                    or evidence_report.get("guidance_version")
                    or "1.0.0"
                ),
            },
            idempotency_key=f"assessment-interview-initial:{assessment_id}:{evidence_report_id}",
        )

        initial_refs = {
            f"technicalEvidenceReport:{evidence_report_id}",
            f"repositorySnapshot:{snapshot_id}",
            "interviewRuntime:assessment-interview-runtime-v1",
        }
        initial_refs.update(extract_governed_evidence_refs(evidence_report))
        ledger = TurnEvidenceLedger(
            initial_authorized_refs=initial_refs,
            initial_coverage_state=coverage_state,
            initial_coverage_limitations=coverage_notes,
        )
        handoff = (
            _ai_discovery_handoff(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                evidence_report=evidence_report,
                ai_discovery=ai_discovery,
            )
            if ai_discovery
            else None
        )
        if handoff is None:
            ledger_token = set_active_turn_evidence_ledger(ledger)
            try:
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
                    context=run_context,
                    reenter_root=False,
                )
            finally:
                reset_active_turn_evidence_ledger(ledger_token)
            handoff = result.get("handoff") if isinstance(result, dict) else None

        if not isinstance(handoff, dict):
            raise ValueError("Initial Interview specialist did not return a validated handoff")
        if handoff.get("outcome") != "WAITING_FOR_CUSTOMER" or not isinstance(
            handoff.get("activeQuestion"), dict
        ):
            raise ValueError(
                "Initial Interview must persist a Customer question before EngineeringRule work"
            )

        question = handoff["activeQuestion"]
        frontier = question.get("frontier")
        if not isinstance(frontier, dict):
            raise ValueError("Initial Interview question candidate requires frontier metadata")
        eligible, reason = evaluate_question_eligibility(frontier, ledger)
        if not eligible:
            raise ValueError(f"Initial Interview question candidate is not eligible: {reason}")

        frontier_refs = frontier.get("evidenceRefs") or []
        topic = str(frontier.get("description") or question.get("prompt") or "business clarification")
        obs = str(frontier.get("description") or "")
        question["whyAreWeAsking"] = build_why_are_we_asking_explanation(
            topic=topic,
            evidence_observation=obs,
            coverage_state=coverage_state,
            coverage_limitations=coverage_notes,
            ledger=ledger,
            evidence_refs=frontier_refs,
        )

        if "prompt" in question and question["prompt"]:
            question["prompt"] = sanitize_customer_facing_text(str(question["prompt"]))
        if "whyAreWeAsking" in question and question["whyAreWeAsking"]:
            question["whyAreWeAsking"] = sanitize_customer_facing_text(str(question["whyAreWeAsking"]))

        question_refs = (
            question.get("whyEvidenceRefs")
            or question.get("governedEvidenceRefs")
            or []
        )
        frontier_refs = frontier.get("evidenceRefs") or []
        validate_evidence_refs([*question_refs, *frontier_refs], ledger.authorized_refs)

        try:
            server_topic = _server_owned_topic(frontier, question)
            observer_from_api_client(self._api_client).observe_interview_routing(
                InterviewRoutingPacket(
                    assessment_id=assessment_id,
                    review_run_id=valid_wf_id,
                    authoritative_topic=server_topic,
                    active_question_id=str(question.get("id") or question.get("questionId") or ""),
                    active_topic_key=server_topic,
                    context_revision=0,
                    customer_safe_topic_keys=(server_topic,),
                    unresolved_topic_keys=(server_topic,),
                    resolution_criteria_keys=tuple(
                        str(item)
                        for item in (
                            frontier.get("resolutionCriteria")
                            or question.get("resolutionCriteria")
                            or ()
                        )
                        if str(item).strip()
                    ),
                )
            )
        except Exception:
            pass

        handoff["expectedContextRevision"] = 0
        handoff["technicalEvidenceReportId"] = evidence_report_id
        handoff["workflowRunId"] = valid_wf_id
        try:
            self._api_client.post_interview_initial_question(assessment_id, handoff)
        except InterviewCoverageCallbackError:
            self._route_coverage_to_recovery(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                coverage_state=coverage_state,
                coverage_notes=coverage_notes,
                correlation_id=correlation_id,
            )
        return None

    def _route_ai_discovery_to_recovery(
        self,
        *,
        assessment_id: str,
        evidence_report_id: str,
        ai_discovery: dict[str, Any],
        correlation_id: str,
    ) -> None:
        root = self._recovery_root
        if root is None:
            from agent import agent

            root = agent
        bounded = {
            "gate": ai_discovery.get("gate"),
            "coverageState": ai_discovery.get("coverage_state"),
            "technicalFindingKinds": sorted(
                {
                    str(item.get("clarification_kind") or "")
                    for item in ai_discovery.get("findings", [])
                    if isinstance(item, dict)
                    and item.get("clarification_owner") == "TECHNICAL"
                }
            )[:16],
            "materialUnresolvedFrontiers": list(
                ai_discovery.get("material_unresolved_frontiers") or []
            )[:16],
        }
        invoke_with_stream(root,
            {"messages": [{"role": "user", "content": (
                "AI discovery is technically unresolved. Do not ask the Customer to solve a "
                "scanner/static-analysis gap and do not enter EngineeringRule, Planner, or "
                "Investigator. Run targeted Scanner/PGE reanalysis for the pinned evidence, "
                "then re-enter from newly accepted technical evidence. Do not infer a provider "
                "or model from an unknown/custom endpoint. "
                f"Assessment: {assessment_id}. Evidence report: {evidence_report_id}. "
                f"Bounded AI discovery: {json.dumps(bounded, ensure_ascii=False, sort_keys=True)}"
            )}]},
            config={"configurable": {"thread_id": f"assessment:{assessment_id}:ai-discovery-recovery"},
                    "metadata": {"assessment_id": assessment_id,
                                 "technical_evidence_report_id": evidence_report_id,
                                 "correlationId": correlation_id,
                                 "trigger": "AI_DISCOVERY_REANALYSIS_REQUIRED"}},
        )

    def _route_coverage_to_recovery(
        self,
        *,
        assessment_id: str,
        evidence_report_id: str,
        coverage_state: str,
        coverage_notes: list[str],
        correlation_id: str,
    ) -> None:
        root = self._recovery_root
        if root is None:
            from agent import agent

            root = agent
        invoke_with_stream(root,
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Technical evidence coverage cannot start Initial Interview. Do not enter "
                            "Initial Interview, "
                            "EngineeringRule, Planner, or Investigator. Run Root Orchestration recovery "
                            "for the pinned technical evidence first (for example targeted re-analysis or "
                            "a governed re-scan), then re-enter the assessment only from newly accepted "
                            "technical evidence. "
                            "PARTIAL coverage requires a persisted policy with permittedForInterview=true, "
                            "policyDecisionRef, policyVersion, and non-empty limitations. Coverage notes "
                            "alone do not authorize Interview. Do not manufacture a policy approval. "
                            f"Assessment: {assessment_id}. Evidence report: {evidence_report_id}. "
                            f"Coverage state: {coverage_state}. "
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
                    "trigger": "TECHNICAL_COVERAGE_RECOVERY_REQUIRED",
                },
            },
        )


def _technical_coverage(evidence_report: dict[str, Any]) -> tuple[str, list[str]]:
    payload = evidence_report.get("evidence_payload") or evidence_report.get(
        "evidencePayload"
    )
    payload = payload if isinstance(payload, dict) else {}
    graph = next((payload[key] for key in (
        "evidence_graph", "evidenceGraph", "programEvidenceGraph", "program_evidence_graph"
    ) if payload.get(key) is not None), {})
    coverage_state = "UNAVAILABLE"
    coverage_notes: list[str] = []
    if isinstance(graph, dict):
        raw_coverage_state = str(
            graph.get("coverage_state") or graph.get("coverageState")
            or payload.get("technicalCoverageState") or payload.get("coverageState") or ""
        ).strip().upper()
        coverage_state = _CANONICAL_COVERAGE_STATES.get(
            raw_coverage_state,
            "UNAVAILABLE",
        )
        raw_notes = graph.get("coverage_notes") or graph.get("coverageNotes") or []
        if isinstance(raw_notes, list):
            coverage_notes = [item[:240] for item in raw_notes[:8] if isinstance(item, str)]
    policy = _coverage_policy(evidence_report)
    if coverage_state == "PARTIAL" and isinstance(policy, dict):
        limitations = policy.get("limitations")
        if isinstance(limitations, list):
            coverage_notes = [item.strip()[:240] for item in limitations
                              if isinstance(item, str) and item.strip()][:8]
    return coverage_state, coverage_notes


def _can_start_initial_interview(
    coverage_state: str, coverage_notes: list[str], evidence_report: dict[str, Any]
) -> bool:
    if coverage_state == "READY":
        return True
    policy = _coverage_policy(evidence_report)
    return (
        coverage_state == "PARTIAL"
        and isinstance(policy, dict)
        and policy.get("permittedForInterview") is True
        and all(isinstance(policy.get(key), str) and policy[key].strip()
                for key in ("policyDecisionRef", "policyVersion"))
        and isinstance(policy.get("limitations"), list)
        and any(isinstance(item, str) and item.strip() for item in policy["limitations"])
    )


def _coverage_policy(evidence_report: dict[str, Any]) -> Any:
    payload = evidence_report.get("evidence_payload", evidence_report.get("evidencePayload"))
    if not isinstance(payload, dict):
        return None
    graph = next((payload[key] for key in (
        "evidence_graph", "evidenceGraph", "programEvidenceGraph", "program_evidence_graph"
    ) if payload.get(key) is not None), {})
    if not isinstance(graph, dict):
        graph = {}
    for source, keys in (
        (graph, ("partialCoveragePolicyDecision", "partial_coverage_policy_decision")),
        (payload, ("partialCoveragePolicyDecision", "partial_coverage_policy_decision",
                   "coveragePolicyDecision", "coverage_policy_decision")),
    ):
        for key in keys:
            if source.get(key) is not None:
                return source[key]
    return None


def _ai_discovery(evidence_report: dict[str, Any]) -> dict[str, Any] | None:
    payload = evidence_report.get("evidence_payload", evidence_report.get("evidencePayload"))
    if not isinstance(payload, dict):
        return None
    value = payload.get("ai_discovery", payload.get("aiDiscovery"))
    if not isinstance(value, dict):
        return None
    gate = str(value.get("gate") or "")
    if gate not in {"AI_CONFIRMED", "AI_ABSENT_CONFIRMED", "AI_UNKNOWN"}:
        return None
    findings = value.get("findings")
    return {
        "schema_version": str(value.get("schema_version") or value.get("schemaVersion") or "1.0.0"),
        "gate": gate,
        "coverage_state": str(value.get("coverage_state") or value.get("coverageState") or "UNAVAILABLE"),
        "findings": [item for item in findings if isinstance(item, dict)][:64]
        if isinstance(findings, list)
        else [],
        "material_unresolved_frontiers": list(
            value.get("material_unresolved_frontiers")
            or value.get("materialUnresolvedFrontiers")
            or []
        )[:64],
    }



def _has_technical_ai_uncertainty(ai_discovery: dict[str, Any]) -> bool:
    if ai_discovery.get("material_unresolved_frontiers"):
        return True
    return any(
        isinstance(item, dict)
        and (
            item.get("clarification_owner") == "TECHNICAL"
            or str(item.get("resolution_state") or "").upper() not in {"OBSERVED", "CORROBORATED"}
            and item.get("state") in {"AI_PROVIDER_REFERENCE", "UNRESOLVED_DYNAMIC"}
        )
        for item in ai_discovery.get("findings", [])
    )


def _has_authoritative_customer_ai_context(state: dict[str, Any]) -> bool:
    confirmed = state.get("confirmedContext")
    if not isinstance(confirmed, dict):
        return False
    statements = confirmed.get("statements")
    if not isinstance(statements, list):
        return False
    negative = re.compile(
        r"(?:\b(?:no|not|without|never)\b|\b(?:does|do|we|our)\s+n['’]?t\b)"
        r"(?:\s+currently)?\s+(?:use|uses|using|usage(?:\s+of)?)?\s*"
        r"(?:external\s+|off[- ]repository\s+|generative\s+)?"
        r"(?:ai|artificial intelligence|llm|large language model|openai|anthropic|claude|gemini|genai|bedrock|copilot)",
        re.I,
    )
    positive_text = re.compile(
        r"\b(?:external|off[- ]repository|third[- ]party|hosted)\b.{0,80}\b"
        r"(?:ai|artificial intelligence|llm|large language model|openai|anthropic|"
        r"claude|gemini|genai|bedrock|copilot)\b|\b(?:ai|artificial intelligence|"
        r"llm|large language model|openai|anthropic|claude|gemini|genai|bedrock|"
        r"copilot)\b.{0,80}\b(?:external|off[- ]repository|third[- ]party|hosted)\b",
        re.I,
    )
    positive_topics = {
        "ai_usage",
        "ai_use",
        "external_ai_usage",
        "off_repository_ai_usage",
    }
    negative_values = {
        "false",
        "no",
        "none",
        "absent",
        "not_used",
        "no_ai",
        "ai_absent",
    }
    for item in statements:
        if not isinstance(item, dict):
            continue
        if str(item.get("source") or "").upper() != "CUSTOMER_CONFIRMED":
            continue
        if str(item.get("resolutionState") or "").upper() != "CONFIRMED":
            continue
        text = " ".join(
            str(item.get(key) or "")
            for key in ("topic", "statement", "normalizedValue")
        ).strip()
        topic = str(item.get("topic") or "").strip().lower()
        if negative.search(text):
            continue
        normalized = item.get("normalizedValue")
        if isinstance(normalized, bool) and not normalized:
            continue
        if isinstance(normalized, str) and normalized.strip().lower() in negative_values:
            continue
        if topic in positive_topics or positive_text.search(text):
            return True
    return False

def _select_customer_ai_finding(ai_discovery: dict[str, Any]) -> dict[str, Any] | None:
    findings = [
        item
        for item in ai_discovery.get("findings", [])
        if isinstance(item, dict) and item.get("clarification_owner") == "CUSTOMER"
    ]
    priority = {
        "AI_RUNTIME_REACHABILITY": 0,
        "OUTBOUND_AI_CONFIRMATION": 1,
        "AI_PURPOSE_FEATURE_MAPPING": 2,
    }
    findings.sort(key=lambda item: (priority.get(str(item.get("clarification_kind") or ""), 99),
                                    str(item.get("evidence_id") or "")))
    return findings[0] if findings else None


def _ai_discovery_handoff(
    *,
    assessment_id: str,
    evidence_report_id: str,
    evidence_report: dict[str, Any],
    ai_discovery: dict[str, Any],
) -> dict[str, Any] | None:
    finding = _select_customer_ai_finding(ai_discovery)
    if finding is None:
        return None
    kind = str(finding.get("clarification_kind") or "")
    snippet = finding.get("snippet_ref") if isinstance(finding.get("snippet_ref"), dict) else {}
    location = str(snippet.get("file_path") or "repository evidence")
    if snippet.get("start_line"):
        location = f"{location}:{snippet['start_line']}"
    provider = str(finding.get("provider") or "").strip()
    runtime_guard = str(finding.get("runtime_guard") or "").strip()

    if kind == "AI_RUNTIME_REACHABILITY":
        prompt = (
            f"Source evidence contains an AI model invocation guarded by {runtime_guard or 'runtime configuration'} "
            "in the assessed system. Is this AI path enabled in the assessed production environment?"
        )
        control = "SINGLE_SELECT"
        choices = [
            {"id": "YES", "label": "Yes"},
            {"id": "NO", "label": "No"},
            {"id": "UNSURE", "label": "Unsure"},
        ]
        description = f"Runtime reachability of the AI path evidenced at {location}"
    elif kind == "OUTBOUND_AI_CONFIRMATION":
        prompt = (
            f"LCSP found an outbound API call at {location} with AI-compatible request evidence, "
            "but the endpoint's role is unresolved. Does this endpoint invoke an AI/LLM service "
            "in the assessed production environment? If Yes, name the provider, service, or "
            "customer-hosted gateway when known."
        )
        control = "SINGLE_SELECT"
        choices = [
            {"id": "YES", "label": "Yes", "requiresFreeText": True},
            {"id": "NO", "label": "No"},
            {"id": "UNSURE", "label": "Unsure"},
        ]
        description = f"Operational role of the unresolved outbound endpoint at {location}"
    else:
        provider_text = f" for {provider}" if provider else ""
        prompt = (
            f"LCSP found a confirmed AI model invocation{provider_text} at {location}. "
            "For the unresolved Customer context, what is this AI call used for, which Web/Mobile/API "
            "feature or module uses it, which business workflow does it support, and is its output "
            "advisory/assistive, ranking/recommendation, content generation, or connected to a "
            "downstream action?"
        )
        control = "FREE_TEXT"
        choices = None
        description = f"Business purpose and feature/module context for confirmed AI usage at {location}"

    snapshot_id = str(
        evidence_report.get("snapshot_id")
        or evidence_report.get("snapshotId")
        or snippet.get("snapshot_id")
        or "UNKNOWN"
    )
    evidence_id = str(finding.get("evidence_id") or evidence_report_id)
    question_id = "ai-question:" + hashlib.sha256(
        f"{assessment_id}|{snapshot_id}|{evidence_id}|{kind}".encode()
    ).hexdigest()[:24]
    evidence_ref = f"technicalEvidenceReport:{evidence_report_id}"
    question: dict[str, Any] = {
        "id": question_id,
        "intent": "CLARIFY" if kind != "AI_PURPOSE_FEATURE_MAPPING" else "ASK",
        "control": control,
        "prompt": prompt,
        "whyEvidenceRefs": [evidence_ref],
        "frontier": {
            "owner": "CUSTOMER",
            "materiality": "MATERIAL",
            "description": description,
            "evidenceRefs": [evidence_ref],
        },
    }
    if choices is not None:
        question["choices"] = choices
    if snippet:
        # Persist only the governed pinned locator/hash. The API resolves source
        # transiently for display and never stores raw source in Interview/PGE state.
        question["snippetRef"] = dict(snippet)
    return {
        "mode": "INITIAL_INTERVIEW",
        "outcome": "WAITING_FOR_CUSTOMER",
        "activeQuestion": question,
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }


def _initial_interview_instruction(
    *,
    assessment_id: str,
    evidence_report_id: str,
    evidence_report: dict[str, Any],
) -> str:
    coverage_state, coverage_notes = _technical_coverage(evidence_report)
    safe_context = {
        "hostPlatform": "LCSP",
        "subjectSystemIdentity": "repositorySnapshot:"
        + str(
            evidence_report.get("snapshot_id")
            or evidence_report.get("snapshotId")
            or "UNKNOWN"
        ),
        "assessmentId": assessment_id,
        "mode": "INITIAL_INTERVIEW",
        "technicalEvidenceReportId": evidence_report_id,
        "coverageState": coverage_state,
        "coverageNotes": coverage_notes,
        "snapshotId": evidence_report.get("snapshot_id")
        or evidence_report.get("snapshotId"),
        "schemaVersion": evidence_report.get("schema_version")
        or evidence_report.get("schemaVersion"),
        "aiDiscovery": _ai_discovery(evidence_report),
    }
    return (
        "Run INITIAL_INTERVIEW before any EngineeringRule, Planner or Investigator work. "
        "Use only this bounded technical coverage/provenance and governed AI-discovery summary to decide the first Customer question. "
        "Missing technical evidence is not proof that a business behavior does not exist. "
        "Do not infer Customer confirmation from PGE/documentary evidence. "
        "Never invent a provider, model, endpoint role, or technical edge. Technical/resolvable "
        "uncertainty belongs to Scanner/PGE reanalysis rather than a Customer question. When a "
        "confirmed AI invocation is already present, do not ask whether it is AI; ask only the "
        "unresolved purpose/feature/workflow/output-role context. For an unresolved custom outbound "
        "candidate, use Yes/No/Unsure and do not name a provider unless evidence or the Customer does. "
        "Return WAITING_FOR_CUSTOMER with exactly one bounded activeQuestion.\n"
        f"Bounded initial context: {json.dumps(safe_context, ensure_ascii=False, sort_keys=True)}"
    )


def _server_owned_topic(frontier: dict[str, Any], question: dict[str, Any]) -> str:
    text = " ".join(
        str(value)
        for value in (
            frontier.get("topic"),
            frontier.get("kind"),
            frontier.get("description"),
            question.get("topic"),
            question.get("prompt"),
        )
        if value
    ).lower()
    if any(token in text for token in ("deploy", "release", "production", "runtime")):
        return "DEPLOYMENT"
    if any(token in text for token in ("purpose", "use case", "objective", "why")):
        return "PURPOSE"
    if any(token in text for token in ("human", "review", "oversight", "approval")):
        return "HUMAN_REVIEW"
    if any(token in text for token in ("source", "input", "origin", "collection")):
        return "DATA_SOURCE"
    if any(token in text for token in ("reuse", "secondary", "retention")):
        return "DATA_REUSE"
    if any(token in text for token in ("feature", "workflow", "function", "capability")):
        return "FEATURE_OR_WORKFLOW"
    return "NONE"


__all__ = ["InterviewGatedEngineeringAssessmentBoundary"]
