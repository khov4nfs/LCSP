from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from lcsp_workers.llm import BudgetTracker, LLMGatewayClient, LLMToolDefinition


def _tracker() -> BudgetTracker:
    return BudgetTracker(monthly_budget_usd=1.0, monthly_token_cap=1)


def _required_tool() -> LLMToolDefinition:
    return LLMToolDefinition(
        name="finish",
        description="Submit the terminal structured result.",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {},
        },
        tool_choice_required=True,
    )


def test_openai_required_tool_definition_disables_auto_tool_choice() -> None:
    with patch("openai.OpenAI") as client_class:
        provider = MagicMock()
        client_class.return_value = provider
        provider.chat.completions.create.return_value = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=None,
                        tool_calls=[
                            SimpleNamespace(
                                id="call-1",
                                function=SimpleNamespace(
                                    name="finish",
                                    arguments="{}",
                                ),
                            )
                        ],
                    )
                )
            ],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
            id="openai-required-1",
        )
        gateway = LLMGatewayClient(
            provider="openai",
            api_key="sk-test-key",
            model="gpt-4o",
            budget_tracker=_tracker(),
        )

        response = gateway.complete_with_tools(
            "Finish now.",
            tools=[_required_tool()],
            workflow_run_id="workflow-1",
            node_name="investigate_engineering_rule_finish",
        )

        assert response.tool_calls[0].name == "finish"
        assert provider.chat.completions.create.call_args.kwargs["tool_choice"] == "required"


def test_anthropic_required_tool_definition_uses_any_tool_choice() -> None:
    with patch("anthropic.Anthropic") as client_class:
        provider = MagicMock()
        client_class.return_value = provider
        provider.messages.create.return_value = SimpleNamespace(
            content=[
                SimpleNamespace(
                    type="tool_use",
                    name="finish",
                    input={},
                    id="call-1",
                )
            ],
            usage=SimpleNamespace(input_tokens=10, output_tokens=5),
            id="anthropic-required-1",
        )
        gateway = LLMGatewayClient(
            provider="anthropic",
            api_key="sk-ant-test-key",
            model="claude-3-haiku-20240307",
            budget_tracker=_tracker(),
        )

        response = gateway.complete_with_tools(
            "Finish now.",
            tools=[_required_tool()],
            workflow_run_id="workflow-1",
            node_name="investigate_engineering_rule_finish",
        )

        assert response.tool_calls[0].name == "finish"
        assert provider.messages.create.call_args.kwargs["tool_choice"] == {"type": "any"}


def test_gemini_required_tool_definition_uses_any_function_calling_mode() -> None:
    with patch("google.genai.Client") as client_class:
        provider = MagicMock()
        client_class.return_value = provider
        provider.models.generate_content.return_value = SimpleNamespace(
            text="",
            response_id="gemini-required-1",
            function_calls=[
                SimpleNamespace(name="finish", args={}, id="call-1")
            ],
            usage_metadata=SimpleNamespace(
                prompt_token_count=10,
                candidates_token_count=5,
            ),
        )
        gateway = LLMGatewayClient(
            provider="gemini",
            api_key="AIzaSy-mock-key",
            model="gemini-2.5-flash",
            budget_tracker=_tracker(),
        )

        response = gateway.complete_with_tools(
            "Finish now.",
            tools=[_required_tool()],
            workflow_run_id="workflow-1",
            node_name="investigate_engineering_rule_finish",
        )

        assert response.tool_calls[0].name == "finish"
        config = provider.models.generate_content.call_args.kwargs["config"]
        assert config.automatic_function_calling.disable is True
        assert str(config.tool_config.function_calling_config.mode).upper().endswith("ANY")
