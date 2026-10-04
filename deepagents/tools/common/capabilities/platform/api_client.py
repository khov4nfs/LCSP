"""Provide secret-safe, retrying access to LCSP internal read/callback APIs."""

import time
import httpx
from structlog import get_logger

from tools.common.capabilities.package.contract.api_client_contracts import (
    correlationId_HEADER,
    WORKER_API_KEY_HEADER,
    CallbackLogEvent,
    CallbackPath,
    InternalPath,
    client_error_message,
    network_error_message,
    server_error_message,
    unexpected_error_message,
)
from tools.common.capabilities.platform.correlation import get_correlationId
from middleware.redaction import redact_dict, redact_source_code
from tools.common.capabilities.platform.callback_schemas import (
    CallbackResponse,
    ScanCallbackPayload,
    TechnicalProfileCallbackPayload,
    AIUsageFlowCallbackPayload,
    SettledUsagePayload,
    ConflictDetectionCallbackPayload,
    ClassificationCallbackPayload,
    AuditExportCallbackPayload,
)

logger = get_logger(__name__)

_AGENT_STREAM_NETWORK_BACKOFF_SECONDS = 2.0

_IDEMPOTENT_CONFLICT_CODES = {
    "FLOW_ALREADY_EXISTS",
    "PROFILE_ALREADY_EXISTS",
    "RESULT_ALREADY_EXISTS",
}
_PRIVACY_FLAG_KEYS = {
    "containsSourceCode",
    "secretsRedacted",
    "sourceStrippedFromFindings",
}


