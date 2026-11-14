"""Worker HTTP adapter for the Assessment Root tool plane (``/internal/assessment-runtime``).

Identity is never supplied by the agent: the API issues ``threadId``/``executionId`` and a
lease at claim time, and every later call presents only that lease. Problem metadata is kept
(unlike the generic callback client) because DecisionValidator failures are the model's
correction feedback.
"""

from __future__ import annotations

import time
import uuid
from typing import Any
from urllib.parse import quote

import httpx

WORKER_KEY_HEADER = "x-worker-api-key"
LEASE_HEADER = "x-assessment-lease"
CORRELATION_HEADER = "x-correlation-id"


class AssessmentApiError(Exception):
    """A rejected governed call. ``code`` is the stable problem code; ``meta`` is scalar-only."""

    def __init__(self, status: int, code: str, meta: dict[str, Any] | None = None) -> None:
        super().__init__(f"{code} ({status})")
        self.status = status
        self.code = code
        self.meta = dict(meta or {})

    @property
    def retryable(self) -> bool:
        return self.status >= 500 or self.status == 429


class AssessmentRuntimeClient:
    def __init__(self, base_url: str, worker_key: str, *, timeout: float = 30.0) -> None:
        self._base = base_url.rstrip("/")
        self._worker_key = worker_key
        self._timeout = timeout
        self.assessment_id: str | None = None
        self.lease_token: str | None = None

    # ---- transport -----------------------------------------------------------------------------

    def _headers(self, *, with_lease: bool) -> dict[str, str]:
        headers = {
            WORKER_KEY_HEADER: self._worker_key,
            CORRELATION_HEADER: str(uuid.uuid4()),
        }
        if with_lease and self.lease_token:
            headers[LEASE_HEADER] = self.lease_token
        return headers

    def _call(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        with_lease: bool = True,
        params: dict[str, str] | None = None,
    ) -> Any:
        """Business purpose: Transport an Assessment Root operation through the server-governed worker API and return its envelope data.

        Business rules:
        - Use the client's Assessment identity and worker authentication; include its execution lease only when requested.
        - Retry read-only GET/HEAD failures (HTTP 5xx, 429, timeouts and network errors) up to three attempts with exponential backoff.
        - Send each mutation once: a lost response can follow a committed lease or domain write, so generic transport retry cannot prove replay safety.

        Execution flow:
        1. Send the method, body and query with governed headers and the configured timeout.
        2. Back off and retry transient read failures within the bounded attempt count; propagate mutation failures for authoritative recovery.
        3. Parse the JSON envelope, raise AssessmentApiError for non-retryable failures or exhausted retries, then return data.

        Failure cases:
        - Mutation transport failures propagate immediately; read failures propagate after bounded retries.
        - Invalid response JSON becomes an empty payload, and reported API failures preserve the server-supplied code and dictionary metadata without additional redaction here.

        Side effects:
        - Performs an HTTP request whose domain effects are determined by the selected endpoint; creates a correlation header on each attempt.
        """
        url = f"{self._base}/internal/assessment-runtime/{self.assessment_id}{path}"
        max_attempts = 3 if method.upper() in {"GET", "HEAD"} else 1
        for attempt in range(max_attempts):
            try:
                response = httpx.request(
                    method,
                    url,
                    json=body,
                    params=params,
                    headers=self._headers(with_lease=with_lease),
                    timeout=self._timeout,
                )
                try:
                    payload = response.json()
                except ValueError:
                    payload = {}
                if response.status_code >= 400 or not isinstance(payload, dict) or payload.get("ok") is False:
                    problem = payload.get("problem", {}) if isinstance(payload, dict) else {}
                    err = AssessmentApiError(
                        response.status_code,
                        str(problem.get("code") or f"HTTP_{response.status_code}"),
                        problem.get("meta") if isinstance(problem.get("meta"), dict) else {},
                    )
                    if attempt < max_attempts - 1 and err.retryable:
                        time.sleep(1.0 * (2 ** attempt))
                        continue
                    raise err
                return payload.get("data")
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt < max_attempts - 1:
                    time.sleep(1.0 * (2 ** attempt))
                    continue
                raise

    # ---- lifecycle of one Root execution -------------------------------------------------------

    def claim(self, assessment_id: str) -> dict[str, Any]:
        """Business purpose: Claim the canonical Root only within this native server's physical authority.

        Business rules:
        - The API validates both physical run and incarnation; an old or missing owner cannot reclaim a replacement lease.
        Execution flow:
        1. Bind this client to the Assessment and transmit the native execution context.
        2. Retain only the API-issued lease for subsequent Root operations.
        Failure cases:
        - API ownership, capacity and lifecycle problems propagate without starting investigation.
        Side effects:
        - Requests the existing transactional lease; creates no model call or decision.
        """
        from orchestration.runtime_control import active_runtime_run_id, active_runtime_incarnation_id

        self.assessment_id = assessment_id
        runtime_run_id = active_runtime_run_id.get()
        body = {"runtimeRunId": runtime_run_id} if runtime_run_id else {}
        incarnation_id = active_runtime_incarnation_id.get()
        if incarnation_id:
            body["runtimeIncarnationId"] = incarnation_id
        claim = self._call("POST", "/claim", body, with_lease=False)
        self.lease_token = claim["leaseToken"]
        return claim

    def heartbeat(self) -> dict[str, Any]:
        return self._call("POST", "/heartbeat")

    def finish(self, state: str, *, checkpoint_id: str | None = None, request_ids: list[str] | None = None, control_request_id: str | None = None, recovery_required: bool = False, reason: str | None = None) -> dict[str, Any]:
        """Business purpose: Settle one leased Root segment, retaining uncertain work for operator recovery.

        Business rules:
        - The API owns transitions and native checkpoint validation; recovery quarantine is permitted only for FAILED.
        Execution flow:
        1. Submit the terminal state and any checkpoint/control/human bindings with the current lease.
        2. Clear the local token only after the API accepts settlement.
        Failure cases:
        - Stale leases and invalid state/checkpoint combinations propagate without local success.
        Side effects:
        - Settles runtime/event records and optional durable DLQ quarantine; never releases physical occupancy itself.
        """
        body: dict[str, Any] = {"state": state}
        if recovery_required:
            body["recoveryRequired"] = True
        if checkpoint_id is not None:
            body["checkpointId"] = checkpoint_id
        if request_ids is not None:
            body["requestIds"] = request_ids
        if control_request_id is not None:
            body["controlRequestId"] = control_request_id
        if reason is not None:
            body["reason"] = reason
        result = self._call("POST", "/finish", body)
        self.lease_token = None
        return result

    # ---- reads ---------------------------------------------------------------------------------

    def context(self) -> dict[str, Any]:
        return self._call("GET", "/context")

    def root_control(self) -> dict[str, Any] | None:
        return self._call("GET", "/control")

    def rule_set(self) -> dict[str, Any]:
        return self._call("GET", "/rule-set")

    def rule_decisions(self, rule_id: str, revision: int | None = None) -> dict[str, Any]:
        """Business purpose: Reload one model-authored decision packet for investigation or revision review.

        Business rules:
        - The worker lease scopes the read to this Assessment and pinned Rule Set; omitted revision selects the newest record.
        - Historical states and packet content remain server-owned and are never changed by this read.

        Execution flow:
        1. Encode the rule identifier and, when provided, request its exact decision revision.
        2. Return the bounded server result through the shared authenticated request path.

        Failure cases:
        - Invalid queries, stale leases, API failures and transport errors use the existing request failure behavior.

        Side effects:
        - Read-only HTTP retrieval; no decisions, evidence, facts or revision caches are changed.
        """
        return self._call("GET", f"/decisions/{quote(rule_id, safe='')}",
                          params={"revision": str(revision)} if revision is not None else None)

    def legal_source_text(self, document_id: str, locator: str) -> dict[str, Any]:
        """One provision of the Legal Source Version the pinned rule set was prepared from.

        Business purpose: Retrieve a provision from the Legal Source Version pinned by this Assessment's Rule Set.

        Business rules:
        - Send document identity and locator to the leased server endpoint; the server owns pin and authorization validation.

        Execution flow:
        1. Issue the governed GET request for the specified document and locator and return its legal-source payload.

        Failure cases:
        - Missing provisions, stale leases and other HTTP or transport failures propagate through the shared client.

        Side effects:
        - Read-only HTTP retrieval; no legal interpretation or source mutation occurs.
        """
        return self._call("GET", "/legal-source/text", params={"documentId": document_id, "locator": locator})

    def legal_source_search(self, query: str) -> dict[str, Any]:
        """Keyword search over that same pinned Legal Source Version.

        Business purpose: Search legal text within the Legal Source Version pinned to this Assessment.

        Business rules:
        - The server constrains the search to the Assessment pins; a search result does not establish legal applicability.

        Execution flow:
        1. Send the query to the governed pinned-source search endpoint and return its result.

        Failure cases:
        - API validation, authentication and transport failures propagate through the shared request path.

        Side effects:
        - Read-only HTTP search without changing legal sources, facts or decisions.
        """
        return self._call("GET", "/legal-source/search", params={"query": query})

    # ---- governed writes -----------------------------------------------------------------------

    def post_evidence(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/evidence", body)

    def post_fact(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/facts", body)

    def start_investigation(self, assessment_rule_id: str) -> dict[str, Any]:
        return self._call("POST", "/investigations", {"assessmentRuleId": assessment_rule_id})

    def post_decision(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/decisions", body)

    def post_human_request(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/human-requests", body)

    def post_human_requests_batch(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Transport an atomic batch of human resolution requests to the governed API.

        Business rules:
        - The batch must contain between 1 and 20 requests anchored to valid criteria or conditions.
        - The request is a mutation sent with current execution lease and case revision authority.

        Execution flow:
        1. Dispatch POST /human-requests/batch with worker auth and lease headers.
        2. Unmarshal the server response envelope and return created or replayed request records.

        Failure cases:
        - Validation errors, revision conflicts, or lease expiration raise AssessmentApiError.

        Side effects:
        - Persists human requests in the API database and triggers state transitions.
        """
        return self._call("POST", "/human-requests/batch", body)

    def report_unresolvable_human_fact(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/human-fact-unresolvable", body)

    def request_finalization(self) -> dict[str, Any]:
        return self._call("POST", "/finalization", {})

    def post_final_report(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/final-report", body)

    def post_activity(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/activity", body)
