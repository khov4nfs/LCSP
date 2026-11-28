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

    def claim_selected_rule_preparation(self, run_id: str) -> dict:
        """Business purpose: Claim one selected Preparation revision before paid execution.

        Business rules:

        - API ownership/state and pinned-source validation are authoritative; duplicate claims must not invoke a model.
        Execution flow:
        1. POST the exact run identity through the existing retrying authenticated adapter.
        Failure cases:
        - Permanent claim conflicts propagate without paid work.
        Side effects:
        - Claims one API-owned run; no model call occurs here.
        """
        return self._post_with_retry("/internal/legal-rule-preparation/claim", {"preparationRunId": run_id}, redact=False)

    def record_selected_rule_instructions(self, run_id: str, receipt: dict) -> dict:
        """Business purpose: Persist the exact instruction snapshot before selected-rule inference.

        Business rules:

        - The API validates the byte fingerprint and permits only an identical receipt replay.
        Execution flow:
        1. Send the server-issued run identity and exact instruction receipt.
        Failure cases:
        - State drift or conflicting instructions stops execution through WorkerCallbackError.
        Side effects:
        - Persists this result revision's instruction provenance; no provider call.
        """
        return self._post_with_retry("/internal/legal-rule-preparation/instructions", {"preparationRunId": run_id, "receipt": receipt}, redact=False)

    def complete_selected_rule_preparation(self, run_id: str, state: str, output: dict | None, failure_code: str | None) -> dict:
        """Business purpose: Settle one selected rule result independently from the rest of its batch.

        Business rules:

        - Preserve exact legal output for API validation; this shared adapter retries transport, never model work.
        Execution flow:
        1. Submit the outcome, output and safe failure code through the existing callback adapter.
        Failure cases:
        - Invalid provenance, stale state or conflicting callback replays reject.
        Side effects:
        - Persists one result and run outcome through the authoritative API.
        """
        return self._post_with_retry("/internal/legal-rule-preparation/complete", {"preparationRunId": run_id, "executionState": state, "output": output, "failureCode": failure_code}, redact=False)

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

    def request_invocation_admission(self, payload: dict) -> dict:
        """Business purpose: Request server-issued admission for a billable invocation before provider dispatch.

        Business rules:
        - Payload contains logicalOperationId, runId, requestedProvider, requestedModel, etc.
        - Fails closed with WorkerCallbackError on HTTP 402 PAYMENT_REQUIRED, 429/409 concurrency limit, or 403 context mismatch.
        - Retries and lost responses may return an existing admission with capabilityToken.
        Execution flow:
        1. POST to /internal/billing/admission/request.
        2. Unwrap and return admission response dictionary.
        Failure cases:
        - Network/server errors retry; client errors (402, 409, 429) raise WorkerCallbackError immediately.
        Side effects:
        - Reserves an admission slot on the server; zero provider calls made here.
        """
        # Why: Guarantees server admission authorization before sending tokens to external LLM provider.
        # How: Sends request payload to internal admission endpoint with worker API key and correlation tracking.
        # Invariants & Constraints: Client errors (402, 429, 409) fail closed without provider dispatch.
        return self._post_with_retry(
            "/internal/billing/admission/request",
            payload,
            redact=False,
        )

    def consume_invocation_admission(self, payload: dict) -> dict:
        """Business purpose: Perform atomic CAS ADMITTED -> IN_FLIGHT transition committing capability token.

        Business rules:
        - Payload contains admissionId, invocationId, capabilityToken.
        - Fails closed with WorkerCallbackError on 422 capability mismatch or expiration.
        Execution flow:
        1. POST to /internal/billing/admission/consume.
        2. Unwrap and return consume response dictionary.
        Failure cases:
        - 422 capability mismatch or expired raises WorkerCallbackError; provider dispatch must be aborted.
        Side effects:
        - Moves admission state to IN_FLIGHT on the server.
        """
        # Why: Prevents unauthorized provider calls by committing the capability token via server CAS.
        # How: Sends admissionId, invocationId, and capabilityToken to internal consume endpoint.
        # Invariants & Constraints: 422 failure stops execution with zero provider bytes sent.
        return self._post_with_retry(
            "/internal/billing/admission/consume",
            payload,
            redact=False,
        )

    def cancel_invocation_admission(self, payload: dict) -> dict:
        """Business purpose: Cancel an unconsumed admission before physical provider dispatch or during crash recovery.

        Business rules:
        - Payload contains admissionId, invocationId, capabilityToken, cancellationReason.
        - Fails with 409 Conflict if admission has already transitioned to IN_FLIGHT.
        - Fails with 422 if capabilityToken digest does not match or admission is in an invalid state.

        Execution flow:
        1. POST to /internal/billing/admission/cancel.
        2. Unwrap and return cancel response dictionary.

        Failure cases:
        - 409 Conflict if already IN_FLIGHT.
        - 422 Unprocessable if capability mismatch or invalid state.

        Side effects:
        - Transitions admission state to CONFIRMED_NO_USAGE and releases concurrency slot on server.
        """
        # Why: Allows crash recovery and orchestrators to release reserved slots without incurring usage charges.
        # How: Sends admissionId, invocationId, capabilityToken, and reason to /internal/billing/admission/cancel.
        # Invariants & Constraints: Atomic CAS ensures cancellation only succeeds if admission is currently ADMITTED.
        return self._post_with_retry(
            "/internal/billing/admission/cancel",
            payload,
            redact=False,
        )

    def heartbeat_invocation_admission(self, payload: dict) -> dict:
        """Business purpose: Renew in-flight lease deadline on the server while model inference is actively running.

        Business rules:
        - Payload contains admissionId, invocationId, capabilityToken, optional extensionSeconds.
        - Silently ignores non-fatal network or retryable errors so model inference is not aborted.
        Execution flow:
        1. POST to /internal/billing/admission/heartbeat.
        2. Unwrap and return heartbeat response dictionary.
        Failure cases:
        - Network/server errors propagate or are handled gracefully by telemetry thread.
        Side effects:
        - Extends inFlightLeaseExpiresAt on the server.
        """
        # Why: Extends server in-flight lease to prevent premature sweeps during long-running inferences.
        # How: Sends heartbeat payload with capability token to internal heartbeat endpoint.
        # Invariants: Non-blocking background call; fails gracefully without aborting inference.
        return self._post_with_retry(
            "/internal/billing/admission/heartbeat",
            payload,
            redact=False,
        )

    def settle_invocation_usage(self, payload: dict) -> dict:
        """Business purpose: Settle physical LLM invocation usage or report failure/timeout to authoritative billing endpoint.

        Business rules:
        - Must target /internal/billing/usage/settle, NOT legacy telemetry /internal/billing/usage.
        - Payload contains admissionId, invocationId, capabilityToken, attemptOrdinal, providerCompletionState, and optional token buckets.
        - Fails closed on HTTP 422 capability mismatch or invalid contract payload.
        Execution flow:
        1. POST to /internal/billing/usage/settle with Bearer authentication and correlation tracking.
        2. Unwrap and return settlement response dictionary.
        Failure cases:
        - 404/422 errors propagate immediately as WorkerCallbackError.
        Side effects:
        - Commits final usage receipt, releases admission concurrency slot on server, and records financial debit or shadow pricing.
        """
        # Why: Authoritative settlement contract requires capability token to release slot and transition to SETTLED or OUTCOME_UNKNOWN.
        # How: Sends billableInvocationSettlementRequest to /internal/billing/usage/settle and unwrap response envelope.
        # Invariants & Constraints: Distinct from legacy post_settled_usage telemetry; requires valid capabilityToken.
        return self._post_with_retry(
            "/internal/billing/usage/settle",
            payload,
            redact=False,
        )



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
        """Claim one Rule Set Preparation run; returns only its pinned legal_source bundle.

        Business purpose: Request the pinned source bundle for an existing Rule Set Preparation execution.

        Business rules:
        - The run identifier is supplied to the canonical claim endpoint; the API owns run eligibility, authorization, and pin validation.
        - The request advertises only the worker's supported `CLAIM_INVENTORY_V1` and `DIRECT_DRAFT_V1` execution contracts.
        - Claiming returns the existing run's pinned source context and does not create a Preparation.

        Execution flow:
        1. POST the run identifier and supported execution contracts to the internal Preparation claims route.
        2. Return the unwrapped response only when its data is a dictionary.

        Failure cases:
        - API client, stale execution, cancellation, and response-contract failures propagate as WorkerCallbackError or the active-execution boundary error.
        - A non-dictionary claim response raises WorkerCallbackError instead of fabricating a source bundle.

        Side effects:
        - Sends an authenticated internal API request and may claim the existing run through the server; it performs no local Preparation creation.
        """
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
        """Business purpose: Submit one source-review frontier action against a specific Rule Set Preparation inventory revision.

        Business rules:
        - The supplied run, revision, action, and fields are passed to the canonical API; the server validates eligibility, pins, payload shape, and allowed state transitions.
        - This client does not interpret a review result or retry a rejected client request.

        Execution flow:
        1. Build the operation payload from the Preparation identifier, inventory revision, action, and supplied fields.
        2. POST it without generic payload redaction so source-grounded values reach the API unchanged.
        3. Return a dictionary result, or fail when the response violates that contract.

        Failure cases:
        - API 4xx and response-shape errors raise WorkerCallbackError; network and server failures use the shared bounded retry policy.
        - A business rejection returned as a valid dictionary remains an explicit operation result for the caller to handle.

        Side effects:
        - Sends an authenticated internal API request that may transactionally update the run's review frontier; the client has no local state mutation.
        """
        data = self._post_with_retry(InternalPath.COMPLIANCE_RULE_SET_SOURCE_REVIEWS,
            {"preparationRunId": preparation_run_id, "inventoryRevision": revision, "action": action, **fields}, redact=False)
        if not isinstance(data, dict): raise WorkerCallbackError("Source review response was invalid")
        return data

    def start_claim_discovery_diagnostic(self, legal_source_version_id: str, idempotency_key: str) -> dict:
        """Business purpose: Request an idempotent, source-only claim-discovery diagnostic for one Legal Source Version.

        Business rules:
        - The API requires its diagnostic feature flag, an explicitly allowed isolated database, an existing materialized source graph, and a source-bound idempotency key.
        - This endpoint is diagnostic-only and cannot create paid Preparation work or author Rules.
        - Environment and graph eligibility are enforced by the server; this client only forwards the version and idempotency key.

        Execution flow:
        1. POST the Legal Source Version identifier and idempotency key to the discovery-diagnostics endpoint.
        2. Return the unwrapped server response to the caller.

        Failure cases:
        - Server-side diagnostic rejection is returned as a normal diagnostic result; transport and API client failures follow the shared retry/error policy.

        Side effects:
        - Sends an authenticated internal API request; an eligible server may create or reuse an isolated diagnostic run and return source graph/chunk context.
        """
        return self._post_with_retry(InternalPath.COMPLIANCE_RULE_SET_DISCOVERY_DIAGNOSTICS,
            {"legalSourceVersionId": legal_source_version_id, "idempotencyKey": idempotency_key}, redact=False)

    def claim_inventory_operation(self, preparation_run_id: str, action: str, revision: int, **fields) -> dict:
        """Validate/freeze/reopen the one Preparation's claim inventory; never creates a Preparation.

        Business purpose: Submit a claim-inventory lifecycle action for an existing Rule Set Preparation.

        Business rules:
        - Every operation is bound to the supplied Preparation identifier and inventory revision; the API validates the action and state transition.
        - Stale revisions and invalid action payloads remain explicit server rejections; this method never creates a Preparation.
        - Additional operation fields are forwarded without generic payload redaction.

        Execution flow:
        1. Build the operation payload from run identity, action, revision, and action-specific fields.
        2. POST to the claim-inventory route and return the unwrapped result only when it is a dictionary.

        Failure cases:
        - API 4xx, active-execution interruption, and invalid response shape propagate as errors; network and 5xx failures use the shared bounded retry policy.
        - A valid dictionary describing a rejected inventory operation is returned unchanged for caller recovery.

        Side effects:
        - Sends an authenticated internal API request that may load, validate, freeze, reopen, or update the existing run's inventory through the server.
        """
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
