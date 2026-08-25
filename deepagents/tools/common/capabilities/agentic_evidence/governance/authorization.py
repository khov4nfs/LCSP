"""Map model-callable tools to PBAC actions and authorize every invocation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import httpx

from tools.common.capabilities.platform.pbac_client import PbacClient
from ..governance.registry import AgenticToolValidationError


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
    """PBAC action that authorized a model-requested tool call."""

    action: str


class AgenticToolAuthorizer(Protocol):
    """Authorization contract applied before agentic tool dispatch."""

    def authorize(
        self,
        *,
        tool_name: str,
        user_id: str,
        organization_id: str,
        correlationId: UUID,
    ) -> AgenticAuthorizationResult:
        """Authorize one tool request within a user/organization context."""
        ...


class ApiPbacToolAuthorizer:
    """Map a native tool call to PBAC actions and fail closed on denial."""

    def __init__(
        self,
        *,
        pbac_client: PbacClient,
    ) -> None:
        """Create the API-backed authorizer.

        Args:
            pbac_client: Shared worker-side PBAC preflight transport.
        """
        self._pbac_client = pbac_client

    def authorize(
        self,
        *,
        tool_name: str,
        user_id: str,
        organization_id: str,
        correlationId: UUID,
    ) -> AgenticAuthorizationResult:
        """Authorize a cataloged model-callable tool through PBAC.

        Multiple actions may be acceptable for a tool, such as full or redacted
        evidence-read authority. The first explicit ALLOW wins; every other
        outcome fails closed using typed validation errors safe for LLM-facing
        orchestration.

        Args:
            tool_name: Registered agentic tool name.
            user_id: User/principal requesting the tool call.
            organization_id: Tenant boundary for the request.
            correlationId: End-to-end trace identifier.

        Returns:
            The PBAC action that produced an ALLOW decision.

        Raises:
            AgenticToolValidationError: If the tool is unmapped, context is
                incomplete, preflight fails, or all allowed actions are denied.
        """
        actions = TOOL_PBAC_ACTIONS.get(tool_name)
        if not actions:
            raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_ACTION_UNREGISTERED")
        if not user_id.strip() or not organization_id.strip():
            raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_CONTEXT_REQUIRED")

        for action in actions:
            try:
                decision = self._pbac_client.check(
                    user_id=user_id,
                    organization_id=organization_id,
                    action=action,
                    correlationId=str(correlationId),
                )
            except (ConnectionError, httpx.HTTPError) as exc:
                raise AgenticToolValidationError(
                    "AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED"
                ) from exc
            if decision == "allow":
                return AgenticAuthorizationResult(action=action)

        # Keep denial typed and safe; do not leak membership or policy internals to the LLM.
        raise AgenticToolValidationError("AGENTIC_TOOL_PBAC_BLOCKED")
