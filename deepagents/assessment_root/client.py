"""Worker HTTP adapter for the Assessment Root tool plane (``/internal/assessment-runtime``).

Identity is never supplied by the agent: the API issues ``threadId``/``executionId`` and a
lease at claim time, and every later call presents only that lease. Problem metadata is kept
(unlike the generic callback client) because DecisionValidator failures are the model's
correction feedback.
"""

from __future__ import annotations

import uuid
from typing import Any

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

        Execution flow:
        1. Send the method, body and query with governed headers and the configured timeout.
        2. Parse the JSON envelope, raise AssessmentApiError for HTTP/error-envelope or non-object failures, then return data.

        Failure cases:
        - Transport/timeouts propagate; invalid response JSON becomes an empty payload, and reported API failures preserve the server-supplied code and dictionary metadata without additional redaction here.

        Side effects:
        - Performs an HTTP request whose domain effects are determined by the selected endpoint; creates a correlation header.
        """
        url = f"{self._base}/internal/assessment-runtime/{self.assessment_id}{path}"
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
            raise AssessmentApiError(
                response.status_code,
                str(problem.get("code") or f"HTTP_{response.status_code}"),
                problem.get("meta") if isinstance(problem.get("meta"), dict) else {},
            )
        return payload.get("data")

    # ---- lifecycle of one Root execution -------------------------------------------------------

    def claim(self, assessment_id: str) -> dict[str, Any]:
        from orchestration.runtime_control import active_runtime_run_id

        self.assessment_id = assessment_id
        runtime_run_id = active_runtime_run_id.get()
        claim = self._call("POST", "/claim", {"runtimeRunId": runtime_run_id} if runtime_run_id else {}, with_lease=False)
        self.lease_token = claim["leaseToken"]
        return claim

    def heartbeat(self) -> dict[str, Any]:
        return self._call("POST", "/heartbeat")

    def finish(self, state: str, *, checkpoint_id: str | None = None, request_ids: list[str] | None = None, control_request_id: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"state": state}
        if checkpoint_id is not None:
            body["checkpointId"] = checkpoint_id
        if request_ids is not None:
            body["requestIds"] = request_ids
        if control_request_id is not None:
            body["controlRequestId"] = control_request_id
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

    def report_unresolvable_human_fact(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/human-fact-unresolvable", body)

    def request_finalization(self) -> dict[str, Any]:
        return self._call("POST", "/finalization", {})

    def post_final_report(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/final-report", body)

    def post_activity(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/activity", body)
