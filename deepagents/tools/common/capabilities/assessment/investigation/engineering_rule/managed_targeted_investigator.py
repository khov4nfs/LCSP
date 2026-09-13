"""Managed Investigator bridge for production targeted Interview continuations.

The planned pipeline remains the deterministic EngineeringRule/evaluation shell, but
production Investigator reasoning is executed through the same typed managed
Investigator definition used by Root orchestration. A NEEDS_INPUT handoff is persisted
with the exact durable child thread/checkpoint and all legal/technical artifact pins
before deterministic evaluation or the outer assessment callback can continue.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from threading import Lock
from typing import Any, Iterable

from langchain.agents.structured_output import StructuredOutputError

from contracts.handoffs import InvestigatorResult
from middleware.failure_policy import TerminalSchemaError
from middleware.specialist_handoff_validation import _persist_targeted_interview_need
from model_policy import create_lcsp_agent as create_agent
from orchestration.context import LCSPRunContext
from orchestration.result_validation import (
    SpecialistHandoffValidationError,
    validate_specialist_handoff,
)
from subagents.investigator.definition import SUBAGENT as INVESTIGATOR_SUBAGENT
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
    InvestigationPacket,
)
from tools.common.capabilities.assessment.planning.engineering_rule.engineering_rule_planner import (
    EngineeringRulePlan,
    EngineeringRulePlanDecisionAudit,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedStructuredBusinessContext,
    coerce_confirmed_structured_business_context,
)
from tools.common.capabilities.platform.graph_runtime import checkpoint_database_url
from tools.common.capabilities.platform.logging import get_logger

from .managed_investigator_execution_store import (
    MANAGED_INVESTIGATOR_EXECUTION_STATUSES,
    ManagedInvestigatorExecutionStore,
)


logger = get_logger(__name__)
MAX_MANAGED_INVESTIGATOR_REJECTED_ATTEMPTS = 2
MAX_MANAGED_INVESTIGATOR_PROMPT_CHARS = 60_000
MAX_MANAGED_INVESTIGATOR_RESULT_ROWS = 12
MAX_MANAGED_INVESTIGATOR_RESULT_REFS = 200
MAX_MANAGED_INVESTIGATOR_EDGE_ROWS = 40
MAX_MANAGED_INVESTIGATOR_NODE_ROWS = 40


class TargetedInterviewPending(BaseException):
    """Intentional stop after a targeted need is durably queued."""


class ManagedTargetedInvestigatorPipeline:
    """Swap the direct investigator for the managed specialist inside one guarded run."""

    def __init__(self, *, delegate: Any, config: Any, api_client: Any) -> None:
        self._delegate = delegate
        self._adapter = _ManagedInvestigatorAdapter(config=config, api_client=api_client)
        self._lock = Lock()

    def run(self, *args: Any, **kwargs: Any) -> Any:
        evidence_report = kwargs.get("evidence_report")
        workflow_run_id = str(kwargs.get("workflow_run_id") or "").strip()
        assessment_id = str(kwargs.get("assessment_id") or "").strip()
        user_id = str(kwargs.get("user_id") or "").strip()
        correlation_id = str(kwargs.get("correlation_id") or "").strip() or None
        if not isinstance(evidence_report, dict):
            raise RuntimeError("managed production Investigator requires evidence_report")
        if not workflow_run_id or not assessment_id or not user_id:
            raise RuntimeError(
                "managed production Investigator requires workflow, assessment and user identity"
            )

        with self._lock:
            self._adapter.begin_run(
                evidence_report=evidence_report,
                workflow_run_id=workflow_run_id,
                assessment_id=assessment_id,
                user_id=user_id,
                correlation_id=correlation_id,
            )
            previous_investigator = getattr(self._delegate, "_investigator", None)
            previous_api_client = getattr(self._delegate, "_api_client", None)
            if previous_api_client is None:
                raise RuntimeError("planned pipeline is missing its legal-rule API client")
            self._delegate._investigator = self._adapter
            self._delegate._api_client = _LegalPinningApiProxy(
                previous_api_client,
                self._adapter,
            )
            try:
                return self._delegate.run(*args, **kwargs)
            finally:
                self._delegate._investigator = previous_investigator
                self._delegate._api_client = previous_api_client

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)


class _LegalPinningApiProxy:
    """Capture the exact legal versions the planned pipeline itself consumes."""

    def __init__(self, delegate: Any, adapter: "_ManagedInvestigatorAdapter") -> None:
        self._delegate = delegate
        self._adapter = adapter

    def get_active_legal_rule_catalog(self) -> dict[str, Any]:
        value = self._delegate.get_active_legal_rule_catalog()
        if not isinstance(value, dict):
            raise RuntimeError("active legal rule catalog response is invalid")
        self._adapter.pin_legal_scope(
            catalog_version_id=_active_version_id(value, "legal rule catalog")
        )
        return value

    def get_active_legal_corpus(self) -> dict[str, Any]:
        value = self._delegate.get_active_legal_corpus()
        if not isinstance(value, dict):
            raise RuntimeError("active legal corpus response is invalid")
        self._adapter.pin_legal_scope(
            corpus_version_id=_active_version_id(value, "legal corpus")
        )
        return value

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)


class _ManagedInvestigatorAdapter:
    def __init__(self, *, config: Any, api_client: Any) -> None:
        self._config = config
        self._api_client = api_client
        self._run: dict[str, Any] = {}

    def begin_run(
        self,
        *,
        evidence_report: dict[str, Any],
        workflow_run_id: str,
        assessment_id: str,
        user_id: str,
        correlation_id: str | None,
    ) -> None:
        checkpoint_url = checkpoint_database_url(
            getattr(self._config, "langgraph_checkpoint_database_url", None)
        )
        if not checkpoint_url:
            raise RuntimeError(
                "production managed Investigator requires LANGGRAPH_CHECKPOINT_DATABASE_URL"
            )
        self._run = {
            "workflow_run_id": workflow_run_id,
            "assessment_id": assessment_id,
            "user_id": user_id,
            "correlation_id": correlation_id,
            "checkpoint_url": checkpoint_url,
            "artifact_versions": _artifact_versions(evidence_report),
        }

    def pin_legal_scope(
        self,
        *,
        catalog_version_id: str | None = None,
        corpus_version_id: str | None = None,
    ) -> None:
        if not self._run:
            raise RuntimeError("managed Investigator legal pins require an active run")
        versions = self._run["artifact_versions"]
        if catalog_version_id:
            existing = versions.get("legalRuleCatalogVersionId")
            if existing and existing != catalog_version_id:
                raise RuntimeError("legal rule catalog version drifted during planned run")
            versions["legalRuleCatalogVersionId"] = catalog_version_id
        if corpus_version_id:
            existing = versions.get("legalCorpusVersionId")
            if existing and existing != corpus_version_id:
                raise RuntimeError("legal corpus version drifted during planned run")
            versions["legalCorpusVersionId"] = corpus_version_id

    def investigate(
        self,
        *,
        packet: InvestigationPacket,
        graph: Any,
        workflow_run_id: str,
        correlation_id: str | None = None,
        code_context: Any | None = None,
    ) -> list[EvidenceClaim]:
        _ = code_context
        if not self._run:
            raise RuntimeError("managed Investigator adapter was not initialized for this run")
        if workflow_run_id != self._run["workflow_run_id"]:
            raise RuntimeError("managed Investigator workflow pin drifted")

        artifact_versions = dict(self._run["artifact_versions"])
        _require_complete_artifact_pins(artifact_versions)
        if not _packet_has_citable_refs(packet):
            logger.warning(
                "MANAGED_INVESTIGATOR_NO_CITABLE_EVIDENCE",
                execution_id=_execution_id(
                    assessment_id=self._run["assessment_id"],
                    workflow_run_id=workflow_run_id,
                    engineering_rule_id=packet.engineering_rule_id,
                    artifact_versions=artifact_versions,
                ),
                assessment_id=self._run["assessment_id"],
                engineering_rule_id=packet.engineering_rule_id,
                correlationId=correlation_id or self._run["correlation_id"],
            )
            return [_insufficient_evidence_claim(packet)]
        execution_id = _execution_id(
            assessment_id=self._run["assessment_id"],
            workflow_run_id=workflow_run_id,
            engineering_rule_id=packet.engineering_rule_id,
            artifact_versions=artifact_versions,
        )
        investigator_thread_id = f"investigator:{execution_id}"
        context = LCSPRunContext(
            assessment_id=self._run["assessment_id"],
            user_id=self._run["user_id"],
            workflow_run_id=investigator_thread_id,
            artifact_versions=artifact_versions,
            engineering_rule_ids=(packet.engineering_rule_id,),
            idempotency_key=f"investigator:{execution_id}",
        )
        handoff, checkpoint_id = _invoke_managed_investigator(
            checkpoint_url=self._run["checkpoint_url"],
            thread_id=investigator_thread_id,
            checkpoint_id=None,
            context=context,
            instruction=_initial_instruction(packet, artifact_versions),
            graph=graph,
            execution_id=execution_id,
            correlation_id=correlation_id or self._run["correlation_id"],
        )
        result = InvestigatorResult.model_validate(handoff)
        if result.status == "READY":
            return [claim.to_evidence_claim() for claim in result.claims]

        registration_context = LCSPRunContext(
            assessment_id=context.assessment_id,
            user_id=context.user_id,
            workflow_run_id=investigator_thread_id,
            checkpoint_id=checkpoint_id,
            artifact_versions=artifact_versions,
            engineering_rule_ids=context.engineering_rule_ids,
            idempotency_key=context.idempotency_key,
        )
        _persist_targeted_interview_need(
            subagent_type="investigator",
            payload=handoff,
            context=registration_context,
            metadata={"api_client": self._api_client},
            execution_id=execution_id,
        )
        raise TargetedInterviewPending(
            "managed Investigator registered a targeted Interview continuation"
        )


class ResumedManagedInvestigatorPipeline:
    """Re-enter only the deterministic gate around an exact resumed Investigator output."""

    def __init__(
        self,
        *,
        api_client: Any,
        affected_rule_ids: tuple[str, ...],
        resumed_handoff: dict[str, Any],
        confirmed_context: ConfirmedStructuredBusinessContext | dict[str, Any],
    ) -> None:
        from .planned_pipeline import PlannedEngineeringInvestigationPipeline

        self._confirmed_context = coerce_confirmed_structured_business_context(
            confirmed_context
        )
        self._delegate = PlannedEngineeringInvestigationPipeline(
            api_client=api_client,
            planner=_ExactResumePlanner(affected_rule_ids),
            investigator=_ResumedHandoffInvestigator(
                affected_rule_ids=affected_rule_ids,
                handoff=resumed_handoff,
            ),
        )

    def run(self, *args: Any, **kwargs: Any) -> Any:
        kwargs["confirmed_customer_context"] = self._confirmed_context
        return self._delegate.run(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)


class _ExactResumePlanner:
    """Deterministically reconstruct the already-pinned targeted rule scope."""

    def __init__(self, affected_rule_ids: tuple[str, ...]) -> None:
        self._affected_rule_ids = affected_rule_ids

    def plan(
        self,
        *,
        candidates: Iterable[Any],
        confirmed_customer_context: ConfirmedStructuredBusinessContext,
        graph: Any,
        workflow_run_id: str,
        correlation_id: str | None = None,
        openwiki_context: dict[str, Any] | None = None,
    ) -> EngineeringRulePlan:
        _ = (
            graph,
            workflow_run_id,
            correlation_id,
            openwiki_context,
        )
        rows = tuple(candidates)
        available = {str(item.engineering_rule_id) for item in rows}
        missing = sorted(set(self._affected_rule_ids) - available)
        if missing:
            raise RuntimeError(
                f"exact Investigator resume rule scope is no longer available: {missing}"
            )
        selected = tuple(
            item.engineering_rule_id
            for item in rows
            if item.engineering_rule_id in self._affected_rule_ids
        )
        skipped = tuple(
            item.engineering_rule_id
            for item in rows
            if item.engineering_rule_id not in self._affected_rule_ids
        )
        return EngineeringRulePlan(
            selected_rule_ids=selected,
            skipped_rule_ids=skipped,
            fallback_used=False,
            decision_audit=tuple(
                EngineeringRulePlanDecisionAudit(
                    engineering_rule_id=item.engineering_rule_id,
                    requested_decision="EXACT_RESUME_PIN",
                    final_decision=(
                        "SELECT"
                        if item.engineering_rule_id in self._affected_rule_ids
                        else "SKIP"
                    ),
                    reason_code="TARGETED_EXACT_RESUME_PIN",
                    basis=(),
                    interview_context_revision_used=(
                        confirmed_customer_context.context_revision
                    ),
                    confirmed_statement_refs_used=(
                        confirmed_customer_context.confirmed_statement_refs
                    ),
                    context_limitations_used=confirmed_customer_context.limitations,
                    source_version_ref=confirmed_customer_context.source_version_ref,
                    pge_version=confirmed_customer_context.pge_version,
                    guidance_version=confirmed_customer_context.guidance_version,
                )
                for item in rows
            ),
        )


class _ResumedHandoffInvestigator:
    """Expose only the typed claims produced by the exact resumed child execution."""

    def __init__(
        self,
        *,
        affected_rule_ids: tuple[str, ...],
        handoff: dict[str, Any],
    ) -> None:
        self._affected_rule_ids = set(affected_rule_ids)
        self._result = InvestigatorResult.model_validate(handoff)
        if self._result.status != "READY":
            raise ValueError("resumed Investigator handoff must be READY before gate continuation")

    def investigate(
        self,
        *,
        packet: InvestigationPacket,
        graph: Any,
        workflow_run_id: str,
        correlation_id: str | None = None,
    ) -> list[EvidenceClaim]:
        _ = (graph, workflow_run_id, correlation_id)
        if packet.engineering_rule_id not in self._affected_rule_ids:
            raise RuntimeError("deterministic exact-resume pipeline escaped affectedRuleIds")
        claims = [
            claim.to_evidence_claim()
            for claim in self._result.claims
            if claim.engineering_rule_id == packet.engineering_rule_id
        ]
        if not claims:
            raise RuntimeError("exact resumed Investigator returned no claim for pinned rule")
        return claims


def assert_managed_investigator_artifact_pins(
    api_client: Any,
    continuation: dict[str, Any],
) -> None:
    """Fail closed if exact/rescope continuation would mix new legal artifacts."""
    artifact_versions = _artifact_version_map(continuation)
    _require_complete_artifact_pins(artifact_versions)
    catalog = api_client.get_active_legal_rule_catalog()
    corpus = api_client.get_active_legal_corpus()
    if not isinstance(catalog, dict) or not isinstance(corpus, dict):
        raise RuntimeError("active legal artifact responses are invalid")
    active_catalog = _active_version_id(catalog, "legal rule catalog")
    active_corpus = _active_version_id(corpus, "legal corpus")
    if active_catalog != artifact_versions["legalRuleCatalogVersionId"]:
        raise RuntimeError("exact continuation legal rule catalog pin is stale")
    if active_corpus != artifact_versions["legalCorpusVersionId"]:
        raise RuntimeError("exact continuation legal corpus pin is stale")


def reconstruct_managed_investigator_continuation(
    *,
    config: Any,
    assessment_id: str,
    targeted_need: dict[str, Any],
    source_version: str,
    pge_version: str,
) -> dict[str, Any]:
    """Recover opaque continuation pins from the durable execution registry."""
    checkpoint_url = checkpoint_database_url(
        getattr(config, "langgraph_checkpoint_database_url", None)
    )
    if not checkpoint_url:
        raise RuntimeError(
            "continuation reconstruction requires LANGGRAPH_CHECKPOINT_DATABASE_URL"
        )
    origin = _required_text(targeted_need, "originatingInvestigationReference")
    need_id = _required_text(targeted_need, "needId")
    execution_id = _execution_id_from_origin(origin, need_id)
    registry = ManagedInvestigatorExecutionStore(checkpoint_url)
    record = registry.get(execution_id)
    if record is None:
        raise RuntimeError("managed Investigator execution registry entry is missing")
    expected_thread = f"investigator:{execution_id}"
    if record.assessment_id != assessment_id:
        raise RuntimeError("durable Investigator execution assessment identity drifted")
    if record.thread_id != expected_thread:
        raise RuntimeError("durable Investigator execution thread identity drifted")
    _require_complete_artifact_pins(record.artifact_versions)
    if not record.affected_rule_ids:
        raise RuntimeError("durable Investigator execution is missing affected rule pins")
    return {
        "originatingInvestigationReference": origin,
        "investigatorExecutionId": execution_id,
        "workflowRunId": record.thread_id,
        "checkpointId": record.checkpoint_id,
        "affectedRuleIds": list(record.affected_rule_ids),
        "artifactVersions": dict(record.artifact_versions),
        "sourceVersion": source_version,
        "pgeVersion": pge_version,
    }


def resume_managed_investigator(
    *,
    config: Any,
    api_client: Any,
    assessment_id: str,
    context_revision: int,
    continuation: dict[str, Any],
    confirmed_context: ConfirmedStructuredBusinessContext | dict[str, Any],
    correlation_id: str | None,
) -> dict[str, Any]:
    """Resume exactly the child Investigator thread/checkpoint stored by registration."""
    checkpoint_url = checkpoint_database_url(
        getattr(config, "langgraph_checkpoint_database_url", None)
    )
    if not checkpoint_url:
        raise RuntimeError(
            "exact Investigator resume requires LANGGRAPH_CHECKPOINT_DATABASE_URL"
        )
    assert_managed_investigator_artifact_pins(api_client, continuation)
    typed_confirmed_context = coerce_confirmed_structured_business_context(
        confirmed_context
    )
    thread_id = _required_text(continuation, "workflowRunId")
    checkpoint_id = _required_text(continuation, "checkpointId")
    execution_id = _required_text(continuation, "investigatorExecutionId")
    affected_rule_ids = _affected_rule_ids(continuation)
    artifact_versions = _artifact_version_map(continuation)
    _assert_execution_registry_matches_continuation(
        checkpoint_url=checkpoint_url,
        execution_id=execution_id,
        assessment_id=assessment_id,
        thread_id=thread_id,
        checkpoint_id=checkpoint_id,
        affected_rule_ids=affected_rule_ids,
        artifact_versions=artifact_versions,
        # A broker retry can carry the original guarded checkpoint after this exact
        # execution already advanced to READY. Preserve every identity/artifact pin,
        # but allow the invocation layer to recover the durable READY child state.
        allow_ready_advanced=True,
    )

    report_id = str(artifact_versions.get("technicalEvidenceReportId") or "").strip()
    if not report_id:
        raise ValueError("exact Investigator resume requires technicalEvidenceReportId pin")
    evidence_report = api_client.get_accepted_technical_evidence_report(report_id)
    original_user_id = _report_user_id(evidence_report)
    graph = _evidence_graph(evidence_report)
    context = LCSPRunContext(
        assessment_id=assessment_id,
        user_id=original_user_id,
        workflow_run_id=continuation.get("rootWorkflowRunId") or thread_id,
        correlation_id=correlation_id,
        checkpoint_id=checkpoint_id,
        artifact_versions=dict(artifact_versions),
        engineering_rule_ids=affected_rule_ids,
        idempotency_key=f"resume:{execution_id}:{context_revision}",
    )
    handoff, resumed_checkpoint_id = _invoke_managed_investigator(
        checkpoint_url=checkpoint_url,
        thread_id=thread_id,
        checkpoint_id=checkpoint_id,
        context=context,
        instruction=(
            "The targeted Customer clarification passed the protected Interview guard. "
            "Continue this same Investigator execution from its stored checkpoint and fixed "
            "EngineeringRule/artifact scope. Do not restart Planner or Initial Interview. "
            "Use only the following Customer-confirmed business context as the new bounded input:\n"
            + json.dumps(
                typed_confirmed_context.to_prompt_dict(),
                ensure_ascii=False,
                sort_keys=True,
            )
        ),
        graph=graph,
        execution_id=execution_id,
        correlation_id=correlation_id,
        confirmed_statement_refs=typed_confirmed_context.confirmed_statement_refs,
    )
    if resumed_checkpoint_id == checkpoint_id and not _is_failed_investigator_handoff(
        handoff
    ):
        raise RuntimeError("exact Investigator resume did not advance its child checkpoint")
    result = InvestigatorResult.model_validate(handoff)
    return {
        "executionId": execution_id,
        "threadId": thread_id,
        "fromCheckpointId": checkpoint_id,
        "checkpointId": resumed_checkpoint_id,
        "handoff": result.model_dump(mode="json"),
    }


def complete_resumed_investigation(
    *,
    config: Any,
    api_client: Any,
    assessment_id: str,
    context_revision: int,
    continuation: dict[str, Any],
    confirmed_context: ConfirmedStructuredBusinessContext | dict[str, Any],
    resumed_handoff: dict[str, Any],
    correlation_id: str,
) -> None:
    """Run deterministic evaluation/callback without another Planner/Investigator model."""
    from .engineering_assessment_boundary import EngineeringAssessmentBoundary

    assert_managed_investigator_artifact_pins(api_client, continuation)
    artifact_versions = _artifact_version_map(continuation)
    affected_rule_ids = _affected_rule_ids(continuation)
    report_id = str(artifact_versions.get("technicalEvidenceReportId") or "").strip()
    if not report_id:
        raise ValueError("exact resume gate continuation requires technicalEvidenceReportId")
    pipeline = ResumedManagedInvestigatorPipeline(
        api_client=api_client,
        affected_rule_ids=affected_rule_ids,
        resumed_handoff=resumed_handoff,
        confirmed_context=confirmed_context,
    )
    EngineeringAssessmentBoundary(
        config,
        api_client=api_client,
        investigation_pipeline=pipeline,
    ).handle(
        {
            "assessmentId": assessment_id,
            "evidenceReportId": report_id,
            "workflowRunId": (
                f"{_required_text(continuation, 'workflowRunId')}:gate:{context_revision}"
            ),
        },
        correlation_id,
    )


def _invoke_managed_investigator(
    *,
    checkpoint_url: str,
    thread_id: str,
    checkpoint_id: str | None,
    context: LCSPRunContext,
    instruction: str,
    graph: Any,
    execution_id: str,
    correlation_id: str | None,
    confirmed_statement_refs: tuple[str, ...] = (),
) -> tuple[dict[str, Any], str]:
    from langgraph.checkpoint.postgres import PostgresSaver

    registry = ManagedInvestigatorExecutionStore(checkpoint_url)
    if checkpoint_id:
        _assert_execution_registry_matches_continuation(
            checkpoint_url=checkpoint_url,
            execution_id=execution_id,
            assessment_id=context.assessment_id,
            thread_id=thread_id,
            checkpoint_id=checkpoint_id,
            affected_rule_ids=context.engineering_rule_ids,
            artifact_versions=dict(context.artifact_versions),
            allow_ready_advanced=True,
        )

    with PostgresSaver.from_conn_string(checkpoint_url) as checkpointer:
        checkpointer.setup()
        agent = _durable_investigator_agent(checkpointer)

        # If a prior attempt already advanced this exact child checkpoint and persisted a
        # READY structured response, reuse that durable result instead of invoking the
        # model again. This closes the crash-after-resume/before-ACK duplicate window.
        if checkpoint_id:
            latest = agent.get_state({"configurable": {"thread_id": thread_id}})
            latest_checkpoint = _snapshot_checkpoint_id(latest, required=False)
            if latest_checkpoint and latest_checkpoint != checkpoint_id:
                structured = _snapshot_structured_response(latest)
                if structured is not None:
                    try:
                        validated = validate_specialist_handoff(
                            "investigator",
                            structured,
                            graph=graph,
                            pinned_rule_ids=context.engineering_rule_ids,
                            pinned_versions=dict(context.artifact_versions),
                            confirmed_statement_refs=confirmed_statement_refs,
                        )
                    except SpecialistHandoffValidationError as error:
                        record = registry.get(execution_id)
                        rejected_attempts = (record.attempt_count if record else 0) + 1
                        error_message = str(error)[:2_000]
                        logger.warning(
                            "MANAGED_INVESTIGATOR_STORED_HANDOFF_REJECTED",
                            execution_id=execution_id,
                            assessment_id=context.assessment_id,
                            thread_id=thread_id,
                            original_checkpoint_id=checkpoint_id,
                            rejected_checkpoint_id=latest_checkpoint,
                            rejected_attempts=rejected_attempts,
                            error_type=type(error).__name__,
                            error_message=error_message,
                            correlationId=correlation_id,
                        )
                        if (
                            rejected_attempts
                            >= MAX_MANAGED_INVESTIGATOR_REJECTED_ATTEMPTS
                        ):
                            registry.save(
                                execution_id=execution_id,
                                assessment_id=context.assessment_id,
                                thread_id=thread_id,
                                checkpoint_id=checkpoint_id,
                                affected_rule_ids=context.engineering_rule_ids,
                                artifact_versions=dict(context.artifact_versions),
                                status=MANAGED_INVESTIGATOR_EXECUTION_STATUSES["failed"],
                                attempt_count=rejected_attempts,
                                last_error=error_message,
                            )
                            return (
                                _failed_investigator_handoff(
                                    context=context,
                                    last_error=error_message,
                                ),
                                checkpoint_id,
                            )
                        registry.save(
                            execution_id=execution_id,
                            assessment_id=context.assessment_id,
                            thread_id=thread_id,
                            checkpoint_id=checkpoint_id,
                            affected_rule_ids=context.engineering_rule_ids,
                            artifact_versions=dict(context.artifact_versions),
                            status=MANAGED_INVESTIGATOR_EXECUTION_STATUSES["rejected"],
                            attempt_count=rejected_attempts,
                            last_error=error_message,
                        )
                        instruction = _recovery_instruction(
                            instruction=instruction,
                            validation_error=error_message,
                        )
                    else:
                        recovered = InvestigatorResult.model_validate(validated)
                        if recovered.status == "READY":
                            registry.save(
                                execution_id=execution_id,
                                assessment_id=context.assessment_id,
                                thread_id=thread_id,
                                checkpoint_id=latest_checkpoint,
                                affected_rule_ids=context.engineering_rule_ids,
                                artifact_versions=dict(context.artifact_versions),
                                status=MANAGED_INVESTIGATOR_EXECUTION_STATUSES["ready"],
                                attempt_count=0,
                                last_error=None,
                            )
                            return recovered.model_dump(mode="json"), latest_checkpoint

        configurable: dict[str, str] = {"thread_id": thread_id}
        if checkpoint_id:
            configurable["checkpoint_id"] = checkpoint_id
        current_instruction = instruction
        for _attempt in range(MAX_MANAGED_INVESTIGATOR_REJECTED_ATTEMPTS):
            response_shape: dict[str, Any] | None = None
            candidate_handoff: Any | None = None
            try:
                invocation = agent.invoke(
                    {"messages": [{"role": "user", "content": current_instruction}]},
                    config={
                        "configurable": configurable,
                        "metadata": {
                            "lcsp_thread_id": thread_id,
                            "assessment_id": context.assessment_id,
                            "user_id": context.user_id,
                            "investigator_execution_id": execution_id,
                            "artifact_versions": dict(context.artifact_versions),
                            "affected_rule_ids": list(context.engineering_rule_ids),
                            "correlationId": correlation_id,
                        },
                    },
                    context=context,
                )
                if not isinstance(invocation, dict) or "structured_response" not in invocation:
                    raise SpecialistHandoffValidationError(
                        "managed Investigator did not return structured_response"
                    )
                candidate_handoff = invocation["structured_response"]
                response_shape = _structured_handoff_shape(candidate_handoff)
                validated = validate_specialist_handoff(
                    "investigator",
                    candidate_handoff,
                    graph=graph,
                    pinned_rule_ids=context.engineering_rule_ids,
                    pinned_versions=dict(context.artifact_versions),
                    confirmed_statement_refs=confirmed_statement_refs,
                )
            except (
                SpecialistHandoffValidationError,
                StructuredOutputError,
                TerminalSchemaError,
            ) as error:
                record = registry.get(execution_id)
                rejected_attempts = (record.attempt_count if record else 0) + 1
                error_message = _managed_validation_error_message(error)
                checkpoint_text = _safe_current_checkpoint_id(
                    agent=agent,
                    thread_id=thread_id,
                    fallback=checkpoint_id,
                )
                logger.warning(
                    "MANAGED_INVESTIGATOR_HANDOFF_REJECTED",
                    execution_id=execution_id,
                    assessment_id=context.assessment_id,
                    thread_id=thread_id,
                    checkpoint_id=checkpoint_text,
                    rejected_attempts=rejected_attempts,
                    error_type=type(error).__name__,
                    error_message=error_message,
                    error_metadata=_structured_error_metadata(error),
                    response_shape=response_shape,
                    prompt_chars=len(current_instruction),
                    correlationId=correlation_id,
                )
                if (
                    rejected_attempts
                    >= MAX_MANAGED_INVESTIGATOR_REJECTED_ATTEMPTS
                ):
                    recovered = _try_fail_closed_recovery(
                        candidate_handoff,
                        graph=graph,
                        context=context,
                        confirmed_statement_refs=confirmed_statement_refs,
                    )
                    if recovered is not None:
                        registry.save(
                            execution_id=execution_id,
                            assessment_id=context.assessment_id,
                            thread_id=thread_id,
                            checkpoint_id=checkpoint_text,
                            affected_rule_ids=context.engineering_rule_ids,
                            artifact_versions=dict(context.artifact_versions),
                            status=MANAGED_INVESTIGATOR_EXECUTION_STATUSES["ready"],
                            attempt_count=rejected_attempts,
                            last_error=error_message,
                        )
                        logger.warning(
                            "MANAGED_INVESTIGATOR_FAIL_CLOSED_RECOVERY_ACCEPTED",
                            execution_id=execution_id,
                            assessment_id=context.assessment_id,
                            thread_id=thread_id,
                            checkpoint_id=checkpoint_text,
                            rejected_attempts=rejected_attempts,
                            error_type=type(error).__name__,
                            response_shape=response_shape,
                            correlationId=correlation_id,
                        )
                        return recovered.model_dump(mode="json"), checkpoint_text
                    registry.save(
                        execution_id=execution_id,
                        assessment_id=context.assessment_id,
                        thread_id=thread_id,
                        checkpoint_id=checkpoint_text,
                        affected_rule_ids=context.engineering_rule_ids,
                        artifact_versions=dict(context.artifact_versions),
                        status=MANAGED_INVESTIGATOR_EXECUTION_STATUSES["failed"],
                        attempt_count=rejected_attempts,
                        last_error=error_message,
                    )
                    return (
                        _failed_investigator_handoff(
                            context=context,
                            last_error=error_message,
                        ),
                        checkpoint_text,
                    )
                registry.save(
                    execution_id=execution_id,
                    assessment_id=context.assessment_id,
                    thread_id=thread_id,
                    checkpoint_id=checkpoint_text,
                    affected_rule_ids=context.engineering_rule_ids,
                    artifact_versions=dict(context.artifact_versions),
                    status=MANAGED_INVESTIGATOR_EXECUTION_STATUSES["rejected"],
                    attempt_count=rejected_attempts,
                    last_error=error_message,
                )
                current_instruction = _recovery_instruction(
                    instruction=instruction,
                    validation_error=error_message,
                )
                continue

            result = InvestigatorResult.model_validate(validated)
            snapshot = agent.get_state({"configurable": {"thread_id": thread_id}})
            checkpoint_text = _snapshot_checkpoint_id(snapshot)
            registry.save(
                execution_id=execution_id,
                assessment_id=context.assessment_id,
                thread_id=thread_id,
                checkpoint_id=checkpoint_text,
                affected_rule_ids=context.engineering_rule_ids,
                artifact_versions=dict(context.artifact_versions),
                status=(
                    MANAGED_INVESTIGATOR_EXECUTION_STATUSES["ready"]
                    if result.status == "READY"
                    else MANAGED_INVESTIGATOR_EXECUTION_STATUSES["waiting"]
                ),
                attempt_count=0,
                last_error=None,
            )
            return result.model_dump(mode="json"), checkpoint_text

        raise RuntimeError("managed Investigator retry loop exited unexpectedly")


def _assert_execution_registry_matches_continuation(
    *,
    checkpoint_url: str,
    execution_id: str,
    assessment_id: str,
    thread_id: str,
    checkpoint_id: str,
    affected_rule_ids: tuple[str, ...],
    artifact_versions: dict[str, str],
    allow_ready_advanced: bool = False,
) -> None:
    record = ManagedInvestigatorExecutionStore(checkpoint_url).get(execution_id)
    if record is None:
        raise RuntimeError("managed Investigator execution registry entry is missing")
    if record.assessment_id != assessment_id:
        raise RuntimeError("managed Investigator execution assessment identity drifted")
    if record.thread_id != thread_id:
        raise RuntimeError("managed Investigator execution thread identity drifted")
    if record.affected_rule_ids != tuple(affected_rule_ids):
        raise RuntimeError("managed Investigator execution affected rule pins drifted")
    if record.artifact_versions != artifact_versions:
        raise RuntimeError("managed Investigator execution artifact pins drifted")
    if record.checkpoint_id != checkpoint_id:
        if not (
            allow_ready_advanced
            and record.status == MANAGED_INVESTIGATOR_EXECUTION_STATUSES["ready"]
        ):
            raise RuntimeError("managed Investigator execution checkpoint identity drifted")


def _try_fail_closed_recovery(
    candidate_handoff: Any | None,
    *,
    graph: Any,
    context: LCSPRunContext,
    confirmed_statement_refs: tuple[str, ...],
) -> InvestigatorResult | None:
    if candidate_handoff is None:
        return None
    try:
        validated = validate_specialist_handoff(
            "investigator",
            candidate_handoff,
            graph=graph,
            pinned_rule_ids=context.engineering_rule_ids,
            pinned_versions=dict(context.artifact_versions),
            confirmed_statement_refs=confirmed_statement_refs,
            allow_fail_closed_recovery=True,
        )
    except SpecialistHandoffValidationError:
        return None
    return InvestigatorResult.model_validate(validated)


def _recovery_instruction(*, instruction: str, validation_error: str) -> str:
    return (
        instruction
        + "\n\nPrevious structured Investigator response was rejected before deterministic "
        "gate completion. Retry from the original checkpoint and correct this validation "
        "error explicitly. Return only compact valid JSON for the InvestigatorResult schema; "
        "do not copy raw tool output, graph rows, prompts, or long explanations into any field: "
        + validation_error
    )


def _managed_validation_error_message(error: BaseException) -> str:
    text = str(error).strip()
    if len(text) > 2_000:
        text = text[:2_000].rstrip() + "..."
    return text or type(error).__name__


def _structured_handoff_shape(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    if not isinstance(value, dict):
        return {"type": type(value).__name__}
    claims = value.get("claims")
    claim_shapes: list[dict[str, Any]] = []
    if isinstance(claims, list):
        for item in claims[:5]:
            if isinstance(item, dict):
                claim_shapes.append(
                    {
                        "claim_type": item.get("claim_type"),
                        "value_type": type(item.get("value")).__name__,
                        "keys": sorted(str(key) for key in item.keys())[:20],
                    }
                )
            else:
                claim_shapes.append({"type": type(item).__name__})
    return {
        "keys": sorted(str(key) for key in value.keys())[:30],
        "status": value.get("status"),
        "next_step": value.get("next_step"),
        "claim_count": len(claims) if isinstance(claims, list) else None,
        "claim_shapes": claim_shapes,
    }


def _structured_error_metadata(error: BaseException) -> dict[str, Any]:
    metadata: dict[str, Any] = {"exception_type": type(error).__name__}
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if current is not error:
            metadata.setdefault("cause_type", type(current).__name__)
        for attr in ("finish_reason", "usage_metadata", "response_metadata"):
            value = getattr(current, attr, None)
            if value is not None and attr not in metadata:
                metadata[attr] = _safe_metadata_value(value)
        current = current.__cause__ or current.__context__
    return metadata


def _safe_metadata_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        safe: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if any(marker in key_text.lower() for marker in ("content", "text", "message")):
                continue
            if isinstance(item, (str, int, float, bool)) or item is None:
                safe[key_text] = item
        return safe
    return type(value).__name__


def _safe_current_checkpoint_id(
    *,
    agent: Any,
    thread_id: str,
    fallback: str | None,
) -> str:
    try:
        snapshot = agent.get_state({"configurable": {"thread_id": thread_id}})
        checkpoint = _snapshot_checkpoint_id(snapshot, required=False)
    except Exception:
        checkpoint = ""
    return checkpoint or str(fallback or "")


def _failed_investigator_handoff(
    *,
    context: LCSPRunContext,
    last_error: str,
) -> dict[str, Any]:
    rule_id = context.engineering_rule_ids[0]
    return {
        "status": MANAGED_INVESTIGATOR_EXECUTION_STATUSES["ready"],
        "artifact_versions": dict(context.artifact_versions),
        "claims": [
            {
                "claim_id": f"claim:failed:{rule_id}",
                "engineering_rule_id": rule_id,
                "claim_type": ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                "value": None,
                "evidence_refs": [],
                "graph_path_refs": [],
                "source_anchor_refs": [],
                "confidence": 0.0,
                "limitations": [
                    ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"]
                ],
                "criterion": last_error[:500] or None,
            }
        ],
        "limitations": [
            ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"]
        ],
        "missing_input": None,
        "business_context_need": None,
        "next_step": "GATE",
    }


def _is_failed_investigator_handoff(handoff: dict[str, Any]) -> bool:
    limitations = handoff.get("limitations")
    return (
        isinstance(limitations, list)
        and ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"]
        in limitations
    )


def _durable_investigator_agent(checkpointer: Any):
    definition = INVESTIGATOR_SUBAGENT
    return create_agent(
        agent_name="lcsp-investigator-durable-execution",
        model=definition["model"],
        tools=definition["tools"],
        system_prompt=definition["system_prompt"],
        middleware=definition["middleware"],
        response_format=definition["response_format"],
        checkpointer=checkpointer,
    )


def _initial_instruction(
    packet: InvestigationPacket,
    artifact_versions: dict[str, str],
) -> str:
    bounded_packet = _bounded_investigation_packet(packet)
    instruction = (
        "Execute this already-selected EngineeringRule investigation. Preserve the fixed artifact "
        "pins exactly. If a material Customer-owned business fact is required, return one bounded "
        "NEEDS_INPUT/business_context_need; otherwise return READY claims. The packet below is a "
        "bounded index, not raw evidence. Use the Investigator tools to inspect any cited graph "
        "node/edge/source ref before closing a claim. Return only compact valid JSON matching the "
        "InvestigatorResult schema; do not echo raw packet/tool JSON or long graph rows in any "
        "string field. For RULE_REQUIREMENT_MET and RULE_REQUIREMENT_NOT_MET, omit "
        "customer_context_refs entirely. Include customer_context_refs only on "
        "RULE_SCOPE_NOT_APPLICABLE claims. If the packet contains no citable "
        "evidence_refs, graph_path_refs, or source_anchor_refs for a decided claim, do not "
        "guess a MET/NOT_MET value; return UNRESOLVED_ENGINEERING_FACT with "
        "ENGINEERING_EVIDENCE_INSUFFICIENT instead.\n"
        + json.dumps(
            {
                "artifactVersions": artifact_versions,
                "investigationPacket": bounded_packet,
            },
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        )
    )
    if len(instruction) > MAX_MANAGED_INVESTIGATOR_PROMPT_CHARS:
        raise RuntimeError("managed Investigator bounded instruction exceeded prompt budget")
    return instruction


def _packet_has_citable_refs(packet: InvestigationPacket) -> bool:
    return bool(_packet_citable_refs(packet))


def _packet_citable_refs(packet: InvestigationPacket) -> tuple[str, ...]:
    refs: list[str] = []
    refs.extend(str(item).strip() for item in packet.evidence_refs if str(item).strip())
    for item in packet.initial_results:
        refs.extend(_nested_citable_refs(item))
    return tuple(dict.fromkeys(refs))


_CITABLE_REF_KEYS = frozenset(
    {
        "evidenceRefs",
        "evidence_refs",
        "governed_evidence_refs",
        "graphPathRefs",
        "graph_path_refs",
        "materialSourceRefs",
        "sourceAnchorRefs",
        "source_anchor_refs",
    }
)


def _nested_citable_refs(value: Any) -> tuple[str, ...]:
    refs: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in _CITABLE_REF_KEYS and isinstance(child, (list, tuple)):
                refs.extend(str(item).strip() for item in child if str(item).strip())
                continue
            refs.extend(_nested_citable_refs(child))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_nested_citable_refs(item))
    return tuple(refs)


def _insufficient_evidence_claim(packet: InvestigationPacket) -> EvidenceClaim:
    digest = hashlib.sha256(packet.engineering_rule_id.encode("utf-8")).hexdigest()[:16]
    return EvidenceClaim(
        claim_id=f"claim:insufficient:{digest}",
        engineering_rule_id=packet.engineering_rule_id,
        claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
        value=None,
        evidence_refs=(),
        graph_path_refs=(),
        source_anchor_refs=(),
        confidence=0.0,
        limitations=(
            ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],
        ),
        criterion=(
            "Selected EngineeringRule could not be decided because the investigation "
            "packet contained no citable evidence refs."
        ),
    )


def _bounded_investigation_packet(packet: InvestigationPacket) -> dict[str, Any]:
    raw = asdict(packet)
    raw.pop("customer_context", None)
    initial_results = [
        _compact_initial_result(item)
        for item in raw.get("initial_results", ())[:MAX_MANAGED_INVESTIGATOR_RESULT_ROWS]
        if isinstance(item, dict)
    ]
    omitted = max(0, len(raw.get("initial_results", ())) - len(initial_results))
    raw["initial_results"] = initial_results
    raw["initialResultSummary"] = {
        "total": len(packet.initial_results),
        "included": len(initial_results),
        "omitted": omitted,
        "evidenceRefCount": len(packet.evidence_refs),
        "unresolvedFrontierCount": len(packet.unresolved_frontiers),
    }
    raw["evidence_refs"] = list(packet.evidence_refs)[
        :MAX_MANAGED_INVESTIGATOR_RESULT_REFS
    ]
    raw["unresolved_frontiers"] = list(packet.unresolved_frontiers)[
        :MAX_MANAGED_INVESTIGATOR_RESULT_REFS
    ]
    return raw


def _compact_initial_result(item: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {
        key: item.get(key)
        for key in (
            "query",
            "phase",
            "startRef",
            "truncated",
            "matchMode",
        )
        if key in item
    }
    nodes = item.get("nodes")
    edges = item.get("edges")
    paths = item.get("paths")
    if isinstance(nodes, list):
        compact["nodes"] = [
            _compact_graph_node(node)
            for node in nodes[:MAX_MANAGED_INVESTIGATOR_NODE_ROWS]
            if isinstance(node, dict)
        ]
        compact["nodeCount"] = len(nodes)
    if isinstance(edges, list):
        compact["edges"] = [
            _compact_graph_edge(edge)
            for edge in edges[:MAX_MANAGED_INVESTIGATOR_EDGE_ROWS]
            if isinstance(edge, dict)
        ]
        compact["edgeCount"] = len(edges)
    if isinstance(paths, list):
        compact["paths"] = paths[:MAX_MANAGED_INVESTIGATOR_RESULT_ROWS]
        compact["pathCount"] = len(paths)
    for key in ("evidenceRefs", "unresolvedFrontiers", "continuationFrontiers"):
        value = item.get(key)
        if isinstance(value, list):
            compact[key] = value[:MAX_MANAGED_INVESTIGATOR_RESULT_REFS]
            compact[f"{key}Count"] = len(value)
    return compact


def _compact_graph_node(node: dict[str, Any]) -> dict[str, Any]:
    return {
        key: node.get(key)
        for key in (
            "node_id",
            "node_type",
            "label",
            "resolution_state",
            "evidence_refs",
        )
        if key in node
    }


def _compact_graph_edge(edge: dict[str, Any]) -> dict[str, Any]:
    return {
        key: edge.get(key)
        for key in (
            "edge_id",
            "edge_type",
            "source_node_id",
            "target_node_id",
            "evidence_refs",
        )
        if key in edge
    }


def _artifact_versions(evidence_report: dict[str, Any]) -> dict[str, str]:
    report_id = str(
        evidence_report.get("id")
        or evidence_report.get("technical_evidence_report_id")
        or evidence_report.get("technicalEvidenceReportId")
        or ""
    ).strip()
    snapshot_id = str(
        evidence_report.get("snapshot_id")
        or evidence_report.get("snapshotId")
        or ""
    ).strip()
    if not report_id or not snapshot_id:
        raise RuntimeError(
            "managed Investigator requires technical evidence report and repository snapshot pins"
        )
    return {
        "technicalEvidenceReportId": report_id,
        "repositorySnapshotId": snapshot_id,
    }


def _require_complete_artifact_pins(artifact_versions: dict[str, str]) -> None:
    required = (
        "technicalEvidenceReportId",
        "repositorySnapshotId",
        "legalRuleCatalogVersionId",
        "legalCorpusVersionId",
    )
    missing = [key for key in required if not str(artifact_versions.get(key) or "").strip()]
    if missing:
        raise RuntimeError(
            f"managed Investigator immutable artifact pins are incomplete: {missing}"
        )


def _artifact_version_map(continuation: dict[str, Any]) -> dict[str, str]:
    value = continuation.get("artifactVersions")
    if (
        not isinstance(value, dict)
        or not value
        or any(
            not isinstance(key, str) or not isinstance(item, str)
            for key, item in value.items()
        )
    ):
        raise ValueError("guarded continuation requires immutable artifactVersions")
    return dict(value)


def _affected_rule_ids(continuation: dict[str, Any]) -> tuple[str, ...]:
    value = continuation.get("affectedRuleIds")
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(item, str) or not item for item in value)
    ):
        raise ValueError("guarded continuation requires affectedRuleIds")
    return tuple(dict.fromkeys(value))


def _active_version_id(value: dict[str, Any], label: str) -> str:
    version = str(
        value.get("versionId")
        or value.get("version_id")
        or value.get("corpusVersionId")
        or value.get("corpus_version_id")
        or value.get("id")
        or ""
    ).strip()
    if not version:
        raise RuntimeError(f"active {label} response is missing version id")
    return version


def _report_user_id(evidence_report: dict[str, Any]) -> str:
    user_id = str(
        evidence_report.get("user_id") or evidence_report.get("userId") or ""
    ).strip()
    if not user_id:
        raise RuntimeError(
            "pinned technical evidence report is missing original trusted user identity"
        )
    return user_id


def _evidence_graph(evidence_report: dict[str, Any]) -> Any:
    payload = evidence_report.get("evidence_payload") or evidence_report.get(
        "evidencePayload"
    )
    if not isinstance(payload, dict):
        raise ValueError("accepted technical evidence report is missing evidence payload")
    graph = payload.get("evidence_graph") or payload.get("evidenceGraph")
    if graph is None:
        raise ValueError("accepted technical evidence report is missing Program Evidence Graph")
    return graph


def _execution_id(
    *,
    assessment_id: str,
    workflow_run_id: str,
    engineering_rule_id: str,
    artifact_versions: dict[str, str],
) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {
                "assessmentId": assessment_id,
                "workflowRunId": workflow_run_id,
                "engineeringRuleId": engineering_rule_id,
                "artifactVersions": artifact_versions,
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:24]
    return f"investigator-exec:{digest}"


def _execution_id_from_origin(origin: str, need_id: str) -> str:
    prefix = "investigator:"
    suffix = f":{need_id}"
    if not origin.startswith(prefix) or not origin.endswith(suffix):
        raise RuntimeError("targeted continuation origin is not an Investigator execution")
    execution_id = origin[len(prefix) : -len(suffix)].strip()
    if not execution_id:
        raise RuntimeError("targeted continuation origin is missing execution id")
    return execution_id


def _snapshot_checkpoint_id(snapshot: Any, *, required: bool = True) -> str:
    snapshot_config = getattr(snapshot, "config", None)
    checkpoint = (
        snapshot_config.get("configurable", {}).get("checkpoint_id")
        if isinstance(snapshot_config, dict)
        else None
    )
    checkpoint_text = str(checkpoint or "").strip()
    if required and not checkpoint_text:
        raise RuntimeError("managed Investigator did not persist a child checkpoint")
    return checkpoint_text


def _snapshot_structured_response(snapshot: Any) -> Any | None:
    values = getattr(snapshot, "values", None)
    if not isinstance(values, dict):
        return None
    return values.get("structured_response")


def _required_text(value: dict[str, Any], field: str) -> str:
    text = str(value.get(field) or "").strip()
    if not text:
        raise ValueError(f"guarded continuation requires {field}")
    return text


__all__ = [
    "ManagedTargetedInvestigatorPipeline",
    "ResumedManagedInvestigatorPipeline",
    "TargetedInterviewPending",
    "assert_managed_investigator_artifact_pins",
    "complete_resumed_investigation",
    "reconstruct_managed_investigator_continuation",
    "resume_managed_investigator",
]
