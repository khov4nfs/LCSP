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

    def _call(self, method: str, path: str, body: Any = None, *, with_lease: bool = True) -> Any:
        url = f"{self._base}/internal/assessment-runtime/{self.assessment_id}{path}"
        response = httpx.request(
            method,
            url,
            json=body,
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
        self.assessment_id = assessment_id
        claim = self._call("POST", "/claim", with_lease=False)
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

    def portfolio(self) -> dict[str, Any]:
        return self._call("GET", "/portfolio")

    # ---- governed writes -----------------------------------------------------------------------

    def post_evidence(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/evidence", body)

    def post_fact(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/facts", body)

    def start_investigation(self, engineering_rule_id: str) -> dict[str, Any]:
        return self._call("POST", "/investigations", {"engineeringRuleId": engineering_rule_id})

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
