from __future__ import annotations

from typing import Any, Callable, Mapping
from uuid import UUID

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError as JsonSchemaValidationError
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .catalog import AgenticToolSpec, SPRINT6_AGENTIC_TOOL_SPECS


class AgenticToolValidationError(ValueError):
    """Safe validation failure raised before an agentic tool handler is dispatched."""


class AgenticToolBudget(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    max_items: int = Field(alias="maxItems", ge=1, le=500)
    max_depth: int = Field(alias="maxDepth", ge=0, le=20)
    max_bytes: int = Field(alias="maxBytes", ge=1, le=1_048_576)
    max_duration_ms: int = Field(alias="maxDurationMs", ge=1, le=60_000)


class AgenticToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    tool_name: str = Field(alias="toolName", min_length=1, max_length=100)
    request_id: UUID = Field(alias="requestId")
    assessment_id: UUID = Field(alias="assessmentId")
    workflow_run_id: UUID = Field(alias="workflowRunId")
    artifact_versions: dict[str, str] = Field(alias="artifactVersions", min_length=1)
    correlationId: UUID = Field(alias="correlationId")
    scope: dict[str, Any] = Field(default_factory=dict)
    budget: AgenticToolBudget
    input: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(
        default=None,
        alias="idempotencyKey",
        min_length=8,
        max_length=200,
    )

    @field_validator("artifact_versions")
    @classmethod
    def validate_artifact_versions(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 20:
            raise ValueError("artifactVersions exceeds the maximum number of pinned refs")
        if any(not key.strip() or not ref.strip() for key, ref in value.items()):
            raise ValueError("artifactVersions must contain non-empty names and refs")
        return value

    @field_validator("scope", "input")
    @classmethod
    def validate_safe_projection(cls, value: dict[str, Any]) -> dict[str, Any]:
        _assert_safe_agent_input(value)
        return value


AgenticToolCapability = AgenticToolSpec
AgenticToolHandler = Callable[[AgenticToolRequest], Mapping[str, Any]]
SPRINT6_AGENTIC_CAPABILITIES = SPRINT6_AGENTIC_TOOL_SPECS


class AgenticToolRegistry:
    """Fail-closed catalog, validator and dispatcher for Agentic tools."""

    def __init__(self, capabilities: tuple[AgenticToolSpec, ...]) -> None:
        self._capabilities = {capability.name: capability for capability in capabilities}
        if len(self._capabilities) != len(capabilities):
            raise ValueError("agentic tool capability names must be unique")
        self._validators: dict[str, Draft202012Validator] = {}
        for capability in capabilities:
            try:
                Draft202012Validator.check_schema(capability.input_schema)
            except SchemaError as exc:
                raise ValueError(
                    f"invalid JSON schema for agentic tool: {capability.name}"
                ) from exc
            self._validators[capability.name] = Draft202012Validator(
                capability.input_schema
            )
        self._handlers: dict[str, AgenticToolHandler] = {}

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._capabilities))

    def model_callable_names(self) -> tuple[str, ...]:
        return tuple(
            sorted(
                capability.name
                for capability in self._capabilities.values()
                if capability.exposure == "LLM_CALLABLE"
            )
        )

    def capability(self, name: str) -> AgenticToolSpec:
        capability = self._capabilities.get(name)
        if capability is None:
            raise AgenticToolValidationError("UNREGISTERED_AGENTIC_TOOL")
        return capability

    def register_handler(self, name: str, handler: AgenticToolHandler) -> None:
        self.capability(name)
        if name in self._handlers:
            raise AgenticToolValidationError("AGENTIC_TOOL_HANDLER_ALREADY_REGISTERED")
        self._handlers[name] = handler

    def validate(self, request: AgenticToolRequest) -> AgenticToolSpec:
        capability = self.capability(request.tool_name)
        budget = request.budget
        if (
            budget.max_items > capability.max_items
            or budget.max_depth > capability.max_depth
            or budget.max_bytes > capability.max_bytes
            or budget.max_duration_ms > capability.max_duration_ms
        ):
            raise AgenticToolValidationError("AGENTIC_TOOL_BUDGET_EXCEEDED")

        missing_artifacts = [
            artifact
            for artifact in capability.required_artifacts
            if not request.artifact_versions.get(artifact)
        ]
        if missing_artifacts:
            raise AgenticToolValidationError("AGENTIC_TOOL_ARTIFACT_VERSION_REQUIRED")

        try:
            self._validators[request.tool_name].validate(request.input)
        except JsonSchemaValidationError as exc:
            raise AgenticToolValidationError("AGENTIC_TOOL_INPUT_SCHEMA_INVALID") from exc

        if capability.mutation and not request.idempotency_key:
            raise AgenticToolValidationError("AGENTIC_TOOL_IDEMPOTENCY_KEY_REQUIRED")
        if not capability.mutation and request.idempotency_key:
            raise AgenticToolValidationError("AGENTIC_TOOL_READ_IDEMPOTENCY_KEY_NOT_ALLOWED")
        return capability

    def validate_model_request(self, request: AgenticToolRequest) -> AgenticToolSpec:
        capability = self.capability(request.tool_name)
        if capability.exposure != "LLM_CALLABLE":
            raise AgenticToolValidationError("AGENTIC_TOOL_NOT_MODEL_CALLABLE")
        if capability.mutation:
            raise AgenticToolValidationError("AGENTIC_TOOL_MODEL_MUTATION_FORBIDDEN")
        return self.validate(request)

    def invoke(self, request: AgenticToolRequest) -> Mapping[str, Any]:
        self.validate(request)
        return self._invoke_bound_handler(request)

    def invoke_model_tool(self, request: AgenticToolRequest) -> Mapping[str, Any]:
        self.validate_model_request(request)
        return self._invoke_bound_handler(request)

    def _invoke_bound_handler(self, request: AgenticToolRequest) -> Mapping[str, Any]:
        handler = self._handlers.get(request.tool_name)
        if handler is None:
            raise AgenticToolValidationError("AGENTIC_TOOL_HANDLER_NOT_BOUND")
        response = handler(request)
        _assert_safe_agent_output(response)
        return response


