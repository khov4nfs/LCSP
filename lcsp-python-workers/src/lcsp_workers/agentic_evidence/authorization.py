from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import httpx

from .registry import AgenticToolValidationError


# Mirrors the canonical PBAC actions currently enforced by the NestJS controllers.
# Technical evidence routes accept either full or redacted evidence read authority.
TOOL_PBAC_ACTIONS: dict[str, tuple[str, ...]] = {
    "propose_gap_remediation": ("gap-remediation:propose",),
    "get_gap_evidence_trace": ("gap-evidence-trace:read",),
    "get_reconciliation_context": ("conflict:read",),
    "propose_missing_targets": ("assessment:read",),
    "get_artifact_chain": ("assessment:read",),
    "inspect_deployment_context": ("evidence:read", "evidence:read:redacted"),
    "inspect_decision_path": ("evidence:read", "evidence:read:redacted"),
    "find_similar_symbols": ("evidence:read", "evidence:read:redacted"),
    "inspect_human_review_path": ("evidence:read", "evidence:read:redacted"),
    "inspect_data_path": ("evidence:read", "evidence:read:redacted"),
    "find_provider_invocations": ("evidence:read", "evidence:read:redacted"),
    "get_finding_detail": ("evidence:read", "evidence:read:redacted"),
    "get_symbol_context": ("evidence:read", "evidence:read:redacted"),
    "get_scan_coverage": ("evidence:read", "evidence:read:redacted"),
    "search_evidence": ("evidence:read", "evidence:read:redacted"),
    "get_evidence_subgraph": ("evidence:read", "evidence:read:redacted"),
    "trace_static_flow": ("evidence:read", "evidence:read:redacted"),
}


@dataclass(frozen=True)
class AgenticAuthorizationResult:
    action: str


class AgenticToolAuthorizer(Protocol):
    def authorize(
        self,
        *,
        tool_name: str,
        user_id: str,
        organization_id: str,
        correlationId: UUID,
    ) -> AgenticAuthorizationResult: ...


class ApiPbacToolAuthorizer:
    """Re-evaluate user PBAC through the existing trusted worker preflight API."""

    def __init__(
        self,
        *,
        base_url: str,
        worker_api_key: str,
        timeout_seconds: float = 5.0,
        client: httpx.Client | None = None,
    ) -> None:
        if not base_url.strip():
            raise ValueError("base_url is required")
        if not worker_api_key.strip():
            raise ValueError("worker_api_key is required")
        self._base_url = base_url.rstrip("/")
        self._worker_api_key = worker_api_key
        self._timeout_seconds = timeout_seconds
        self._client = client

    def authorize(
        self,
        *,
        tool_name: str,
        user_id: str,
        organization_id: str,
        correlationId: UUID,
    ) -> AgenticAuthorizationResult:
        actions = TOOL_PBAC_ACTIONS.get(tool_name)
        if not actions:
            raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_ACTION_UNREGISTERED")
        if not user_id.strip() or not organization_id.strip():
            raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_CONTEXT_REQUIRED")

        last_reason: str | None = None
        for action in actions:
            decision, reason = self._preflight(
                user_id=user_id,
                organization_id=organization_id,
                action=action,
                correlationId=correlationId,
            )
            if decision == "ALLOW":
                return AgenticAuthorizationResult(action=action)
            last_reason = reason

        # Keep denial typed and safe; do not leak membership or policy internals to the LLM.
        raise AgenticToolValidationError(
            "AGENTIC_TOOL_PBAC_BLOCKED"
            if last_reason is not None
            else "AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED"
        )

    def _preflight(
        self,
        *,
        user_id: str,
        organization_id: str,
        action: str,
        correlationId: UUID,
    ) -> tuple[str, str | None]:
        payload = {
            "user_id": user_id,
            "organization_id": organization_id,
            "action": action,
            "correlationId": str(correlationId),
        }
        headers = {
            "x-worker-api-key": self._worker_api_key,
            "x-correlation-id": str(correlationId),
        }
        try:
            if self._client is not None:
                response = self._client.post(
                    f"{self._base_url}/internal/pbac/preflight",
                    json=payload,
                    headers=headers,
                    timeout=self._timeout_seconds,
                )
            else:
                response = httpx.post(
                    f"{self._base_url}/internal/pbac/preflight",
                    json=payload,
                    headers=headers,
                    timeout=self._timeout_seconds,
                )
        except httpx.RequestError as exc:
            raise AgenticToolValidationError(
                "AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED"
            ) from exc

        if response.status_code != 200:
            raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED")
        try:
            body = response.json()
        except ValueError as exc:
            raise AgenticToolValidationError(
                "AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED"
            ) from exc

        if not isinstance(body, dict):
            raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED")
        data = body.get("data") if body.get("ok") is True else body
        if not isinstance(data, dict):
            raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED")
        decision = data.get("decision")
        reason = data.get("reason_code")
        if decision not in {"ALLOW", "DENY"}:
            raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED")
        return decision, str(reason) if reason is not None else None
