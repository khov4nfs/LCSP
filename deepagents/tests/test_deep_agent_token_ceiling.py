from tools.common.llm import BudgetTracker, DeepAgentClient


def test_deep_agent_caps_caller_output_tokens_at_configured_runtime_ceiling() -> None:
    tracker = BudgetTracker(
        monthly_budget_usd=100.0,
        monthly_token_cap=1_000_000,
    )
    client = DeepAgentClient(
        provider="openai",
        api_key="test-key",
        model="gpt-4o",
        budget_tracker=tracker,
        max_tokens_per_call=4096,
    )

    _safe_prompt, max_tokens, headers = client._prepare_request(
        prompt="Summarize the supplied legal context.",
        workflow_run_id="workflow-1",
        node_name="compile_engineering_rules",
        max_tokens=6000,
        correlationId="corr-1",
    )

    assert max_tokens == 4096
    assert headers["X-Correlation-Id"] == "corr-1"
