import logging
from unittest.mock import MagicMock, patch

import pytest

from lcsp_workers.llm import (
    BudgetTracker,
    LLMGatewayClient,
    PromptSafetyViolation,
)


@pytest.fixture
def budget_tracker():
    # Compatibility adapter; monthly budget enforcement is intentionally disabled.
    return BudgetTracker(monthly_budget_usd=100.0, monthly_token_cap=1_000_000)


@pytest.fixture
def mock_openai():
    with patch("openai.OpenAI") as mock_openai_class:
        mock_instance = MagicMock()
        mock_openai_class.return_value = mock_instance

        # Setup mock response
        mock_response = MagicMock()
        mock_response.choices[0].message.content = "Here is a safe response."
        mock_response.usage.prompt_tokens = 10
        mock_response.usage.completion_tokens = 20
        mock_instance.chat.completions.create.return_value = mock_response

        yield mock_instance


def test_t01_valid_prompt_returns_response(budget_tracker, mock_openai):
    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )

    res = client.complete(
        "Hello, what is AI?",
        workflow_run_id="wf-123",
        node_name="classification.rationale_narrator",
    )

    assert res.content == "Here is a safe response."
    assert res.input_tokens == 10
    assert res.output_tokens == 20
    assert res.provider == "openai"
    assert res.request_id is not None

    mock_openai.chat.completions.create.assert_called_once()


def test_t02_python_function_blocked(budget_tracker):
    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )

    with pytest.raises(PromptSafetyViolation):
        client.complete(
            "def do_something():\n    pass",
            workflow_run_id="wf-123",
            node_name="classification.rationale_narrator",
        )


def test_t03_long_code_block_blocked(budget_tracker):
    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )

    long_code = "```\n" + ("x = 1\n" * 100) + "```"
    with pytest.raises(PromptSafetyViolation):
        client.complete(
            f"Review this: {long_code}",
            workflow_run_id="wf-123",
            node_name="classification.rationale_narrator",
        )


def test_t04_monthly_budget_does_not_block_provider_call(mock_openai):
    tracker = BudgetTracker(monthly_budget_usd=0.000001, monthly_token_cap=1)
    tracker._in_memory_store["tokens"] = 999_999_999
    tracker._in_memory_store["cost"] = 999_999.0

    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=tracker,
    )

    res = client.complete(
        "Hello, world!",
        workflow_run_id="wf-123",
        node_name="classification.rationale_narrator",
    )

    assert res.content == "Here is a safe response."
    mock_openai.chat.completions.create.assert_called_once()


def test_t05_api_key_not_in_logs(caplog, budget_tracker, mock_openai):
    client = LLMGatewayClient(
        provider="openai",
        api_key="SECRET_API_KEY_123",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )

    with caplog.at_level(logging.DEBUG):
        client.complete(
            "Hello",
            workflow_run_id="wf-123",
            node_name="classification.rationale_narrator",
        )

    for record in caplog.records:
        assert "SECRET_API_KEY_123" not in record.message


def test_t06_response_redacted(budget_tracker, mock_openai):
    # Make the mock return sensitive info
    mock_openai.chat.completions.create.return_value.choices[
        0
    ].message.content = "Your key is sk-ant-12345"

    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )

    res = client.complete(
        "What is my key?",
        workflow_run_id="wf-123",
        node_name="classification.rationale_narrator",
    )

    assert "sk-ant-12345" not in res.content
    assert "[REDACTED" in res.content


def test_t07_prompt_safety_violation_no_call(budget_tracker, mock_openai):
    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )

    with pytest.raises(PromptSafetyViolation):
        client.complete(
            "def my_func(): pass",
            workflow_run_id="wf-123",
            node_name="classification.rationale_narrator",
        )

    mock_openai.chat.completions.create.assert_not_called()


# AC-038 specific tests to ensure prompt sent is redacted
def test_llm_gateway_redacts_github_token_from_prompt(budget_tracker, mock_openai):
    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )
    prompt_with_secret = "The token is ghp_123456789012345678901234567890123456"
    client.complete(
        prompt_with_secret,
        workflow_run_id="wf-123",
        node_name="classification.rationale_narrator",
    )

    actual_prompt = mock_openai.chat.completions.create.call_args.kwargs["messages"][0][
        "content"
    ]
    assert "123456789012345678901234567890123456" not in actual_prompt
    assert "[REDACTED:GITHUB_TOKEN]" in actual_prompt


def test_llm_gateway_redacts_anthropic_key_from_prompt(budget_tracker, mock_openai):
    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )
    prompt_with_secret = "Using key sk-ant-api03-ExampleKeyValue12345"
    client.complete(
        prompt_with_secret,
        workflow_run_id="wf-123",
        node_name="classification.rationale_narrator",
    )

    actual_prompt = mock_openai.chat.completions.create.call_args.kwargs["messages"][0][
        "content"
    ]
    assert "sk-ant-api03" not in actual_prompt


def test_llm_gateway_redacts_aws_key_from_prompt(budget_tracker, mock_openai):
    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )
    prompt_with_secret = "AWS key AKIAIOSFODNN7EXAMPLE in config"
    client.complete(
        prompt_with_secret,
        workflow_run_id="wf-123",
        node_name="classification.rationale_narrator",
    )

    actual_prompt = mock_openai.chat.completions.create.call_args.kwargs["messages"][0][
        "content"
    ]
    assert "AKIAIOSFODNN7EXAMPLE" not in actual_prompt


def test_t08_missing_workflow_or_node_context_rejected(budget_tracker, mock_openai):
    client = LLMGatewayClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=budget_tracker,
    )

    with pytest.raises(ValueError):
        client.complete(
            "Hello",
            workflow_run_id="",
            node_name="classification.rationale_narrator",
        )

    with pytest.raises(ValueError):
        client.complete("Hello", workflow_run_id="wf-123", node_name="")

    mock_openai.chat.completions.create.assert_not_called()


def test_t09_gemini_provider_integration_uses_google_genai(budget_tracker):
    with patch("google.genai.Client") as mock_client_class:
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client

        mock_response = MagicMock()
        mock_response.text = "Here is a Gemini response."
        mock_response.response_id = "gemini-req-999"
        mock_response.usage_metadata.prompt_token_count = 15
        mock_response.usage_metadata.candidates_token_count = 25
        mock_client.models.generate_content.return_value = mock_response

        client = LLMGatewayClient(
            provider="gemini",
            api_key="AIzaSy-mock-key",
            model="gemini-1.5-flash",
            budget_tracker=budget_tracker,
        )

        res = client.complete(
            "Hello Gemini",
            workflow_run_id="wf-gemini",
            node_name="classification.rationale_narrator",
            correlationId="corr-gemini-123",
        )

        assert res.content == "Here is a Gemini response."
        assert res.input_tokens == 15
        assert res.output_tokens == 25
        assert res.provider == "gemini"
        assert res.request_id == "gemini-req-999"

        mock_client_class.assert_called_once_with(api_key="AIzaSy-mock-key")
        mock_client.models.generate_content.assert_called_once()
        call_kwargs = mock_client.models.generate_content.call_args.kwargs
        assert call_kwargs["model"] == "gemini-1.5-flash"
        assert call_kwargs["contents"] == "Hello Gemini"

        config = call_kwargs["config"]
        assert config.max_output_tokens == 4096
        assert config.http_options.headers == {
            "X-Correlation-Id": "corr-gemini-123",
            "X-Workflow-Run-Id": "wf-gemini",
            "X-Node-Name": "classification.rationale_narrator",
        }