def build_sprint6_agentic_registry() -> AgenticToolRegistry:
    return AgenticToolRegistry(SPRINT6_AGENTIC_TOOL_SPECS)


_FORBIDDEN_KEYS = {
    "source",
    "source_code",
    "raw_source",
    "raw_content",
    "full_source",
    "prompt",
    "prompt_text",
    "full_prompt",
    "ast_body",
    "full_ast",
    "ast_dump",
    "secret",
    "token",
    "api_key",
    "api_token",
    "authorization",
    "credential",
    "password",
    "url",
    "command",
    "shell",
}


def _assert_safe_agent_input(value: Any, *, key: str | None = None) -> None:
    if key is not None:
        normalized_key = key.replace("-", "_").lower()
        if normalized_key in _FORBIDDEN_KEYS:
            raise ValueError(f"forbidden agentic tool input field: {normalized_key}")

    if isinstance(value, dict):
        for nested_key, nested_value in value.items():
            _assert_safe_agent_input(nested_value, key=str(nested_key))
        return
    if isinstance(value, (list, tuple)):
        for nested_value in value:
            _assert_safe_agent_input(nested_value)
        return
    if not isinstance(value, str):
        return

    normalized = value.replace("\\", "/")
    if normalized.startswith("/") or normalized.startswith("~/"):
        raise ValueError("absolute paths are forbidden in agentic tool input")
    if ".." in normalized.split("/"):
        raise ValueError("parent path traversal is forbidden in agentic tool input")
    if "://" in normalized:
        raise ValueError("arbitrary URLs are forbidden in agentic tool input")


def _assert_safe_agent_output(value: Any, *, key: str | None = None) -> None:
    if key is not None and key.replace("-", "_").lower() in _FORBIDDEN_KEYS:
        raise AgenticToolValidationError("AGENTIC_TOOL_UNSAFE_OUTPUT")
    if isinstance(value, Mapping):
        for nested_key, nested_value in value.items():
            _assert_safe_agent_output(nested_value, key=str(nested_key))
    elif isinstance(value, (list, tuple)):
        for nested_value in value:
            _assert_safe_agent_output(nested_value)
