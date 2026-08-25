"""Validate, authorize, budget, and dispatch model-requested evidence tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from langchain.tools import BaseTool, tool

from .authorization import AgenticToolAuthorizer
from ..governance.catalog import llm_callable_tool_specs
from ..governance.registry import AgenticToolRegistry, AgenticToolRequest, AgenticToolValidationError


@dataclass(frozen=True)
class AgenticInvocationContext:
    """Tenant, workflow, artifact, and budget context for agentic tool calls."""

    assessment_id: UUID
    workflow_run_id: UUID
    correlationId: UUID
    user_id: str
    organization_id: str
    artifact_versions: dict[str, str]
    scope: dict[str, Any]


class AgenticToolResolver:
    """Bridge provider tool calls to the fail-closed agentic registry.

    Only catalog entries marked ``LLM_CALLABLE`` are exposed. Every request is
    schema/budget validated before PBAC authorization and dispatches only to an
    explicitly registered read handler; mutation/system tools are never inferred
    or synthesized for a model.
    """

    def __init__(
        self,
        registry: AgenticToolRegistry,
        authorizer: AgenticToolAuthorizer,
        *,
        max_tool_calls: int,
    ) -> None:
        """Create a resolver with a bounded per-response tool-call budget.

        Args:
            registry: Validated agentic capability registry.
            authorizer: PBAC authorization adapter evaluated for every call.
            max_tool_calls: Maximum tool calls accepted in one model response.

        Raises:
            ValueError: If the configured tool-call budget is outside 1..32.
        """
        if max_tool_calls < 1 or max_tool_calls > 32:
            raise ValueError("max_tool_calls must be between 1 and 32")
        self._registry = registry
        self._authorizer = authorizer
        self._max_tool_calls = max_tool_calls

    @property
    def max_tool_calls(self) -> int:
        return self._max_tool_calls

    def as_langchain_tools(self, *, context: AgenticInvocationContext) -> list[BaseTool]:
        """Bind catalog capabilities as native LangChain tools for one agent run."""
        specs = llm_callable_tool_specs()
        if {spec.name for spec in specs} != set(self._registry.model_callable_names()):
            raise AgenticToolValidationError("AGENTIC_TOOL_CATALOG_REGISTRY_DRIFT")
        tools: list[BaseTool] = []
        for spec in specs:
            capability = self._registry.capability(spec.name)
            tools.append(self._langchain_tool(spec.name, spec.description, spec.input_schema, capability, context))
        return tools

    def _langchain_tool(self, name, description, schema, capability, context) -> BaseTool:
        @tool(name, description=description, args_schema=schema)
        def invoke_capability(**arguments: Any) -> dict[str, Any]:
            """Run one PBAC-authorized evidence capability."""
            return self._invoke_capability(name, capability, arguments, context)

        return invoke_capability

    def _invoke_capability(self, name, capability, arguments, context) -> dict[str, Any]:
        request = AgenticToolRequest.model_validate({
            "toolName": name, "requestId": str(uuid4()), "assessmentId": str(context.assessment_id),
            "workflowRunId": str(context.workflow_run_id), "artifactVersions": context.artifact_versions,
            "correlationId": str(context.correlationId), "scope": context.scope,
            "budget": {"maxItems": _requested_max_items(arguments, capability.max_items), "maxDepth": _requested_max_depth(arguments, capability.max_depth), "maxBytes": capability.max_bytes, "maxDurationMs": capability.max_duration_ms},
            "input": arguments,
        })
        self._registry.validate_model_request(request)
        self._authorizer.authorize(tool_name=name, user_id=context.user_id, organization_id=context.organization_id, correlationId=context.correlationId)
        return self._registry.invoke_model_tool(request)

def _requested_max_items(arguments: dict[str, Any], server_cap: int) -> int:
    """Clamp provider-requested result counts to a positive server capability."""
    for key in ("maxResults", "maxNodes", "maxRuns", "maxNeighbors"):
        value = arguments.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return max(1, min(server_cap, value))
    return max(1, server_cap)


def _requested_max_depth(arguments: dict[str, Any], server_cap: int) -> int:
    """Clamp provider-requested traversal depth to the server capability."""
    for key in ("maxDepth", "maxHops"):
        value = arguments.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return max(0, min(server_cap, value))
    return max(0, server_cap)
