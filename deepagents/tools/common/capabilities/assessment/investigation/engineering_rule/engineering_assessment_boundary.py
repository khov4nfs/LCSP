"""Consume accepted repository evidence and run one Repository Analyst task per EngineeringRule.

The whole assessment is a plain per-rule loop: resolve pinned rules, evaluate legal
applicability, analyze each eligible rule (one Deep Agent task each), register Customer
business-context needs, then finalize deterministically into the classification callback.
"""
from __future__ import annotations


import hashlib
import json
import os
from collections.abc import Callable
from dataclasses import replace
from typing import Any

import pika

from orchestration.context import LCSPRunContext
from orchestration.waiting_assessments import WaitingAssessmentRegistry
from tools.common.capabilities.platform.api_client import WorkerApiClient, WorkerCallbackError
from tools.common.capabilities.platform.callback_schemas import ClassificationCallbackPayload
from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.agent_runtime.boundary import AgentBoundaryBase, NonRetryableAgentBoundaryError
from tools.triage.legal_rule_triage.contracts import LEGAL_RULE_TRIAGE_REQUEST_COMMAND

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from tools.common.capabilities.assessment.rule_assessment.run import (
    ELIGIBLE_APPLICABILITY,
    analyze_rule,
    claims_for_rule,
    emit_rule_activity,
    emit_rule_analysis_summary,
    evaluate_rule_applicability,
    finalize_rule_results,
    register_business_needs,
    rule_runtime_version,
    technical_evidence_display,
    usable_rule_result,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_ANALYSIS_STATUSES,
)
from tools.legal.corpus.engineering_rules.orchestration.service import EngineeringRuleService
from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import ChromaDbCitationRetriever

from .result import EngineeringInvestigationResult
from .rule_sources import resolve_engineering_rules


logger = get_logger(__name__)
WAITING_ENGINEERING_INVESTIGATION_STATUSES = {"WAITING"}
ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS = {
    "engineering_rule_readiness_waiting": "ENGINEERING_RULE_READINESS_WAITING",
}
CONFIRMED_CONTEXT_REQUIRED = "CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_REQUIRED"


class _AssessmentLegalPreparationDeferredDriver:
    """Prevent Assessment from performing legal preparation inside its reasoning path."""

    def run(self, message: dict[str, Any], correlation_id: str) -> dict[str, Any]:
        _ = message, correlation_id
        return {
            "status": "DEFERRED_TO_TRIAGE",
            "resumedRunCount": 0,
        }


