"""Map model-callable tools to RBAC roles and authorize every invocation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import httpx

from tools.common.capabilities.platform.rbac_client import RbacClient
from ..governance.registry import AgenticToolValidationError


TOOL_RBAC_ROLES: dict[str, tuple[str, ...]] = {
    "propose_gap_remediation": ("CUSTOMER",),
    "get_gap_evidence_trace": ("CUSTOMER",),
    "get_reconciliation_context": ("CUSTOMER",),
    "propose_missing_targets": ("CUSTOMER",),
    "get_artifact_chain": ("CUSTOMER",),
    "inspect_deployment_context": ("CUSTOMER",),
    "inspect_decision_path": ("CUSTOMER",),
    "find_similar_symbols": ("CUSTOMER",),
    "inspect_human_review_path": ("CUSTOMER",),
    "inspect_data_path": ("CUSTOMER",),
    "find_provider_invocations": ("CUSTOMER",),
    "get_finding_detail": ("CUSTOMER",),
    "get_symbol_context": ("CUSTOMER",),
    "get_scan_coverage": ("CUSTOMER",),
    "search_evidence": ("CUSTOMER",),
    "get_evidence_subgraph": ("CUSTOMER",),
    "trace_static_flow": ("CUSTOMER",),
}


@dataclass(frozen=True)
class AgenticAuthorizationResult:
    """RBAC role that authorized a model-requested tool call."""

    role: str


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


class ApiRbacToolAuthorizer:
    """Map a native tool call to RBAC roles and fail closed on denial."""

    def __init__(
        self,
        *,
        rbac_client: RbacClient,
    ) -> None:
        """Create the API-backed authorizer.

        Args:
            rbac_client: Shared worker-side RBAC preflight transport.
        """
        self._rbac_client = rbac_client

    def authorize(
        self,
        *,
        tool_name: str,
        user_id: str,
        organization_id: str,
        correlationId: UUID,
    ) -> AgenticAuthorizationResult:
        """Authorize a cataloged model-callable tool through RBAC.

        The API now evaluates worker preflight by required roles only. An
        explicit ALLOW for the mapped role set wins; every other outcome fails
        closed using typed validation errors safe for LLM-facing orchestration.

        Args:
            tool_name: Registered agentic tool name.
            user_id: User/principal requesting the tool call.
            organization_id: Tenant boundary for the request.
            correlationId: End-to-end trace identifier.

        Returns:
            The RBAC role that produced an ALLOW decision.

        Raises:
            AgenticToolValidationError: If the tool is unmapped, context is
                incomplete, preflight fails, or all allowed actions are denied.
        """
        required_roles = TOOL_RBAC_ROLES.get(tool_name)
        if not required_roles:
            raise AgenticToolValidationError("AGENTIC_TOOL_RBAC_ROLE_UNREGISTERED")
        if not user_id.strip() or not organization_id.strip():
            raise AgenticToolValidationError("AGENTIC_TOOL_RBAC_CONTEXT_REQUIRED")

        try:
            decision = self._rbac_client.check(
                user_id=user_id,
                organization_id=organization_id,
                required_roles=required_roles,
                correlationId=str(correlationId),
            )
        except (ConnectionError, httpx.HTTPError) as exc:
            raise AgenticToolValidationError(
                "AGENTIC_TOOL_RBAC_PREFLIGHT_FAILED"
            ) from exc
        if decision == "allow":
            return AgenticAuthorizationResult(role=required_roles[0])

        # Keep denial typed and safe; do not leak membership or policy internals to the LLM.
        raise AgenticToolValidationError("AGENTIC_TOOL_RBAC_BLOCKED")