class WorkerCallbackError(Exception):
    """Raised when an internal API request permanently fails or violates its contract.

    A 4xx carries `status_code` so delivery settlement can stop instead of redelivering the
    identical payload forever. Retrying a rejected decision re-runs the model on every
    redelivery, so an unbounded loop spends real money and never converges.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.callback_client_error = (
            status_code is not None and 400 <= status_code < 500
        )


class InterviewCoverageCallbackError(WorkerCallbackError):
    """Coverage changed or failed validation; the boundary must request recovery."""


INTERVIEW_DECISION_REPAIRABLE_REJECTION_CODES = frozenset({
    "INTERVIEW_ACTIVE_QUESTION_OUTCOME_INVALID",
    "INTERVIEW_AGENT_DECISION_INVALID",
    "INTERVIEW_CONFIRM_ADJUST_QUESTION_INVALID",
    "INTERVIEW_CONFIRMED_CONTEXT_INVALID",
    "INTERVIEW_CONFIRMED_REQUIRES_DIRECT_ASK",
    "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY",
    "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_AUTHORITY",
    "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_TARGETED_MODE",
    "INTERVIEW_CUSTOMER_CONFIRMED_REQUIRES_DIRECT_OR_EXPLICIT_CONFIRMATION",
    "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED",
    "INTERVIEW_INITIAL_QUESTION_INVALID",
    "INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE",
    "INTERVIEW_QUESTION_FRONTIER_DESCRIPTION_REQUIRED",
    "INTERVIEW_QUESTION_FRONTIER_NOT_CUSTOMER_OWNED",
    "INTERVIEW_QUESTION_FRONTIER_NOT_MATERIAL",
    "INTERVIEW_QUESTION_FRONTIER_REQUIRED",
    "INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED",
    "INTERVIEW_TARGETED_MODE_REQUIRED",
    "INTERVIEW_TARGETED_NEED_NON_NEUTRAL",
    "INTERVIEW_TARGETED_OUTCOME_INVALID",
    "INTERVIEW_TARGETED_QUESTION_NEED_MISMATCH",
    "INTERVIEW_WAITING_REQUIRES_QUESTION",
})


class InterviewDecisionRepairableCallbackError(WorkerCallbackError):
    """API rejected model-authored Interview decision content that may self-correct once.

    The API guard remains authoritative. This error only tells the boundary that
    the rejection code is in the explicit payload-content allowlist and can be
    fed back privately to the specialist for one bounded retry.
    """

    def __init__(
        self,
        message: str,
        *,
        error_code: str,
        status_code: int = 409,
        meta: dict | None = None,
    ) -> None:
        super().__init__(message, status_code=status_code)
        self.error_code = error_code
        self.meta = dict(meta or {})


class InterviewResolutionCallbackError(InterviewDecisionRepairableCallbackError):
    """Private criterion feedback for one bounded specialist correction."""

    def __init__(self, message: str, *, missing: str | None = None) -> None:
        meta = {"missing": missing} if missing is not None else {}
        super().__init__(
            message,
            error_code="INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED",
            status_code=409,
            meta=meta,
        )
        self.missing = missing


class InterviewContextReadyAuthorityCallbackError(InterviewDecisionRepairableCallbackError):
    """The specialist asserted CONTEXT_READY without CUSTOMER_CONFIRMED authority.

    The API guard is correct and must never be relaxed. This carries the rejection
    so the boundary can give the specialist exactly one bounded chance to ask for
    confirmation instead of inferring authority it was never given.
    """

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            error_code="INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY",
            status_code=409,
        )


class WorkerApiClient:
    """Internal API adapter used by workers for canonical reads and callbacks.

    Requests propagate worker credentials and correlation IDs, retry only network
    and server failures, fail fast for non-idempotent client errors, and redact
    callback payloads before they cross the process boundary.
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        """Create the client with the LCSP API base URL and worker credential."""
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = 30.0
        self._max_retries = 3
        self._agent_stream_unavailable_until = 0.0
        from tools.common.capabilities.platform.rbac_client import RbacClient
        self.rbac_client = RbacClient(self._base_url, self._api_key)

    def _post_with_retry(
        self, path: str, payload: dict, *, redact: bool = True, method: str = "POST"
    ) -> dict:
        """POST a sanitized payload with exponential retry for network/5xx failures.

        Known 409 duplicate codes are treated as idempotent success. Other 4xx
        responses fail immediately; transport and 5xx failures retry up to the
        configured attempt cap.
        """
        url = f"{self._base_url}{path}"
        cid = get_correlationId()
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: cid,
        }
        from orchestration.runtime_control import active_runtime_run_id
        runtime_run_id = active_runtime_run_id.get()
        if runtime_run_id:
            headers["x-lcsp-runtime-run-id"] = runtime_run_id
        safe_payload = self._redact_callback_payload(payload) if redact else dict(payload)

        send = httpx.put if method == "PUT" else httpx.post
        for attempt in range(self._max_retries):
            if path != "/internal/assessment-runtime-controls" and path != CallbackPath.BILLING_USAGE:
                from orchestration.agent_stream import check_agent_execution_active
                check_agent_execution_active()
            try:
                resp = send(
                    url,
                    json=safe_payload,
                    headers=headers,
                    timeout=self._timeout,
                )

                if 400 <= resp.status_code < 500:
                    error_code = self._response_error_code(resp)
                    if resp.status_code == 409 and error_code in _IDEMPOTENT_CONFLICT_CODES:
                        logger.info(
                            "API_CALLBACK_IDEMPOTENT_DUPLICATE",
                            path=path,
                            error_code=error_code,
                        )
                        return {
                            "accepted": True,
                            "status": "duplicate",
                            "correlationId": cid,
                        }
                    if (
                        resp.status_code == 404
                        and error_code == "SCAN_JOB_NOT_FOUND"
                        and path.endswith("/claim")
                    ):
                        logger.info(
                            "SCAN_JOB_CLAIM_STALE_DELIVERY",
                            path=path,
                            status_code=resp.status_code,
                            error_code=error_code,
                        )
                    else:
                        logger.error(
                            CallbackLogEvent.CLIENT_ERROR,
                            path=path,
                            status_code=resp.status_code,
                            error_code=error_code,
                        )
                    message = client_error_message(resp.status_code)
                    if error_code:
                        message = f"{error_code}: {message}"
                    if resp.status_code == 409 and error_code in {
                        "INTERVIEW_PARTIAL_COVERAGE_LIMITATIONS_REQUIRED",
                        "INTERVIEW_TECHNICAL_COVERAGE_UNUSABLE",
                    }:
                        raise InterviewCoverageCallbackError(
                            message, status_code=resp.status_code
                        )
                    if error_code in INTERVIEW_DECISION_REPAIRABLE_REJECTION_CODES:
                        meta = self._response_problem_meta(resp)
                        if error_code == "INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED":
                            missing = meta.get("missing")
                            raise InterviewResolutionCallbackError(
                                message,
                                missing=missing if isinstance(missing, str) else None,
                            )
                        if error_code == "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY":
                            raise InterviewContextReadyAuthorityCallbackError(message)
                        raise InterviewDecisionRepairableCallbackError(
                            message,
                            error_code=error_code,
                            status_code=resp.status_code,
                            meta=meta,
                        )
                    raise WorkerCallbackError(
                        message,
                        status_code=resp.status_code,
                        error_code=error_code,
                    )

                if resp.status_code >= 500:
                    error_code = self._response_error_code(resp)
                    if attempt < self._max_retries - 1:
                        backoff = 2**attempt
                        logger.warning(
                            CallbackLogEvent.SERVER_ERROR_RETRYING,
                            path=path,
                            status_code=resp.status_code,
                            error_code=error_code,
                            attempt=attempt + 1,
                            sleep=backoff,
                        )
                        time.sleep(backoff)
                        continue
                    logger.error(
                        CallbackLogEvent.SERVER_ERROR_TERMINAL,
                        path=path,
                        status_code=resp.status_code,
                        error_code=error_code,
                    )
                    raise WorkerCallbackError(
                        server_error_message(self._max_retries, resp.status_code)
                    )

                return self._unwrap_result_envelope(resp.json())

            except httpx.RequestError as exc:
                if attempt < self._max_retries - 1:
                    backoff = 2**attempt
                    logger.warning(
                        CallbackLogEvent.NETWORK_ERROR_RETRYING,
                        path=path,
                        error=type(exc).__name__,
                        attempt=attempt + 1,
                        sleep=backoff,
                    )
                    time.sleep(backoff)
                    continue
                logger.error(
                    CallbackLogEvent.NETWORK_ERROR_TERMINAL,
                    path=path,
                    error=type(exc).__name__,
                )
                raise WorkerCallbackError(
                    network_error_message(self._max_retries)
                ) from exc

        raise WorkerCallbackError(unexpected_error_message())

    def _response_error_code(self, response) -> str | None:
        """Extract a typed error code from supported API/problem response shapes."""
        try:
            data = response.json()
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        value = data.get("error_code") or data.get("errorCode")
        if value:
            return str(value)
        problem = data.get("problem")
        if isinstance(problem, dict):
            value = problem.get("code") or problem.get("error_code")
            if value:
                return str(value)
        return None

    def _response_problem_meta(self, response) -> dict:
        """Extract typed problem metadata without trusting it as authority."""
        try:
            data = response.json()
        except ValueError:
            return {}
        if not isinstance(data, dict):
            return {}
        problem = data.get("problem")
        if not isinstance(problem, dict):
            return {}
        meta = problem.get("meta")
        return dict(meta) if isinstance(meta, dict) else {}

    @staticmethod
    def _unwrap_result_envelope(data):
        """Unwrap the standard ``{ok: true, data: ...}`` API response envelope."""
        if isinstance(data, dict) and data.get("ok") is True:
            nested = data.get("data")
            if isinstance(nested, (dict, list)):
                return nested
        return data

    def _get_with_retry(self, path: str, params: dict = None) -> dict | list:
        """GET canonical internal data with exponential retry for network/5xx errors."""
        url = f"{self._base_url}{path}"
        cid = get_correlationId()
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: cid,
        }

        for attempt in range(self._max_retries):
            try:
                resp = httpx.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=self._timeout,
                )

                if 400 <= resp.status_code < 500:
                    error_code = self._response_error_code(resp)
                    logger.error(
                        CallbackLogEvent.CLIENT_ERROR,
                        path=path,
                        status_code=resp.status_code,
                        error_code=error_code,
                    )
                    message = client_error_message(resp.status_code)
                    if error_code:
                        message = f"{error_code}: {message}"
                    raise WorkerCallbackError(message, status_code=resp.status_code)

                if resp.status_code >= 500:
                    if attempt < self._max_retries - 1:
                        backoff = 2**attempt
                        logger.warning(
                            CallbackLogEvent.SERVER_ERROR_RETRYING,
                            path=path,
                            status_code=resp.status_code,
                            attempt=attempt + 1,
                            sleep=backoff,
                        )
                        time.sleep(backoff)
                        continue
                    logger.error(
                        CallbackLogEvent.SERVER_ERROR_TERMINAL,
                        path=path,
                        status_code=resp.status_code,
                    )
                    raise WorkerCallbackError(
                        server_error_message(self._max_retries, resp.status_code)
                    )

                return self._unwrap_result_envelope(resp.json())

            except httpx.RequestError as exc:
                if attempt < self._max_retries - 1:
                    backoff = 2**attempt
                    logger.warning(
                        CallbackLogEvent.NETWORK_ERROR_RETRYING,
                        path=path,
                        error=type(exc).__name__,
                        attempt=attempt + 1,
                        sleep=backoff,
                    )
                    time.sleep(backoff)
                    continue
                logger.error(
                    CallbackLogEvent.NETWORK_ERROR_TERMINAL,
                    path=path,
                    error=type(exc).__name__,
                )
                raise WorkerCallbackError(
                    network_error_message(self._max_retries)
                ) from exc

        raise WorkerCallbackError(unexpected_error_message())

    def _redact_callback_payload(self, payload: dict) -> dict:
        """Strip source-like findings and redact secrets while preserving privacy flags."""
        safe_payload = dict(payload)
        findings = safe_payload.get("findings")
        if isinstance(findings, list):
            safe_payload["findings"] = redact_source_code(
                [finding for finding in findings if isinstance(finding, dict)]
            )
        evidence_payload = safe_payload.get("evidence_payload")
        if isinstance(evidence_payload, dict):
            safe_evidence_payload = dict(evidence_payload)
            signals = safe_evidence_payload.get("ai_usage_signals")
            if isinstance(signals, list):
                safe_evidence_payload["ai_usage_signals"] = redact_source_code(
                    [signal for signal in signals if isinstance(signal, dict)]
                )
            safe_payload["evidence_payload"] = safe_evidence_payload
        redacted_payload = redact_dict(safe_payload)
        for provenance_key in ("tools_version", "config_hash"):
            provenance = safe_payload.get(provenance_key)
            if isinstance(provenance, dict):
                redacted_payload[provenance_key] = {
                    str(key): str(value)
                    for key, value in provenance.items()
                    if str(key).strip() and str(value).strip()
                }
        privacy_flags = safe_payload.get("privacy_flags")
        if isinstance(privacy_flags, dict):
            redacted_payload["privacy_flags"] = {
                key: value
                for key, value in privacy_flags.items()
                if key in _PRIVACY_FLAG_KEYS and isinstance(value, bool)
            }
        return redacted_payload

    def post_scan_callback(
        self, scan_job_id: str, payload: ScanCallbackPayload
    ) -> CallbackResponse:
        """Submit a scan terminal callback, omitting an empty findings array."""
        import os
        import json
        path = CallbackPath.SCAN.format(scan_job_id=scan_job_id)
        request_payload = payload.model_dump(exclude_none=True)
        if request_payload.get("findings") == []:
            request_payload.pop("findings")

        serialized = json.dumps(request_payload, ensure_ascii=False)
        threshold = int(os.getenv("LCSP_SCAN_CALLBACK_THRESHOLD", str(40 * 1024 * 1024)))
        if len(serialized.encode("utf-8")) > threshold:
            from tools.common.capabilities.platform.artifact_storage import ArtifactStorage
            storage = ArtifactStorage()
            chunk_size = int(os.getenv("LCSP_SCAN_CALLBACK_CHUNK_SIZE", str(10 * 1024 * 1024)))
            manifest = storage.write_payload_chunks(request_payload, chunk_size=chunk_size)
            envelope = {
                "status": payload.status,
                "scan_job_id": scan_job_id,
                "privacy_flags": payload.privacy_flags,
                "schema_version": payload.schema_version,
                "is_artifact_reference": True,
                "artifact_manifest": manifest
            }
            resp_data = self._post_with_retry(path, envelope)
        else:
            resp_data = self._post_with_retry(path, request_payload)
        return CallbackResponse(**resp_data)

    def claim_scan_job(self, scan_job_id: str, payload: dict) -> dict:
        """Atomically claim a queued scan before repository analysis starts."""
        path = CallbackPath.SCAN_CLAIM.format(scan_job_id=scan_job_id)
        response = self._post_with_retry(path, payload)
        return response if isinstance(response, dict) else {}

    def post_scan_terminal_failure(self, scan_job_id: str, payload: dict) -> None:
        """Best-effort terminal scan failure callback used by broker watchdogs."""
        url = f"{self._base_url}{CallbackPath.SCAN_TERMINAL_FAILURE.format(scan_job_id=scan_job_id)}"
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: get_correlationId(),
        }
        try:
            response = httpx.post(
                url,
                json=redact_dict(payload),
                headers=headers,
                timeout=3.0,
            )
            if response.status_code >= 400:
                error_code = self._response_error_code(response)
                if response.status_code == 404 and error_code == "SCAN_JOB_NOT_FOUND":
                    logger.info(
                        "SCAN_TERMINAL_FAILURE_SKIPPED_STALE_JOB",
                        scan_job_id=scan_job_id,
                        status_code=response.status_code,
                        error_code=error_code,
                    )
                    return
                logger.warning(
                    "SCAN_TERMINAL_FAILURE_REJECTED",
                    scan_job_id=scan_job_id,
                    status_code=response.status_code,
                    error_code=error_code,
                )
        except Exception as exc:
            logger.warning(
                "SCAN_TERMINAL_FAILURE_POST_FAILED",
                scan_job_id=scan_job_id,
                error=type(exc).__name__,
            )

    def post_interview_progress(self, assessment_id: str, revision: int, phase: str) -> None:
        from orchestration.agent_stream import check_agent_execution_active
        from orchestration.runtime_control import active_runtime_run_id
        check_agent_execution_active()
        headers = {WORKER_API_KEY_HEADER: self._api_key, correlationId_HEADER: get_correlationId()}
        if active_runtime_run_id.get():
            headers["x-lcsp-runtime-run-id"] = active_runtime_run_id.get()
        try:
            response = httpx.post(
                f"{self._base_url}/internal/assessment-interviews/{assessment_id}/runtime-progress",
                headers=headers,
                json={"contextRevision": revision, "phase": phase},
                timeout=3,
            )
            response.raise_for_status()
        except Exception:
            import logging
            logging.getLogger(__name__).warning("Interview progress delivery failed phase=%s", phase)

    def post_scan_runtime_event(self, scan_job_id: str, payload: dict) -> None:
        """Submit best-effort privacy-safe runtime progress for an active scan job."""
        from orchestration.agent_stream import check_agent_execution_active
        from orchestration.runtime_control import active_runtime_run_id
        check_agent_execution_active()
        path = CallbackPath.SCAN_RUNTIME_EVENT.format(scan_job_id=scan_job_id)
        url = f"{self._base_url}{path}"
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: get_correlationId(),
        }
        if active_runtime_run_id.get():
            headers["x-lcsp-runtime-run-id"] = active_runtime_run_id.get()
        elif isinstance(payload.get("output_summary"), dict) and payload["output_summary"].get("runtimeRunId"):
            headers["x-lcsp-runtime-run-id"] = payload["output_summary"]["runtimeRunId"]
        try:
            response = httpx.post(
                url,
                json=redact_dict(payload),
                headers=headers,
                timeout=3.0,
            )
            if response.status_code >= 400:
                logger.warning(
                    "SCAN_RUNTIME_EVENT_REJECTED",
                    scan_job_id=scan_job_id,
                    status_code=response.status_code,
                    error_code=self._response_error_code(response),
                )
        except Exception as exc:
            logger.warning(
                "SCAN_RUNTIME_EVENT_POST_FAILED",
                scan_job_id=scan_job_id,
                error=type(exc).__name__,
            )

    def post_agent_stream_event(self, payload: dict) -> None:
        """Submit one best-effort live agent event for the workspace chat stream."""
        now = time.monotonic()
        if now < self._agent_stream_unavailable_until:
            return
        url = f"{self._base_url}{CallbackPath.AGENT_STREAM_EVENT}"
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: get_correlationId(),
        }
        runtime_run_id = (payload.get("data") or {}).get("runtimeRunId")
        if isinstance(runtime_run_id, str):
            headers["x-lcsp-runtime-run-id"] = runtime_run_id
        try:
            response = httpx.post(
                url,
                json=redact_dict(payload),
                headers=headers,
                timeout=3.0,
            )
            self._agent_stream_unavailable_until = 0.0
            if response.status_code >= 400:
                logger.warning(
                    "AGENT_STREAM_EVENT_REJECTED",
                    status_code=response.status_code,
                    error_code=self._response_error_code(response),
                    event_type=payload.get("event_type"),
                    run_id=payload.get("run_id"),
                    client_sequence=payload.get("client_sequence"),
                )
        except Exception as exc:
            self._agent_stream_unavailable_until = (
                time.monotonic() + _AGENT_STREAM_NETWORK_BACKOFF_SECONDS
            )
            logger.warning(
                "AGENT_STREAM_EVENT_POST_FAILED",
                error=type(exc).__name__,
                retry_after_seconds=_AGENT_STREAM_NETWORK_BACKOFF_SECONDS,
            )

    def post_decision_model_event(self, payload: dict) -> None:
        """Persist one privacy-safe decision-model semantic event best-effort."""
        try:
            self._post_with_retry(
                CallbackPath.DECISION_MODEL_EVENT,
                payload,
            )
        except Exception as exc:
            logger.warning(
                "DECISION_MODEL_EVENT_POST_FAILED",
                error=type(exc).__name__,
            )

    def claim_decision_model_request(self, decision_id: str, payload: dict) -> bool:
        """Atomically claim a shadow decision idempotency key before provider execution."""
        path = CallbackPath.DECISION_MODEL_CLAIM.format(decision_id=decision_id)
        try:
            response = self._post_with_retry(path, payload)
        except WorkerCallbackError as exc:
            if getattr(exc, "status_code", None) == 409:
                return False
            logger.warning(
                "DECISION_MODEL_CLAIM_FAILED_CLOSED",
                decision_id=decision_id,
                error=type(exc).__name__,
            )
            raise
        return bool(response.get("claimed", True))

    def complete_decision_model_request(self, decision_id: str, payload: dict) -> None:
        """Persist the final shadow decision comparison for replay/audit."""
        path = CallbackPath.DECISION_MODEL_COMPLETE.format(decision_id=decision_id)
        try:
            self._post_with_retry(path, payload)
        except Exception as exc:
            logger.warning(
                "DECISION_MODEL_COMPLETE_FAILED",
                decision_id=decision_id,
                error=type(exc).__name__,
            )

    def post_technical_profile_callback(
        self, payload: TechnicalProfileCallbackPayload
    ) -> CallbackResponse:
        """Persist a generated TechnicalProfile through the internal callback API."""
        import os
        import json
        path = CallbackPath.TECHNICAL_PROFILE
        request_payload = payload.model_dump(exclude_none=True)

        serialized = json.dumps(request_payload, ensure_ascii=False)
        threshold = int(os.getenv("LCSP_PROFILE_CALLBACK_THRESHOLD", str(800 * 1024)))
        if len(serialized.encode("utf-8")) > threshold:
            from tools.common.capabilities.platform.artifact_storage import ArtifactStorage
            storage = ArtifactStorage()
            chunk_size = int(os.getenv("LCSP_PROFILE_CALLBACK_CHUNK_SIZE", str(200 * 1024)))
            manifest = storage.write_payload_chunks(request_payload, chunk_size=chunk_size)
            envelope = {
                "evidence_report_id": payload.evidence_report_id,
                "assessment_id": payload.assessment_id,
                "schema_version": payload.schema_version,
                "provider_version": payload.provider_version,
                "privacy_flags": payload.privacy_flags,
                "scan_job_id": payload.scan_job_id,
                "profile_data": request_payload.get("profile_data"),
                "is_artifact_reference": True,
                "artifact_manifest": manifest
            }
            resp_data = self._post_with_retry(path, envelope)
        else:
            resp_data = self._post_with_retry(path, request_payload)
        return CallbackResponse(**resp_data)

    def get_accepted_technical_evidence_report(self, evidence_report_id: str) -> dict:
        """Fetch a canonical TechnicalEvidenceReport and require accepted status."""
        path = InternalPath.TECHNICAL_EVIDENCE_REPORT.format(
            evidence_report_id=evidence_report_id
        )
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Technical evidence report response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status != "accepted":
            raise WorkerCallbackError("Technical evidence report is not accepted.")
        return data

    def get_targeted_reanalysis_request(self, request_id: str) -> dict:
        """Fetch one targeted-reanalysis lifecycle request by ID."""
        path = InternalPath.TARGETED_REANALYSIS_REQUEST.format(request_id=request_id)
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Targeted reanalysis request response was invalid.")
        return data

    def claim_targeted_reanalysis_request(self, request_id: str) -> bool:
        """Atomically claim a targeted-reanalysis request for worker execution."""
        path = CallbackPath.TARGETED_REANALYSIS_CLAIM.format(request_id=request_id)
        data = self._post_with_retry(path, {})
        return bool(data.get("claimed"))

    def complete_targeted_reanalysis_request(
        self,
        request_id: str,
        *,
        output_evidence_report_id: str,
    ) -> dict:
        """Mark targeted reanalysis COMPLETED and attach its output evidence artifact."""
        return self._post_targeted_reanalysis_terminal(
            request_id,
            {"state": "COMPLETED", "output_evidence_report_id": output_evidence_report_id},
        )

    def fail_targeted_reanalysis_request(
        self,
        request_id: str,
        *,
        state: str,
        safe_failure_code: str,
    ) -> dict:
        """Mark targeted reanalysis FAILED/DLQ using a safe failure code only."""
        if state not in {"FAILED", "DLQ"}:
            raise ValueError("Targeted reanalysis terminal state must be FAILED or DLQ.")
        return self._post_targeted_reanalysis_terminal(
            request_id,
            {"state": state, "safe_failure_code": safe_failure_code},
        )

    def requeue_targeted_reanalysis_request(self, request_id: str) -> bool:
        """Request requeue of a targeted-reanalysis lifecycle record."""
        path = CallbackPath.TARGETED_REANALYSIS_REQUEUE.format(request_id=request_id)
        data = self._post_with_retry(path, {})
        return bool(data.get("requeued"))

    def _post_targeted_reanalysis_terminal(self, request_id: str, payload: dict) -> dict:
        """Submit a terminal targeted-reanalysis state transition."""
        path = CallbackPath.TARGETED_REANALYSIS_TERMINAL.format(request_id=request_id)
        return self._post_with_retry(path, payload)

    def post_ai_usage_flow_callback(
        self, payload: AIUsageFlowCallbackPayload
    ) -> CallbackResponse:
        """Persist a governed AIUsageFlow callback."""
        path = CallbackPath.AI_USAGE_FLOW
        resp_data = self._post_with_retry(path, payload.model_dump(exclude_none=True))
        return CallbackResponse(**resp_data)

    def post_settled_usage(self, payload: SettledUsagePayload) -> CallbackResponse:
        """Submit provider-reported usage telemetry for one model invocation.

        Usage is observability only: it carries provider-reported token counts and
        is never used to reserve, price, or debit customer credits.
        """
        resp_data = self._post_with_retry(
            CallbackPath.BILLING_USAGE,
            payload.model_dump(exclude_none=True),
        )
        return CallbackResponse(**resp_data)

    def post_reconciliation_conflict_callback(
        self, payload: ConflictDetectionCallbackPayload
    ) -> CallbackResponse:
        """Persist deterministic reconciliation conflict candidates."""
        path = CallbackPath.RECONCILIATION_CONFLICT
        resp_data = self._post_with_retry(path, payload.model_dump(exclude_none=True))
        return CallbackResponse(**resp_data)

    def get_accepted_ai_usage_flow(self, ai_usage_flow_id: str) -> dict:
        """Fetch an AIUsageFlow and require an accepted/ready status."""
        path = InternalPath.AI_USAGE_FLOW.format(ai_usage_flow_id=ai_usage_flow_id)
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("AIUsageFlow response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status not in {"accepted", "ready", "ai_usage_flow_ready"}:
            raise WorkerCallbackError("AIUsageFlow is not accepted.")
        return data

    def get_accepted_technical_profile(self, technical_profile_id: str) -> dict:
        """Fetch a TechnicalProfile and require accepted status."""
        path = InternalPath.TECHNICAL_PROFILE.format(
            technical_profile_id=technical_profile_id
        )
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Technical profile response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status != "accepted":
            raise WorkerCallbackError("Technical profile is not accepted.")

        # Resolve reference file if present
        ref = data.get("profile_data_ref")
        if ref and isinstance(ref, str):
            import os
            import json
            if os.path.exists(ref):
                try:
                    with open(ref, "r") as f:
                        file_payload = json.load(f)
                        if isinstance(file_payload, dict):
                            def merge_dict(target: dict, source: dict) -> None:
                                for k, v in source.items():
                                    if k not in target or target[k] in ([], {}, None, ""):
                                        target[k] = v
                                    elif isinstance(target[k], dict) and isinstance(v, dict):
                                        merge_dict(target[k], v)
                            merge_dict(data, file_payload)
                except Exception:
                    pass
        return data

    def get_interview_worker_state(self, assessment_id: str) -> dict:
        """Fetch private worker Interview state, including guarded confirmed context."""
        path = InternalPath.INTERVIEW_WORKER_STATE.format(assessment_id=assessment_id)
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Interview worker state response was invalid.")
        return data

    def get_interview_private_context(
        self,
        assessment_id: str,
        context_revision: int,
        *,
        source_version: str | None = None,
        pge_version: str | None = None,
    ) -> dict:
        """Fetch governed private Interview context for a worker resume command."""
        path = InternalPath.INTERVIEW_PRIVATE_CONTEXT.format(
            assessment_id=assessment_id,
            context_revision=context_revision,
        )
        params = {
            key: value
            for key, value in {
                "source_version": source_version,
                "pge_version": pge_version,
            }.items()
            if value
        }
        data = self._get_with_retry(path, params=params)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Interview private context response was invalid.")
        return data

    def post_interview_agent_decision(self, assessment_id: str, payload: dict) -> dict:
        """Persist a guarded Interview Agent decision through the internal API."""
        path = InternalPath.INTERVIEW_AGENT_DECISION.format(
            assessment_id=assessment_id,
        )
        data = self._post_with_retry(path, payload, redact=False)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Interview Agent decision response was invalid.")
        return data

    def post_interview_initial_question(self, assessment_id: str, payload: dict) -> dict:
        """Persist an Interview Agent-authored initial question through the internal API."""
        path = InternalPath.INTERVIEW_INITIAL_QUESTION.format(
            assessment_id=assessment_id,
        )
        data = self._post_with_retry(path, payload, redact=False)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Interview initial question response was invalid.")
        return data

    def post_assessment_ai_not_detected(self, assessment_id: str, payload: dict) -> dict:
        """End the assessment as "AI not detected"; the API re-validates the evidence."""
        path = InternalPath.ASSESSMENT_AI_NOT_DETECTED.format(assessment_id=assessment_id)
        data = self._post_with_retry(path, payload, redact=False)
        if not isinstance(data, dict):
            raise WorkerCallbackError("AI not detected response was invalid.")
        return data

    def post_interview_targeted_need(self, assessment_id: str, payload: dict) -> dict:
        """Register one BusinessContextNeed (needId, engineeringRuleId, criterionId, question,
        observation, resolutionCriterionIds, evidenceRefs, contextRevision)."""
        path = InternalPath.INTERVIEW_TARGETED_NEED.format(assessment_id=assessment_id)
        data = self._post_with_retry(path, payload, redact=False)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Interview targeted need response was invalid.")
        return data

    def put_rule_assessment(
        self, assessment_id: str, engineering_rule_id: str, payload: dict
    ) -> dict:
        """Upsert the accepted per-rule assessment (RuleEvidenceIndex ledger row)."""
        path = InternalPath.RULE_ASSESSMENT.format(
            assessment_id=assessment_id, engineering_rule_id=engineering_rule_id
        )
        data = self._post_with_retry(path, payload, redact=False, method="PUT")
        if not isinstance(data, dict):
            raise WorkerCallbackError("Rule assessment response was invalid.")
        return data

    def list_rule_assessments(self, assessment_id: str) -> list[dict]:
        """List accepted per-rule assessments for one assessment."""
        path = InternalPath.RULE_ASSESSMENTS.format(assessment_id=assessment_id)
        data = self._get_with_retry(path)
        if not isinstance(data, list):
            raise WorkerCallbackError("Rule assessments response was invalid.")
        return [item for item in data if isinstance(item, dict)]

    def dispatch_agentic_tool(self, payload: dict) -> dict:
        """Dispatch one already validated/authorized agentic tool to the trusted API."""
        path = InternalPath.AGENTIC_TOOL_DISPATCH
        data = self._post_with_retry(path, payload)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Agentic tool dispatch response was invalid.")
        return data

    def create_targeted_reanalysis_request(self, payload: dict) -> dict:
        """Create a targeted-reanalysis lifecycle request through the runtime bridge."""
        path = InternalPath.TARGETED_REANALYSIS_CREATE
        data = self._post_with_retry(path, payload)
        if not isinstance(data, dict):
            raise WorkerCallbackError(
                "Targeted reanalysis runtime response was invalid."
            )
        return data

    def resume_waiting_runs(self, corpus_version_id: str, payload: dict) -> dict:
        """Ask the API to resume workflows waiting on a legal corpus version."""
        path = (
            f"/internal/legal-rule-catalog/corpus/{corpus_version_id}"
            "/resume-waiting-runs"
        )
        data = self._post_with_retry(path, payload)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Resume waiting runs response was invalid.")
        return data

    def ingest_validated_legal_corpus_draft(self, payload: dict) -> dict:
        """Submit a validated legal-corpus draft for server-side persistence."""
        data = self._post_with_retry(
            "/internal/legal-rule-catalog/corpus/validated-draft",
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus ingest response was invalid.")
        return data

    def recover_legal_rules_from_active_corpus(self, payload: dict) -> dict:
        """Create approved LegalRule source rows from active corpus candidate chunks."""
        data = self._post_with_retry(
            "/internal/legal-rule-catalog/rules/recover-from-active-corpus",
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal rule recovery response was invalid.")
        return data

    def register_validated_retrieval_index(
        self, corpus_version_id: str, payload: dict
    ) -> dict:
        """Register a validated retrieval index against its pinned corpus version."""
        data = self._post_with_retry(
            (
                f"/internal/legal-rule-catalog/corpus/{corpus_version_id}"
                "/retrieval-indexes/validated"
            ),
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Retrieval index response was invalid.")
        return data

    def activate_validated_corpus_version(
        self, corpus_version_id: str, payload: dict
    ) -> dict:
        """Activate a corpus version only after its validation/index pipeline succeeds."""
        data = self._post_with_retry(
            (
                f"/internal/legal-rule-catalog/corpus/{corpus_version_id}"
                "/activate-validated"
            ),
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus activation response was invalid.")
        return data

    def complete_legal_corpus_preparation(self, corpus_version_id: str, payload: dict) -> dict:
        """Report governed preparation completion without exposing worker credentials."""
        path = CallbackPath.LEGAL_CORPUS_PREPARATION.format(corpus_version_id=corpus_version_id)
        data = self._post_with_retry(path, payload)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus preparation callback response was invalid.")
        return data

    def get_active_legal_rule_catalog(self) -> dict:
        """Fetch the active legal rule catalog/version metadata."""
        path = "/internal/legal-rule-catalog/active"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal rule catalog response was invalid.")
        return data

    def get_active_legal_corpus(self) -> dict:
        """Fetch metadata for the currently active legal corpus version."""
        path = "/internal/legal-rule-catalog/corpus/active"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus response was invalid.")
        return data

    def get_legal_corpus_chunks(self, corpus_version_id: str) -> dict:
        """Fetch persisted text chunks for a specific legal corpus version."""
        path = f"/internal/legal-rule-catalog/corpus/{corpus_version_id}/chunks"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus chunks response was invalid.")
        return data

    def get_official_source_snapshot(
        self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
    ) -> dict:
        """Fetch an official legal-source snapshot by immutable ref or internal ID."""
        path = InternalPath.LEGAL_SOURCE_SNAPSHOTS
        params = {}
        if snapshot_ref:
            params["snapshot_ref"] = snapshot_ref
        if snapshot_id:
            params["snapshot_id"] = snapshot_id
        data = self._get_with_retry(path, params=params)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Official source snapshot response was invalid.")
        return data

    def post_classification_callback(
        self, payload: ClassificationCallbackPayload
    ) -> CallbackResponse:
        """Persist the final classification callback result."""
        path = CallbackPath.CLASSIFICATION
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)

    def get_audit_events(
        self, from_date: str, to_date: str
    ) -> list[dict]:
        """Fetch organization audit events for an inclusive export date range."""
        path = InternalPath.AUDIT_EVENTS
        params = {"from_date": from_date, "to_date": to_date}
        data = self._get_with_retry(path, params=params)
        if not isinstance(data, list):
            raise WorkerCallbackError("Audit events response was invalid.")
        return [entry for entry in data if isinstance(entry, dict)]

    def post_audit_export_callback(
        self, export_request_id: str, payload: AuditExportCallbackPayload
    ) -> CallbackResponse:
        """Persist READY/FAILED state for an audit export request."""
        path = CallbackPath.AUDIT_EXPORT.format(export_request_id=export_request_id)
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)
