"""Validate, authorize, budget, and dispatch model-requested evidence tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping
from uuid import UUID, uuid4

from tools.common.llm import LLMToolCall, LLMToolDefinition

from .authorization import AgenticToolAuthorizer
from .catalog import build_llm_tool_definitions
from .registry import AgenticToolRegistry, AgenticToolRequest, AgenticToolValidationError


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


@dataclass(frozen=True)
class AgenticToolCallResult:
    """One authorized tool result returned to model orchestration."""

    call_id: str | None
    tool_name: str
    authorized_action: str
    response: Mapping[str, Any]


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

    def tool_definitions(self) -> list[LLMToolDefinition]:
        """Return provider-facing definitions after checking catalog/registry drift.

        Returns:
            Tool definitions for exactly the registered model-callable tools.

        Raises:
            AgenticToolValidationError: If catalog definitions and runtime
                registry exposure no longer match.
        """
        definitions = build_llm_tool_definitions()
        registered = set(self._registry.model_callable_names())
        definition_names = {definition.name for definition in definitions}
        if definition_names != registered:
            raise AgenticToolValidationError("AGENTIC_TOOL_CATALOG_REGISTRY_DRIFT")
        return definitions

    def invoke_tool_calls(
        self,
        tool_calls: tuple[LLMToolCall, ...] | list[LLMToolCall],
        *,
        context: AgenticInvocationContext,
    ) -> tuple[AgenticToolCallResult, ...]:
        """Validate and execute a bounded sequence of model-requested tool calls.

        Validation occurs before PBAC and before any data access. Requested
        result/depth budgets are clamped to server capability limits, then each
        call is independently authorized and dispatched.

        Args:
            tool_calls: Structured calls emitted by the LLM provider.
            context: Assessment, tenant, workflow, and artifact execution context.

        Returns:
            Ordered immutable results for each executed tool call.

        Raises:
            AgenticToolValidationError: If call count, schema, exposure, budget,
                authorization, or runtime registration checks fail.
        """
        if len(tool_calls) > self._max_tool_calls:
            raise AgenticToolValidationError("AGENTIC_TOOL_CALL_BUDGET_EXCEEDED")

        results: list[AgenticToolCallResult] = []
        for call in tool_calls:
            capability = self._registry.capability(call.name)
            request = AgenticToolRequest.model_validate(
                {
                    "toolName": call.name,
                    "requestId": str(uuid4()),
                    "assessmentId": str(context.assessment_id),
                    "workflowRunId": str(context.workflow_run_id),
                    "artifactVersions": context.artifact_versions,
                    "correlationId": str(context.correlationId),
                    "scope": context.scope,
                    "budget": {
                        "maxItems": _requested_max_items(call.arguments, capability.max_items),
                        "maxDepth": _requested_max_depth(call.arguments, capability.max_depth),
                        "maxBytes": capability.max_bytes,
                        "maxDurationMs": capability.max_duration_ms,
                    },
                    "input": call.arguments,
                }
            )

            # Validate exposure/schema/budget before making any authorization or data call.
            self._registry.validate_model_request(request)
            authorization = self._authorizer.authorize(
                tool_name=call.name,
                user_id=context.user_id,
                organization_id=context.organization_id,
                correlationId=context.correlationId,
            )
            response = self._registry.invoke_model_tool(request)
            results.append(
                AgenticToolCallResult(
                    call_id=call.call_id,
                    tool_name=call.name,
                    authorized_action=authorization.action,
                    response=response,
                )
            )
        return tuple(results)


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