class EngineeringAssessmentBoundary(AgentBoundaryBase):
    """Run the post-scan assessment as a deterministic per-rule loop."""

    boundary_source = "investigation.evidence-accepted"
    source_event = "event.technical-evidence.accepted.v1"
    requires_rbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        rbac_client=None,
        api_client: WorkerApiClient | None = None,
        dispatcher: Any | None = None,
        retriever: ChromaDbCitationRetriever | None = None,
        rule_service: EngineeringRuleService | None = None,
        triage_trigger_publisher: Callable[[dict[str, Any]], None] | None = None,
        waiting_registry: WaitingAssessmentRegistry | None = None,
    ) -> None:
        super().__init__(config, rbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._dispatcher = dispatcher
        self._retriever = retriever or ChromaDbCitationRetriever()
        self._rule_service = rule_service or EngineeringRuleService(retriever=self._retriever)
        self._corpus_recovery_driver = _AssessmentLegalPreparationDeferredDriver()
        self._triage_trigger_publisher = (
            triage_trigger_publisher or self._publish_legal_triage_command
        )
        self._waiting_registry = waiting_registry or WaitingAssessmentRegistry()

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        # No Customer-confirmed context: nothing may be analysed (fail closed).
        self.run_assessment(message, correlationId, confirmed_context=None)

    def run_assessment(
        self,
        message: dict[str, Any],
        correlationId: str,
        *,
        confirmed_context: Any | None,
        rule_scope: tuple[str, ...] | None = None,
    ) -> None:
        """Analyze eligible rules (all, or ``rule_scope``), then finalize and call back."""
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
        user_id = str(
            evidence_report.get("user_id")
            or evidence_report.get("userId")
            or message.get("userId")
            or message.get("user_id")
            or ""
        )

        workflow_run_id = self._workflow_run_id(
            message, evidence_report, evidence_report_id
        )
        scan_job_id = self._scan_job_id(evidence_report)
        result, pending_customer = self._assess(
            evidence_report=evidence_report,
            evidence_report_id=evidence_report_id,
            assessment_id=assessment_id,
            user_id=user_id or None,
            workflow_run_id=workflow_run_id,
            scan_job_id=scan_job_id,
            correlation_id=correlationId,
            confirmed_context=confirmed_context,
            rule_scope=rule_scope,
            source_crawl_requests=self._source_crawl_requests(message),
        )
        if pending_customer:
            # A Customer question is open: results stay in the ledger, and the answer resumes
            # that same rule. The classification is posted once no rule is waiting.
            logger.info(
                "ENGINEERING_ASSESSMENT_WAITING_FOR_CUSTOMER",
                assessment_id=assessment_id,
                correlationId=correlationId,
            )
            return

        result = self._as_waiting_for_triage(result)
        if result.status in WAITING_ENGINEERING_INVESTIGATION_STATUSES:
            self._emit_investigation_waiting_runtime_event(
                scan_job_id=scan_job_id,
                evidence_report_id=evidence_report_id,
                workflow_run_id=workflow_run_id,
                result=result,
                correlation_id=correlationId,
            )
        result_data = result.to_assessment_data()
        guardrail_status = self._guardrail_status(result.status)

        # correlationId is the direct assessment run identity. Re-delivery of the
        # same event remains idempotent; an explicit rerun receives a new correlation
        # ID and may persist a fresh result for the same pinned evidence report.
        result_data["run_id"] = correlationId
        result_data["technical_evidence_report_id"] = evidence_report_id
        snapshot_id = evidence_report.get("snapshot_id") or evidence_report.get(
            "snapshotId"
        )
        if snapshot_id:
            result_data["snapshot_id"] = str(snapshot_id)

        payload = ClassificationCallbackPayload(
            technical_evidence_report_id=evidence_report_id,
            assessment_id=assessment_id,
            schema_version="2.0.0",
            classification_data=result_data,
            guardrail_status=guardrail_status,
        )
        try:
            self._api_client.post_classification_callback(payload)
        except WorkerCallbackError as error:
            # WorkerApiClient already retries network/5xx failures internally. A
            # remaining callback 4xx is a deterministic payload/domain rejection;
            # replaying the expensive EngineeringRule/LLM run cannot heal it.
            if self._is_terminal_callback_client_error(error):
                raise NonRetryableAgentBoundaryError(str(error)) from error
            raise

        # Do not start legal reasoning until the WAITING classification has been
        # durably submitted. The command contains no Assessment/customer content;
        # only the resume evidence reference stays in the orchestration envelope and
        # is never passed into Triage reasoning/tools.
        if result.status in WAITING_ENGINEERING_INVESTIGATION_STATUSES:
            self._dispatch_legal_triage_request(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                workflow_run_id=workflow_run_id,
                result=result,
                correlation_id=correlationId,
            )

        logger.info(
            "ENGINEERING_ASSESSMENT_SUBMITTED",
            assessment_id=assessment_id,
            evidence_report_id=evidence_report_id,
            guardrail_status=guardrail_status,
            evaluation_count=(result_data.get("summary") or {}).get("total", 0),
            observability=result_data.get("observability") or {},
            correlationId=correlationId,
        )

    def _assess(
        self,
        *,
        evidence_report: dict[str, Any],
        evidence_report_id: str,
        assessment_id: str,
        user_id: str | None,
        workflow_run_id: str,
        scan_job_id: str | None,
        correlation_id: str,
        confirmed_context: Any | None,
        rule_scope: tuple[str, ...] | None,
        source_crawl_requests: list[dict[str, Any]] | None,
    ) -> tuple[EngineeringInvestigationResult, bool]:
        if confirmed_context is None:
            return self._stopped("BLOCKED", (CONFIRMED_CONTEXT_REQUIRED,), CONFIRMED_CONTEXT_REQUIRED), False
        resolution = resolve_engineering_rules(
            api_client=self._api_client,
            retriever=self._retriever,
            rule_service=self._rule_service,
            recovery_driver=self._corpus_recovery_driver,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
            source_crawl_requests=source_crawl_requests,
        )
        if resolution.status != "READY":
            return (
                EngineeringInvestigationResult(
                    status=resolution.status,
                    legal_rule_catalog_version_id=resolution.catalog_version_id,
                    legal_corpus_version_id=resolution.corpus_version_id,
                    rules_considered=len(resolution.legal_rules),
                    engineering_rules_executed=0,
                    engineering_rule_cache_hits=resolution.cache_hits,
                    limitations=resolution.limitations,
                    observability={**resolution.observability, "stop_reason": resolution.reason},
                ),
                False,
            )

        rules = list(resolution.rules)
        facts = {
            "legal_rules": list(resolution.legal_rules),
            "ai_discovery": _ai_discovery(evidence_report),
            "confirmed_statements": [item.to_prompt_dict() for item in confirmed_context.statements],
        }
        applicability = evaluate_rule_applicability(rules, facts)
        commit_sha = _commit_sha(evidence_report)
        context = LCSPRunContext(
            assessment_id=assessment_id,
            user_id=user_id,
            workflow_run_id=workflow_run_id,
            snapshot_id=str(evidence_report.get("snapshot_id") or evidence_report.get("snapshotId") or "") or None,
            scan_job_id=self._scan_job_id(evidence_report),
            commit_sha=commit_sha,
            correlation_id=correlation_id,
            artifact_versions={
                "technicalEvidenceReportId": evidence_report_id,
                "repositorySnapshotId": str(
                    evidence_report.get("snapshot_id") or evidence_report.get("snapshotId") or ""
                ),
                "legalRuleCatalogVersionId": resolution.catalog_version_id,
                "legalCorpusVersionId": resolution.corpus_version_id,
            },
        )
        statuses = [(applicability.get(str(rule.engineering_rule_id)) or {}).get("status") for rule in rules]
        emit_rule_analysis_summary(
            self._api_client,
            context.scan_job_id,
            engineeringRuleCount=len(rules),
            eligibleCount=sum(status in ELIGIBLE_APPLICABILITY for status in statuses),
            applicability={str(key): statuses.count(key) for key in dict.fromkeys(statuses)},
            contextRevision=confirmed_context.context_revision,
            scoped=rule_scope is not None,
        )
        persisted = {row.get("engineeringRuleId"): row for row in self._api_client.list_rule_assessments(assessment_id)}
        dispatcher = self._dispatcher or _default_dispatcher()
        executed = 0
        registered_needs: list[str] = []
        # ponytail: sequential. The dispatcher's billing/stream/repository-backend state is
        # context-local and unproven thread-safe; a bounded ThreadPoolExecutor (with
        # contextvars.copy_context per task) is the upgrade once that is verified.
        for rule in rules:
            rule_id = str(rule.engineering_rule_id)
            if rule_scope is not None and rule_id not in rule_scope:
                continue
            status = (applicability.get(rule_id) or {}).get("status")
            emit_rule_activity(
                self._api_client, context.scan_job_id, "ruleApplicabilityEvaluated", rule_id, applicability=status
            )
            if status not in ELIGIBLE_APPLICABILITY:
                continue  # NOT_APPLICABLE / BLOCKED / UPSTREAM_FACT_PENDING / missing: owner route, no analysis
            existing = persisted.get(rule_id)
            prior = existing if _same_pins(existing, rule, commit_sha) else None
            explicit = rule_scope is not None
            try:
                if prior is not None and not explicit and not _needs_analysis(prior, confirmed_context):
                    assessment = prior
                else:
                    assessment = analyze_rule(
                        rule=rule,
                        context=context,
                        dispatcher=dispatcher,
                        api=self._api_client,
                        confirmed_context=confirmed_context,
                        prior_result=prior,
                        attempt=int(((prior or {}).get("execution") or {}).get("attempt") or 0) + 1,
                    )
                    executed += 1
                if assessment.get("status") == RULE_ANALYSIS_STATUSES["needsContext"]:
                    # Idempotent (needId): re-registering on every run means a failed or
                    # skipped registration is retried instead of leaving the rule waiting forever.
                    registered_needs.extend(
                        register_business_needs(
                            rule=rule, assessment=assessment, context=context, api=self._api_client, user_id=user_id
                        )
                    )
            except Exception as error:  # noqa: BLE001 - one rule never aborts the other rules
                logger.warning("RULE_LOOP_ITEM_FAILED", engineering_rule_id=rule_id, error_type=type(error).__name__)

        assessments = self._api_client.list_rule_assessments(assessment_id)
        by_rule = {row.get("engineeringRuleId"): row for row in assessments}
        usable = {
            str(rule.engineering_rule_id): by_rule[str(rule.engineering_rule_id)]
            for rule in rules
            if usable_rule_result(
                rule,
                by_rule.get(str(rule.engineering_rule_id)),
                commit_sha=commit_sha,
                applicability_status=(applicability.get(str(rule.engineering_rule_id)) or {}).get("status"),
            )
        }
        waiting = [row for row in usable.values() if row.get("status") == RULE_ANALYSIS_STATUSES["needsContext"]]
        # Waiting on the Customer only when a need was actually registered; otherwise the rule
        # stays UNKNOWN with a typed limitation rather than hanging.
        pending_customer = bool(waiting and registered_needs)
        evaluations = finalize_rule_results(
            assessment_id=assessment_id,
            rules=rules,
            api=self._api_client,
            applicability_facts=facts,
            context_revision=confirmed_context.context_revision,
            assessments=assessments,
            applicability=applicability,
            commit_sha=commit_sha,
        )
        claims = tuple(
            claim
            for rule in rules
            if str(rule.engineering_rule_id) in usable
            for claim in claims_for_rule(rule, usable[str(rule.engineering_rule_id)], commit_sha=commit_sha)
        )
        limitations = list(resolution.limitations)
        if waiting and not registered_needs:
            limitations.append(ENGINEERING_LIMITATION_CODES["interview_registration_failed"])
        failed = [
            row for row in assessments if row.get("status") == RULE_ANALYSIS_STATUSES["failed"]
        ]
        if failed:
            limitations.append(ENGINEERING_LIMITATION_CODES["engineering_investigation_runtime_error"])
        if any(e.limitations and ENGINEERING_LIMITATION_CODES["rule_conclusion_withheld"] in e.limitations for e in evaluations):
            limitations.append(ENGINEERING_LIMITATION_CODES["rule_conclusion_withheld"])
        status = "BLOCKED" if not evaluations else "PARTIAL" if limitations else "COMPLETE"
        return (
            EngineeringInvestigationResult(
                status=status,
                legal_rule_catalog_version_id=resolution.catalog_version_id,
                legal_corpus_version_id=resolution.corpus_version_id,
                rules_considered=len(resolution.legal_rules),
                engineering_rules_executed=executed,
                engineering_rule_cache_hits=resolution.cache_hits,
                claims=claims,
                evaluations=tuple(evaluations),
                limitations=tuple(dict.fromkeys(limitations)),
                technical_evidence_by_rule={
                    e.engineering_rule_id: tuple(technical_evidence_display(usable.get(e.engineering_rule_id)))
                    for e in evaluations
                },
                observability={
                    **resolution.observability,
                    "rule_analysis": {
                        "statusCounts": _count(row.get("status") for row in assessments),
                        "executed": executed,
                    },
                },
            ),
            pending_customer,
        )

    @staticmethod
    def _stopped(status: str, limitations: tuple[str, ...], reason: str) -> EngineeringInvestigationResult:
        return EngineeringInvestigationResult(
            status=status,
            legal_rule_catalog_version_id="",
            legal_corpus_version_id="",
            rules_considered=0,
            engineering_rules_executed=0,
            engineering_rule_cache_hits=0,
            limitations=limitations,
            observability={"stop_reason": reason},
        )

    @staticmethod
    def _source_crawl_requests(message: dict[str, Any]) -> list[dict[str, Any]] | None:
        """Retain input compatibility without allowing Assessment to run legal recovery."""
        value = message.get("sourceCrawlRequests", message.get("source_crawl_requests"))
        if value is None:
            return None
        if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
            raise NonRetryableAgentBoundaryError(
                "sourceCrawlRequests must be a list of objects"
            )
        return value

    @staticmethod
    def _guardrail_status(status: str) -> str:
        normalized = str(status).upper()
        if normalized == "COMPLETE":
            return "PASSED"
        if normalized == "PARTIAL":
            return "DEGRADED"
        return "BLOCKED"

    @staticmethod
    def _missing_legal_rule_ids(result) -> tuple[str, ...]:
        observability = getattr(result, "observability", {}) or {}
        preparation = (
            observability.get("engineering_rule_preparation")
            if isinstance(observability, dict)
            else None
        )
        if not isinstance(preparation, dict):
            return ()
        values = preparation.get("compile_skipped_legal_rule_ids") or []
        if not isinstance(values, list):
            return ()
        return tuple(dict.fromkeys(str(value) for value in values if str(value)))

    @classmethod
    def _as_waiting_for_triage(cls, result):
        missing_rule_ids = cls._missing_legal_rule_ids(result)
        if not missing_rule_ids:
            return result
        observability = dict(getattr(result, "observability", {}) or {})
        observability["legal_preparation"] = {
            "status": "WAITING",
            "reason": "ENGINEERING_RULE_NOT_READY",
            "trigger": "ENGINEERING_RULE_NOT_READY",
            "automatic": True,
            "missing_legal_rule_ids": list(missing_rule_ids),
        }
        if str(getattr(result, "status", "")).upper() == "WAITING":
            return replace(result, observability=observability)
        return replace(result, status="WAITING", observability=observability)

    def _emit_investigation_waiting_runtime_event(
        self,
        *,
        scan_job_id: str | None,
        evidence_report_id: str,
        workflow_run_id: str,
        result,
        correlation_id: str,
    ) -> None:
        if not scan_job_id:
            return
        post_runtime_event = getattr(self._api_client, "post_scan_runtime_event", None)
        if post_runtime_event is None:
            return

        trigger = self._legal_triage_trigger(result)
        output_summary: dict[str, Any] = {
            "kind": "LEGAL_PREPARATION_REQUEST",
            "scope": "LEGAL_MAINTENANCE",
            "requestedBy": "ASSESSMENT_READINESS_GATE",
            "reasonCode": trigger["reason"],
            "status": str(getattr(result, "status", "WAITING")),
            "legalRuleCatalogVersionId": trigger["legalRuleCatalogVersionId"],
            "legalCorpusVersionId": trigger["legalCorpusVersionId"],
            "limitations": list(getattr(result, "limitations", ())),
            "correlationId": correlation_id,
            "resumeEvidenceReportId": evidence_report_id,
            "resumeWorkflowRunId": workflow_run_id,
            "triageTrigger": {
                key: value
                for key, value in trigger.items()
                if key != "reason"
            },
        }
        if trigger["affectedLegalRuleIds"]:
            output_summary["missingLegalRuleIds"] = list(
                trigger["affectedLegalRuleIds"]
            )

        post_runtime_event(
            scan_job_id,
            {
                # The shared runtime vocabulary currently models WAITING transitions as
                # TOOL_WAITING_INPUT. This payload explicitly marks this wait as
                # automatic/system-owned; no user/admin input is required.
                "event_type": "TOOL_WAITING_INPUT",
                "run_status": "WAITING",
                "stage": "LEGAL_RETRIEVAL",
                "tool_name": "engineering_rule_readiness",
                "summary": ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS[
                    "engineering_rule_readiness_waiting"
                ],
                "waiting_reason": trigger["reason"],
                "output_summary": {
                    **output_summary,
                    "messageKey": ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS[
                        "engineering_rule_readiness_waiting"
                    ],
                    "messageParams": {},
                },
            },
        )

    def _dispatch_legal_triage_request(
        self,
        *,
        assessment_id: str,
        evidence_report_id: str,
        workflow_run_id: str,
        result,
        correlation_id: str,
    ) -> None:
        trigger = self._legal_triage_trigger(result)
        self._waiting_registry.register(
            assessment_id=assessment_id,
            evidence_report_id=evidence_report_id,
            workflow_run_id=workflow_run_id,
            source_correlation_id=correlation_id,
        )
        command = {
            "trigger": "ENGINEERING_RULE_NOT_READY",
            "affectedLegalRuleIds": trigger["affectedLegalRuleIds"],
            "legalRuleCatalogVersionId": trigger["legalRuleCatalogVersionId"],
            "legalCorpusVersionId": trigger["legalCorpusVersionId"],
            "idempotencyKey": trigger["idempotencyKey"],
            # Resume references are orchestration-only. LegalRuleTriageBoundary strips
            # them from the model/tool boundary and uses them only after Triage ends.
            "resumeEvidenceReportId": evidence_report_id,
            "resumeWorkflowRunId": workflow_run_id,
            "correlationId": correlation_id,
        }
        self._triage_trigger_publisher(command)
        logger.info(
            "LEGAL_RULE_TRIAGE_AUTOMATIC_TRIGGER_PUBLISHED",
            affected_rule_count=len(trigger["affectedLegalRuleIds"]),
            full_backlog=trigger["fullBacklog"],
            correlationId=correlation_id,
        )

    @classmethod
    def _legal_triage_trigger(cls, result) -> dict[str, Any]:
        missing_rule_ids = cls._missing_legal_rule_ids(result)
        reason = (
            "ENGINEERING_RULE_NOT_READY"
            if missing_rule_ids
            else "NO_ENGINEERING_RULE_SOURCE_RULES"
        )
        catalog_version_id = str(
            getattr(result, "legal_rule_catalog_version_id", "")
        )
        corpus_version_id = str(getattr(result, "legal_corpus_version_id", ""))
        return {
            "reason": reason,
            "mode": "LEGAL_MAINTENANCE",
            "trigger": "ENGINEERING_RULE_NOT_READY",
            "automatic": True,
            "affectedLegalRuleIds": list(missing_rule_ids),
            "fullBacklog": not bool(missing_rule_ids),
            "refreshLegalCatalog": not bool(missing_rule_ids),
            "legalRuleCatalogVersionId": catalog_version_id,
            "legalCorpusVersionId": corpus_version_id,
            "idempotencyKey": cls._triage_trigger_idempotency_key(
                reason=reason,
                catalog_version_id=catalog_version_id,
                corpus_version_id=corpus_version_id,
                legal_rule_ids=missing_rule_ids,
            ),
        }

    @staticmethod
    def _triage_trigger_idempotency_key(
        *,
        reason: str,
        catalog_version_id: str,
        corpus_version_id: str,
        legal_rule_ids: tuple[str, ...],
    ) -> str:
        # Assessment identity is deliberately excluded: legal preparation is reusable
        # and keyed only by governed legal scope/version state.
        payload = "|".join(
            [
                reason,
                catalog_version_id,
                corpus_version_id,
                *sorted(legal_rule_ids),
            ]
        )
        return "legal-triage:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _publish_legal_triage_command(message: dict[str, Any]) -> None:
        rabbitmq_url = os.getenv("RABBITMQ_URL")
        if not rabbitmq_url:
            raise RuntimeError(
                "RABBITMQ_URL is required for automatic Legal Rule Triage dispatch"
            )
        exchange = os.getenv("RABBITMQ_EXCHANGE", "lcsp.events")
        connection = pika.BlockingConnection(pika.URLParameters(rabbitmq_url))
        try:
            channel = connection.channel()
            channel.exchange_declare(
                exchange=exchange,
                exchange_type="topic",
                durable=True,
            )
            channel.confirm_delivery()
            published = channel.basic_publish(
                exchange=exchange,
                routing_key=LEGAL_RULE_TRIAGE_REQUEST_COMMAND,
                body=json.dumps(message, ensure_ascii=False, sort_keys=True).encode("utf-8"),
                properties=pika.BasicProperties(
                    content_type="application/json",
                    delivery_mode=2,
                    correlation_id=str(message.get("correlationId") or ""),
                ),
                mandatory=True,
            )
            if published is False:
                raise RuntimeError("RabbitMQ did not confirm Legal Rule Triage command")
        finally:
            if connection.is_open:
                connection.close()

    def _get_accepted_evidence_report(self, evidence_report_id: str) -> dict[str, Any]:
        """Fetch accepted evidence and classify deterministic 4xx reads as terminal."""
        try:
            return self._api_client.get_accepted_technical_evidence_report(
                evidence_report_id
            )
        except WorkerCallbackError as error:
            # A stale/deleted report or another deterministic 4xx cannot be healed by
            # requeueing the same broker delivery. Network/5xx failures remain
            # retryable so RabbitMQ can redeliver after the dependency recovers.
            if self._is_terminal_callback_client_error(error):
                raise NonRetryableAgentBoundaryError(str(error)) from error
            raise

    @staticmethod
    def _scan_job_id(evidence_report: dict[str, Any]) -> str | None:
        value = str(
            evidence_report.get("scan_job_id")
            or evidence_report.get("scanJobId")
            or ""
        ).strip()
        return value or None

    @staticmethod
    def _evidence_report_id(message: dict[str, Any]) -> str:
        value = (
            message.get("evidenceReportId")
            or message.get("evidence_report_id")
            or message.get("technicalEvidenceReportId")
            or message.get("aggregateId")
        )
        if not value:
            raise ValueError("missing evidenceReportId")
        return str(value)

    @staticmethod
    def _workflow_run_id(
        message: dict[str, Any],
        evidence_report: dict[str, Any],
        evidence_report_id: str,
    ) -> str:
        return str(
            message.get("workflowRunId")
            or message.get("workflow_run_id")
            or evidence_report.get("scan_job_id")
            or evidence_report.get("scanJobId")
            or evidence_report_id
        )

    @staticmethod
    def _is_terminal_callback_client_error(error: WorkerCallbackError) -> bool:
        """Return whether WorkerApiClient reported a non-idempotent HTTP 4xx."""
        return bool(getattr(error, "callback_client_error", False))


def _default_dispatcher() -> Any:
    from orchestration.dispatcher import RootSubagentDispatcher

    return RootSubagentDispatcher()


def _same_pins(existing: dict[str, Any] | None, rule: Any, commit_sha: str) -> bool:
    return bool(
        existing
        and existing.get("repositoryVersion") == commit_sha
        and existing.get("engineeringRuleVersion") == rule_runtime_version(rule)
    )


def _needs_analysis(existing: dict[str, Any], confirmed_context: Any) -> bool:
    """Reuse a current result; redo failed ones and resume rules whose Customer answer landed."""
    status = existing.get("status")
    if status == RULE_ANALYSIS_STATUSES["failed"]:
        return True
    return status == RULE_ANALYSIS_STATUSES["needsContext"] and int(
        existing.get("contextRevision") or 0
    ) < int(confirmed_context.context_revision or 0)


def _count(values: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[str(value)] = counts.get(str(value), 0) + 1
    return counts


def _commit_sha(evidence_report: dict[str, Any]) -> str:
    payload = evidence_report.get("evidence_payload") or evidence_report.get("evidencePayload") or {}
    graph = payload.get("evidence_graph") or payload.get("evidenceGraph") or {}
    for source, keys in (
        (payload, ("commit_sha", "commitSha")),
        (graph, ("commit_sha", "commitSha")),
        (evidence_report, ("commit_sha", "commitSha")),
    ):
        for key in keys:
            if isinstance(source, dict) and source.get(key):
                return str(source[key])
    return ""


def _ai_discovery(evidence_report: dict[str, Any]) -> dict[str, Any] | None:
    from .interview_gated_boundary import _ai_discovery as read_ai_discovery

    return read_ai_discovery(evidence_report)
