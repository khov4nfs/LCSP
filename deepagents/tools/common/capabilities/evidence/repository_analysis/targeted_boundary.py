"""Governed targeted reanalysis: re-run exactly one EngineeringRule through the assessment loop."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from tools.common.capabilities.agent_runtime.boundary import (
    AgentBoundaryBase,
    NonRetryableAgentBoundaryError,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.engineering_assessment_boundary import (
    EngineeringAssessmentBoundary,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    normalize_confirmed_structured_business_context,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.correlation import set_correlationId
from tools.common.capabilities.platform.logging import get_logger


logger = get_logger(__name__)

TARGETED_REANALYSIS_COMMAND = "command.scan.targeted-reanalysis.v1"
TARGETED_REANALYSIS_BOUNDARY_SOURCE = "repository-analysis.targeted"
TERMINAL_FAILURE_STATE = "FAILED"
DLQ_FAILURE_STATE = "DLQ"
SAFE_VALIDATION_FAILURE_CODE = "TARGETED_REANALYSIS_EVENT_MISMATCH"
SAFE_DELIVERY_FAILURE_CODE = "TARGETED_REANALYSIS_WORKER_DELIVERY_EXHAUSTED"
# Old pathPrefixes/subjectRefs/ruleDiscoveryTaskIds rows (or a malformed ruleScope).
SAFE_UNSUPPORTED_SCOPE_CODE = "TARGETED_REANALYSIS_SCOPE_UNSUPPORTED"
SAFE_CONTEXT_UNAVAILABLE_CODE = "TARGETED_REANALYSIS_CONTEXT_UNAVAILABLE"
SAFE_STALE_REVISION_CODE = "TARGETED_REANALYSIS_STALE_CONTEXT_REVISION"
SCOPE_KEY = "ruleScope"
_RULE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$")
_MAX_CRITERIA = 50


@dataclass(frozen=True)
class TargetedReanalysisEnvelope:
    request_id: str
    scan_job_id: str
    snapshot_id: str
    commit_sha: str
    analyzer_id: str
    normalized_scope: dict[str, object]
    checkpoint_ref: str
    correlationId: str
    delivery_attempt: int


@dataclass(frozen=True)
class TargetedRuleScope:
    engineering_rule_id: str
    criterion_ids: tuple[str, ...]
    context_revision: int
    prior_result_id: str | None = None


class TargetedRepositoryAnalysisBoundary(AgentBoundaryBase):
    """Validate one API-authorized request, then re-analyse and finalize exactly one rule."""

    boundary_source = TARGETED_REANALYSIS_BOUNDARY_SOURCE
    source_event = TARGETED_REANALYSIS_COMMAND
    requires_rbac = False
    retry_delays_seconds = (10, 60, 300)

    def __init__(
        self,
        config,
        rbac_client=None,
        *,
        api_client: WorkerApiClient | None = None,
        assessment_boundary: EngineeringAssessmentBoundary | None = None,
    ) -> None:
        super().__init__(config, rbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._assessment_boundary = assessment_boundary or EngineeringAssessmentBoundary(
            config,
            api_client=self._api_client,
        )

    def handle(self, message: dict, correlationId: str) -> None:
        envelope = self._read_envelope(message, correlationId)
        set_correlationId(envelope.correlationId)
        request = self._api_client.get_targeted_reanalysis_request(
            envelope.request_id
        )
        self._assert_matches_authorized_request(envelope, request)

        if request.get("state") in {"COMPLETED", "FAILED", "DLQ"}:
            return
        if not self._api_client.claim_targeted_reanalysis_request(
            envelope.request_id
        ):
            return

        rule_scope = self._rule_scope(envelope.normalized_scope)
        if rule_scope is None:
            self._fail_terminal(
                envelope.request_id, TERMINAL_FAILURE_STATE, SAFE_UNSUPPORTED_SCOPE_CODE
            )
            raise NonRetryableAgentBoundaryError(
                "targeted reanalysis requires the v3 ruleScope contract"
            )
        assessment_id = request.get("assessmentId")
        report_id = request.get("inputEvidenceReportId")
        if not assessment_id or not report_id:
            self._fail_terminal(
                envelope.request_id, TERMINAL_FAILURE_STATE, SAFE_CONTEXT_UNAVAILABLE_CODE
            )
            raise NonRetryableAgentBoundaryError(
                "targeted reanalysis request has no assessment/evidence report"
            )

        try:
            try:
                confirmed_context = normalize_confirmed_structured_business_context(
                    self._api_client.get_interview_worker_state(str(assessment_id)),
                    assessment_id=str(assessment_id),
                )
            except ValueError as error:
                # Customer context is not confirmed: redelivery cannot fix this.
                self._fail_terminal(
                    envelope.request_id,
                    TERMINAL_FAILURE_STATE,
                    SAFE_CONTEXT_UNAVAILABLE_CODE,
                )
                raise NonRetryableAgentBoundaryError(str(error)) from error
            if confirmed_context.context_revision != rule_scope.context_revision:
                self._fail_terminal(
                    envelope.request_id,
                    TERMINAL_FAILURE_STATE,
                    SAFE_STALE_REVISION_CODE,
                )
                raise NonRetryableAgentBoundaryError(
                    "targeted reanalysis contextRevision is not current"
                )
            if rule_scope.prior_result_id:
                prior = next(
                    (
                        row
                        for row in self._api_client.list_rule_assessments(
                            str(assessment_id)
                        )
                        if row.get("engineeringRuleId")
                        == rule_scope.engineering_rule_id
                    ),
                    None,
                )
                if not prior or prior.get("resultId") != rule_scope.prior_result_id:
                    self._fail_terminal(
                        envelope.request_id,
                        TERMINAL_FAILURE_STATE,
                        SAFE_CONTEXT_UNAVAILABLE_CODE,
                    )
                    raise NonRetryableAgentBoundaryError(
                        "targeted reanalysis priorResultId is not current"
                    )
            logger.info(
                "RULE_TARGETED_REANALYSIS_REQUESTED",
                requestId=envelope.request_id,
                engineeringRuleId=rule_scope.engineering_rule_id,
                correlationId=envelope.correlationId,
            )
            self._assessment_boundary.run_assessment(
                {
                    "assessmentId": str(assessment_id),
                    "evidenceReportId": str(report_id),
                    "correlationId": envelope.correlationId,
                },
                envelope.correlationId,
                confirmed_context=confirmed_context,
                rule_scope={rule_scope.engineering_rule_id},
            )
            self._api_client.complete_targeted_reanalysis_request(
                envelope.request_id,
                output_evidence_report_id=str(report_id),
            )
            logger.info(
                "RULE_TARGETED_REANALYSIS_COMPLETED",
                requestId=envelope.request_id,
                engineeringRuleId=rule_scope.engineering_rule_id,
                correlationId=envelope.correlationId,
            )
        except NonRetryableAgentBoundaryError:
            raise
        except Exception as error:
            self._handle_execution_failure(envelope, error)

    def _handle_execution_failure(
        self,
        envelope: TargetedReanalysisEnvelope,
        error: Exception,
    ) -> None:
        if envelope.delivery_attempt >= self._config.max_retries:
            self._fail_terminal(
                envelope.request_id,
                DLQ_FAILURE_STATE,
                SAFE_DELIVERY_FAILURE_CODE,
            )
            raise NonRetryableAgentBoundaryError(
                "targeted repository analysis retries exhausted"
            ) from error

        self._api_client.requeue_targeted_reanalysis_request(envelope.request_id)
        logger.warning(
            "TARGETED_REPOSITORY_ANALYSIS_RETRY_SCHEDULED",
            request_id=envelope.request_id,
            delivery_attempt=envelope.delivery_attempt + 1,
            error_type=type(error).__name__,
        )
        raise error

    def _fail_terminal(
        self,
        request_id: str,
        state: str,
        safe_failure_code: str,
    ) -> None:
        self._api_client.fail_targeted_reanalysis_request(
            request_id,
            state=state,
            safe_failure_code=safe_failure_code,
        )

    def _read_envelope(
        self,
        message: dict,
        correlationId: str,
    ) -> TargetedReanalysisEnvelope:
        request_id = self._read_string(message, "requestId", "request_id")
        scan_job_id = self._read_string(message, "scanJobId", "scan_job_id")
        snapshot_id = self._read_string(message, "snapshotId", "snapshot_id")
        commit_sha = self._read_string(message, "commitSha", "commit_sha")
        analyzer_id = self._read_string(message, "analyzerId", "analyzer_id")
        checkpoint_ref = self._read_string(
            message, "checkpointRef", "checkpoint_ref"
        )
        message_correlation_id = self._read_string(
            message, "correlationId", "correlation_id"
        )
        normalized_scope = message.get(
            "normalizedScope", message.get("normalized_scope")
        )
        if (
            not all(
                (
                    request_id,
                    scan_job_id,
                    snapshot_id,
                    commit_sha,
                    analyzer_id,
                    checkpoint_ref,
                )
            )
            or not self._is_scope(normalized_scope)
        ):
            raise NonRetryableAgentBoundaryError(
                "targeted repository analysis event is invalid"
            )

        delivery_attempt = message.get("_delivery_attempt", 0)
        if not isinstance(delivery_attempt, int) or delivery_attempt < 0:
            raise NonRetryableAgentBoundaryError(
                "targeted repository analysis delivery attempt is invalid"
            )

        return TargetedReanalysisEnvelope(
            request_id=request_id,
            scan_job_id=scan_job_id,
            snapshot_id=snapshot_id,
            commit_sha=commit_sha,
            analyzer_id=analyzer_id,
            normalized_scope=normalized_scope,
            checkpoint_ref=checkpoint_ref,
            correlationId=message_correlation_id or correlationId,
            delivery_attempt=delivery_attempt,
        )

    def _assert_matches_authorized_request(
        self,
        envelope: TargetedReanalysisEnvelope,
        request: dict,
    ) -> None:
        expected = {
            "id": envelope.request_id,
            "scanJobId": envelope.scan_job_id,
            "snapshotId": envelope.snapshot_id,
            "commitSha": envelope.commit_sha,
            "analyzerId": envelope.analyzer_id,
            "checkpointRef": envelope.checkpoint_ref,
        }
        if any(request.get(key) != value for key, value in expected.items()) or (
            self._canonical_scope(request.get("normalizedScope"))
            != self._canonical_scope(envelope.normalized_scope)
        ):
            self._fail_terminal(
                envelope.request_id,
                TERMINAL_FAILURE_STATE,
                SAFE_VALIDATION_FAILURE_CODE,
            )
            raise NonRetryableAgentBoundaryError(
                "targeted repository analysis event did not match request"
            )

    @staticmethod
    def _read_string(message: dict, *keys: str) -> str | None:
        for key in keys:
            value = message.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _is_scope(value: object) -> bool:
        # Shape only: legacy scopes stay readable so they fail cleanly after claim.
        return isinstance(value, dict)

    @staticmethod
    def _rule_scope(scope: object) -> TargetedRuleScope | None:
        rule_scope = (
            scope.get(SCOPE_KEY)
            if isinstance(scope, dict) and set(scope) == {SCOPE_KEY}
            else None
        )
        if not isinstance(rule_scope, dict):
            return None
        allowed = {
            "engineeringRuleId",
            "criterionIds",
            "contextRevision",
            "priorResultId",
        }
        if set(rule_scope) - allowed or not {
            "engineeringRuleId",
            "criterionIds",
            "contextRevision",
        }.issubset(rule_scope):
            return None
        rule_id = rule_scope.get("engineeringRuleId")
        criteria = rule_scope.get("criterionIds")
        revision = rule_scope.get("contextRevision")
        prior_result_id = rule_scope.get("priorResultId")
        if (
            isinstance(rule_id, str)
            and _RULE_ID.fullmatch(rule_id)
            and isinstance(criteria, list)
            and 1 <= len(criteria) <= _MAX_CRITERIA
            and len(criteria) == len(set(criteria))
            and all(
                isinstance(item, str) and _RULE_ID.fullmatch(item)
                for item in criteria
            )
            and isinstance(revision, int)
            and not isinstance(revision, bool)
            and revision >= 0
            and (
                prior_result_id is None
                or (
                    isinstance(prior_result_id, str)
                    and _RULE_ID.fullmatch(prior_result_id)
                )
            )
        ):
            return TargetedRuleScope(
                engineering_rule_id=rule_id,
                criterion_ids=tuple(criteria),
                context_revision=revision,
                prior_result_id=prior_result_id,
            )
        return None

    @staticmethod
    def _canonical_scope(value: object) -> str | None:
        if not TargetedRepositoryAnalysisBoundary._is_scope(value):
            return None
        return json.dumps(value, sort_keys=True, separators=(",", ":"))


__all__ = ["TargetedRepositoryAnalysisBoundary"]
