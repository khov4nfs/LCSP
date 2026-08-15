"""Bind validated agentic registry capabilities to the trusted worker API bridge."""

from __future__ import annotations

from typing import Any, Mapping

from lcsp_workers.platform.api_client import WorkerApiClient

from .registry import AgenticToolRegistry, AgenticToolRequest


def bind_runtime_handlers(
    registry: AgenticToolRegistry,
    *,
    api_client: WorkerApiClient,
    user_id: str,
    organization_id: str,
) -> None:
    """Bind every model-callable tool to the trusted API runtime dispatcher.

    Args:
        registry: Agentic capability registry whose model-callable entries need
            concrete runtime handlers.
        api_client: Internal worker API client used for actual data access.
        user_id: Principal propagated into downstream tool requests.
        organization_id: Tenant boundary propagated into downstream requests.
    """
    for tool_name in registry.model_callable_names():
        registry.register_handler(
            tool_name,
            _build_runtime_handler(
                tool_name=tool_name,
                api_client=api_client,
                user_id=user_id,
                organization_id=organization_id,
            ),
        )


def _build_runtime_handler(
    *,
    tool_name: str,
    api_client: WorkerApiClient,
    user_id: str,
    organization_id: str,
):
    """Create a handler that maps a validated registry request to API payload.

    Args:
        tool_name: Registered capability name being bound.
        api_client: Internal API bridge used to dispatch the tool.
        user_id: Principal to include in the downstream request.
        organization_id: Tenant boundary to include in the request.

    Returns:
        Callable accepting ``AgenticToolRequest`` and returning a mapping result.
    """

    def handler(request: AgenticToolRequest) -> Mapping[str, Any]:
        """Dispatch one already-validated request through the internal API bridge."""
        return api_client.dispatch_agentic_tool(
            {
                "tool_name": tool_name,
                "request_id": str(request.request_id),
                "assessment_id": str(request.assessment_id),
                "workflow_run_id": str(request.workflow_run_id),
                "organization_id": organization_id,
                "user_id": user_id,
                "artifact_versions": request.artifact_versions,
                "scope": request.scope,
                "budget": {
                    "maxItems": request.budget.max_items,
                    "maxDepth": request.budget.max_depth,
                    "maxBytes": request.budget.max_bytes,
                    "maxDurationMs": request.budget.max_duration_ms,
                },
                "input": request.input,
                "correlationId": str(request.correlationId),
            }
        )

    return handler
