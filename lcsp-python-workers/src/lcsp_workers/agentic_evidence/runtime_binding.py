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
    """Bind all model-callable Sprint 6 tools to the trusted API runtime bridge."""

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
    def handler(request: AgenticToolRequest) -> Mapping[str, Any]:
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
