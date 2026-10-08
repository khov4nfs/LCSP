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

    def dispatch_agentic_tool(self, payload: dict) -> dict:
        """Dispatch one already validated/authorized agentic tool to the trusted API."""
        path = InternalPath.AGENTIC_TOOL_DISPATCH
        data = self._post_with_retry(path, payload)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Agentic tool dispatch response was invalid.")
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

    def start_legal_preparation(
        self, legal_corpus_version_id: str, idempotency_key: str
    ) -> dict:
        """Idempotently start one Legal Preparation run for one pinned corpus."""
        data = self._post_with_retry(
            InternalPath.LEGAL_PORTFOLIO_PREPARATIONS,
            {
                "legalCorpusVersionId": legal_corpus_version_id,
                "idempotencyKey": idempotency_key,
            },
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal preparation start response was invalid.")
        return data

    def claim_legal_preparation(self, preparation_run_id: str) -> dict:
        """Claim one Legal Preparation run; returns only its pinned corpus bundle."""
        data = self._post_with_retry(
            InternalPath.LEGAL_PORTFOLIO_CLAIMS,
            {"preparationRunId": preparation_run_id},
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal preparation claim response was invalid.")
        return data

    def validate_legal_portfolio(self, preparation_run_id: str, packet: dict) -> dict:
        """Dry-run mechanical validation of a complete portfolio packet."""
        data = self._post_with_retry(
            InternalPath.LEGAL_PORTFOLIO_VALIDATIONS,
            {"preparationRunId": preparation_run_id, "packet": packet},
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal portfolio validation response was invalid.")
        return data

    def submit_legal_portfolio(
        self, preparation_run_id: str, idempotency_key: str, packet: dict
    ) -> dict:
        """Submit one complete portfolio: validate and atomically activate."""
        data = self._post_with_retry(
            InternalPath.LEGAL_PORTFOLIO_SUBMISSIONS,
            {
                "preparationRunId": preparation_run_id,
                "idempotencyKey": idempotency_key,
                "packet": packet,
            },
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal portfolio submission response was invalid.")
        return data

    def fail_legal_preparation(self, preparation_run_id: str, reason: str) -> dict:
        """Record that a Legal Preparation execution could not produce a submission."""
        data = self._post_with_retry(
            InternalPath.LEGAL_PORTFOLIO_FAILURES,
            {"preparationRunId": preparation_run_id, "reason": reason},
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal preparation failure response was invalid.")
        return data

    def get_active_legal_portfolio(self) -> dict:
        """Fetch the single ACTIVE legal portfolio (the only runtime reader)."""
        data = self._get_with_retry(InternalPath.LEGAL_PORTFOLIO_ACTIVE)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal portfolio response was invalid.")
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
