from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from lcsp_workers.agentic_evidence import (
    AgenticToolRequest,
    build_sprint6_agentic_registry,
)
from lcsp_workers.llm import BudgetTracker, LLMGatewayClient, LLMToolDefinition


def tool_definition() -> LLMToolDefinition:
    return LLMToolDefinition(
        name="get_scan_coverage",
        description="Return bounded scan coverage for an accepted evidence report.",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 100}
            },
            "required": ["maxResults"],
        },
    )


def budget_tracker() -> BudgetTracker:
    return BudgetTracker(monthly_budget_usd=100.0, monthly_token_cap=1_000_000)


def test_google_tool_call_is_manual_and_registry_validated() -> None:
    with patch("google.genai.Client") as client_class:
        provider = MagicMock()
        client_class.return_value = provider
        provider.models.generate_content.return_value = SimpleNamespace(
            text="",
            response_id="gemini-tool-1",
            function_calls=[
                SimpleNamespace(
                    name="get_scan_coverage",
                    args={"maxResults": 25},
                    id="call-1",
                )
            ],
            usage_metadata=SimpleNamespace(
                prompt_token_count=12,
                candidates_token_count=8,
            ),
        )

        gateway = LLMGatewayClient(
            provider="gemini",
            api_key="AIzaSy-mock-key",
            model="gemini-1.5-flash",
            budget_tracker=budget_tracker(),
        )
        response = gateway.complete_with_tools(
            "Inspect current scan coverage.",
            tools=[tool_definition()],
            workflow_run_id=str(uuid4()),
            node_name="agentic.resolve_missing_input",
            correlation_id=str(uuid4()),
        )

        assert response.content == ""
        assert len(response.tool_calls) == 1
        call = response.tool_calls[0]
        assert call.name == "get_scan_coverage"
        assert call.arguments == {"maxResults": 25}
        assert call.call_id == "call-1"

        config = provider.models.generate_content.call_args.kwargs["config"]
        assert config.automatic_function_calling.disable is True
        assert config.tools[0].function_declarations[0].name == "get_scan_coverage"

        request = AgenticToolRequest.model_validate(
            {
                "toolName": call.name,
                "requestId": str(uuid4()),
                "assessmentId": str(uuid4()),
                "workflowRunId": str(uuid4()),
                "artifactVersions": {"technicalEvidenceReportId": "ter-1"},
                "correlationId": str(uuid4()),
                "scope": {},
                "budget": {
                    "maxItems": call.arguments["maxResults"],
                    "maxDepth": 1,
                    "maxBytes": 16_384,
                    "maxDurationMs": 1_000,
                },
                "input": call.arguments,
            }
        )
        capability = build_sprint6_agentic_registry().validate(request)
        assert capability.name == "get_scan_coverage"


def test_google_undeclared_tool_call_fails_closed() -> None:
    with patch("google.genai.Client") as client_class:
        provider = MagicMock()
        client_class.return_value = provider
        provider.models.generate_content.return_value = SimpleNamespace(
            text="",
            response_id="gemini-tool-2",
            function_calls=[
                SimpleNamespace(
                    name="read_repository_source",
                    args={"path": "apps/api/src/main.ts"},
                    id="call-2",
                )
            ],
            usage_metadata=SimpleNamespace(
                prompt_token_count=10,
                candidates_token_count=5,
            ),
        )
        gateway = LLMGatewayClient(
            provider="gemini",
            api_key="AIzaSy-mock-key",
            model="gemini-1.5-flash",
            budget_tracker=budget_tracker(),
        )
        with pytest.raises(ValueError, match="undeclared tool call"):
            gateway.complete_with_tools(
                "Inspect evidence.",
                tools=[tool_definition()],
                workflow_run_id=str(uuid4()),
                node_name="agentic.resolve_missing_input",
            )


def test_tool_schema_must_be_closed_before_provider_call() -> None:
    with patch("google.genai.Client") as client_class:
        provider = MagicMock()
        client_class.return_value = provider
        gateway = LLMGatewayClient(
            provider="gemini",
            api_key="AIzaSy-mock-key",
            model="gemini-1.5-flash",
            budget_tracker=budget_tracker(),
        )
        unsafe = LLMToolDefinition(
            name="get_scan_coverage",
            description="Coverage",
            input_schema={"type": "object", "properties": {}},
        )
        with pytest.raises(ValueError, match="additionalProperties=false"):
            gateway.complete_with_tools(
                "Inspect evidence.",
                tools=[unsafe],
                workflow_run_id=str(uuid4()),
                node_name="agentic.resolve_missing_input",
            )
        provider.models.generate_content.assert_not_called()


def test_openai_tool_arguments_must_be_json_object() -> None:
    with patch("openai.OpenAI") as client_class:
        provider = MagicMock()
        client_class.return_value = provider
        message = SimpleNamespace(
            content=None,
            tool_calls=[
                SimpleNamespace(
                    id="call-openai-1",
                    function=SimpleNamespace(
                        name="get_scan_coverage",
                        arguments='["not-an-object"]',
                    ),
                )
            ],
        )
        provider.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=message)],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
            id="openai-tool-1",
        )
        gateway = LLMGatewayClient(
            provider="openai",
            api_key="sk-test-key",
            model="gpt-4o",
            budget_tracker=budget_tracker(),
        )
        with pytest.raises(ValueError, match="arguments must be an object"):
            gateway.complete_with_tools(
                "Inspect evidence.",
                tools=[tool_definition()],
                workflow_run_id=str(uuid4()),
                node_name="agentic.resolve_missing_input",
            )
