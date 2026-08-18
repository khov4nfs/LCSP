from unittest.mock import MagicMock, patch

from lcsp_workers.llm import BudgetTracker, LLMGatewayClient


def test_gateway_caps_caller_output_tokens_at_configured_runtime_ceiling() -> None:
    tracker = BudgetTracker(
        monthly_budget_usd=100.0,
        monthly_token_cap=1_000_000,
    )

    with patch("openai.OpenAI") as openai_class:
        openai_client = MagicMock()
        openai_class.return_value = openai_client
        response = MagicMock()
        response.choices[0].message.content = "ok"
        response.usage.prompt_tokens = 10
        response.usage.completion_tokens = 20
        openai_client.chat.completions.create.return_value = response

        client = LLMGatewayClient(
            provider="openai",
            api_key="test-key",
            model="gpt-4o",
            budget_tracker=tracker,
            max_tokens_per_call=4096,
        )
        client.complete(
            "Summarize the supplied legal context.",
            workflow_run_id="workflow-1",
            node_name="compile_engineering_rules",
            max_tokens=6000,
        )

    call = openai_client.chat.completions.create.call_args.kwargs
    assert call["max_tokens"] == 4096
