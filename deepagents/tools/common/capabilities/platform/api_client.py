"""Provide secret-safe, retrying access to LCSP internal read/callback APIs."""

import re
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
    SettledUsagePayload,
    AuditExportCallbackPayload,
)

logger = get_logger(__name__)

_AGENT_STREAM_NETWORK_BACKOFF_SECONDS = 2.0

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

        Client errors fail immediately; transport and 5xx failures retry up to the
        configured attempt cap.
        """
        url = f"{self._base_url}{path}"
        cid = get_correlationId()
        # Native Agent Server IDs are not assessment turn IDs; the stream callback owns that fence.
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: cid,
        }
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
                    if resp.status_code == 400 and error_code == "COMPLIANCE_RULE_SET_SUBMIT_REQUEST_INVALID" and path in (
                        InternalPath.COMPLIANCE_RULE_SET_VALIDATIONS,
                        InternalPath.COMPLIANCE_RULE_SET_SUBMISSIONS,
                    ):
                        # Return only schema paths so the author can repair shape without exposing input values.
                        problem = resp.json().get("problem")
                        meta = problem.get("meta") if isinstance(problem, dict) else None
                        issues = meta.get("issues") if isinstance(meta, dict) else None
                        if isinstance(issues, str) and len(issues) <= 4000:
                            fields = issues.split(",")
                            if len(fields) <= 20 and all(
                                re.fullmatch(r"packet(?:\.[A-Za-z][A-Za-z0-9]*|\.\d+)*", field)
                                for field in fields
                            ):
                                message += f" Invalid fields: {issues}"
                                # Schema-authored structural requirements (e.g. which field must be null),
                                # accepted only as bounded plain text so no input value can ride along.
                                requirements = meta.get("requirements")
                                if isinstance(requirements, str) and re.fullmatch(r"[A-Za-z0-9_ .,:=()|-]{1,800}", requirements):
                                    message += f" Requirements: {requirements}"
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





    def post_agent_stream_event(self, payload: dict, *, lease_token: str | None = None) -> None:
        """Submit one best-effort live agent event for the workspace chat stream."""
        now = time.monotonic()
        if now < self._agent_stream_unavailable_until:
            return
        url = f"{self._base_url}{CallbackPath.AGENT_STREAM_EVENT}"
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: get_correlationId(),
        }
        if lease_token:
            headers["x-assessment-lease"] = lease_token
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



    def ingest_validated_legal_source_draft(self, payload: dict) -> dict:
        """Submit a validated legal-source draft for server-side persistence."""
        data = self._post_with_retry(
            "/internal/legal-sources/validated-draft",
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal legal_source ingest response was invalid.")
        return data

    def register_validated_retrieval_index(
        self, legal_source_version_id: str, payload: dict
    ) -> dict:
        """Register a validated retrieval index against its pinned legal_source version."""
        data = self._post_with_retry(
            (
                f"/internal/legal-sources/{legal_source_version_id}"
                "/retrieval-indexes/validated"
            ),
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Retrieval index response was invalid.")
        return data

    def activate_validated_legal_source_version(
        self, legal_source_version_id: str, payload: dict
    ) -> dict:
        """Activate a legal_source version only after its validation/index pipeline succeeds."""
        data = self._post_with_retry(
            (
                f"/internal/legal-sources/{legal_source_version_id}"
                "/activate-validated"
            ),
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal legal_source activation response was invalid.")
        return data

    def claim_rule_set_preparation(self, preparation_run_id: str) -> dict:
        """Claim one Rule Set Preparation run; returns only its pinned legal_source bundle."""
        data = self._post_with_retry(
            InternalPath.COMPLIANCE_RULE_SET_CLAIMS,
            {"preparationRunId": preparation_run_id, "supportedExecutionContracts": ["CLAIM_INVENTORY_V1", "DIRECT_DRAFT_V1"]},
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Rule set preparation claim response was invalid.")
        return data

    def validate_compliance_rule_set(self, preparation_run_id: str, packet: dict) -> dict:
        """Dry-run mechanical validation of a complete rule set packet."""
        data = self._post_with_retry(
            InternalPath.COMPLIANCE_RULE_SET_VALIDATIONS,
            {"preparationRunId": preparation_run_id, "packet": packet},
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Compliance rule set validation response was invalid.")
        return data

    def source_review_operation(self, preparation_run_id: str, revision: int, action: str, **fields) -> dict:
        data = self._post_with_retry(InternalPath.COMPLIANCE_RULE_SET_SOURCE_REVIEWS,
            {"preparationRunId": preparation_run_id, "inventoryRevision": revision, "action": action, **fields}, redact=False)
        if not isinstance(data, dict): raise WorkerCallbackError("Source review response was invalid")
        return data

    def start_claim_discovery_diagnostic(self, legal_source_version_id: str, idempotency_key: str) -> dict:
        return self._post_with_retry(InternalPath.COMPLIANCE_RULE_SET_DISCOVERY_DIAGNOSTICS,
            {"legalSourceVersionId": legal_source_version_id, "idempotencyKey": idempotency_key}, redact=False)

    def claim_inventory_operation(self, preparation_run_id: str, action: str, revision: int, **fields) -> dict:
        """Validate/freeze/reopen the one Preparation's claim inventory; never creates a Preparation."""
        data = self._post_with_retry(
            InternalPath.COMPLIANCE_RULE_SET_CLAIM_INVENTORIES,
            {"preparationRunId": preparation_run_id, "action": action, "revision": revision, **fields},
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Claim inventory response was invalid.")
        return data

    def submit_compliance_rule_set(
        self, preparation_run_id: str, idempotency_key: str, packet: dict
    ) -> dict:
        """Submit one complete rule_set: validate and atomically activate."""
        data = self._post_with_retry(
            InternalPath.COMPLIANCE_RULE_SET_SUBMISSIONS,
            {
                "preparationRunId": preparation_run_id,
                "idempotencyKey": idempotency_key,
                "packet": packet,
            },
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Compliance rule set submission response was invalid.")
        return data

    def fail_rule_set_preparation(self, preparation_run_id: str, reason: str) -> dict:
        """Record that a Rule Set Preparation execution could not produce a submission."""
        data = self._post_with_retry(
            InternalPath.COMPLIANCE_RULE_SET_FAILURES,
            {"preparationRunId": preparation_run_id, "reason": reason},
            redact=False,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Rule set preparation failure response was invalid.")
        return data

    def get_active_compliance_rule_set(self) -> dict:
        """Fetch the single ACTIVE compliance rule set (the only runtime reader)."""
        data = self._get_with_retry(InternalPath.COMPLIANCE_RULE_SET_ACTIVE)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Compliance rule set response was invalid.")
        return data

    def get_active_legal_source(self) -> dict:
        """Fetch metadata for the currently active legal legal_source version."""
        path = "/internal/legal-sources/active"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal legal_source response was invalid.")
        return data

    def get_legal_source_chunks(self, legal_source_version_id: str) -> dict:
        """Fetch persisted text chunks for a specific legal legal_source version."""
        path = f"/internal/legal-sources/{legal_source_version_id}/chunks"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal legal_source chunks response was invalid.")
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
