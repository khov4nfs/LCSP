from __future__ import annotations

from unittest.mock import MagicMock, patch

from lcsp_workers.llm import PrimaryThenFallbackLLMClient
from lcsp_workers.platform.config import (
    AgenticRuntimeConfig,
    LlmProviderConfig,
    LlmRuntimeConfig,
    PbacPreflightConfig,
    WorkerConfig,
    load_config,
)
from lcsp_workers.platform.queue_consumer import ConsumerBase
from lcsp_workers.runtime import _build_consumer, _build_llm_client
from lcsp_workers.scanner.program_graph.business_semantic_graph_assembler import (
    BusinessSemanticProgramGraphAssembler,
)


def _base_env(monkeypatch) -> None:
    monkeypatch.setenv("RABBITMQ_URL", "amqp://guest:guest@localhost/")
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://api.test")
    monkeypatch.setenv("WORKER_API_KEY", "worker-test-key")


def _worker_config(*, llm_runtime: LlmRuntimeConfig | None = None) -> WorkerConfig:
    return WorkerConfig(
        rabbitmq_url="amqp://guest:guest@localhost/",
        rabbitmq_exchange="lcsp.events",
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
        llm_runtime=llm_runtime or LlmRuntimeConfig(),
        agentic_runtime=AgenticRuntimeConfig(),
        pbac_preflight=PbacPreflightConfig(),
    )


def test_load_config_parses_llm_provider_chain(monkeypatch) -> None:
    _base_env(monkeypatch)
    monkeypatch.setenv("LLM_PRIMARY_PROVIDER", "openai")
    monkeypatch.setenv("LLM_PRIMARY_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "anthropic")
    monkeypatch.setenv("LLM_FALLBACK_MODEL_1", "claude-sonnet-5")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_2", "gemini")
    monkeypatch.setenv("LLM_FALLBACK_MODEL_2", "gemini-1.5-flash")
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSy-test")
    monkeypatch.setenv("LLM_MAX_TOKENS_PER_CALL", "2048")
    monkeypatch.setenv("LLM_MONTHLY_BUDGET_USD", "25")
    monkeypatch.setenv("LLM_MONTHLY_TOKEN_CAP", "500000")
    monkeypatch.setenv("LLM_PROVIDER_TIMEOUT_SECONDS", "15")
    monkeypatch.setenv("LLM_FALLBACK_ON_CODES", "RATE_LIMIT,NETWORK")
    monkeypatch.setenv("LLM_MAX_PROVIDER_ATTEMPTS", "2")

    config = load_config()

    assert config.llm_runtime.enabled is True
    assert [provider.provider for provider in config.llm_runtime.providers] == [
        "openai",
        "anthropic",
        "gemini",
    ]
    assert config.llm_runtime.max_tokens_per_call == 2048
    assert config.llm_runtime.monthly_budget_usd == 25.0
    assert config.llm_runtime.monthly_token_cap == 500000
    assert config.llm_runtime.provider_timeout_seconds == 15.0
    assert config.llm_runtime.fallback_on_codes == ("RATE_LIMIT", "NETWORK")
    assert config.llm_runtime.max_provider_attempts == 2


def test_build_llm_client_skips_provider_without_api_key() -> None:
    config = _worker_config(
        llm_runtime=LlmRuntimeConfig(
            providers=(
                LlmProviderConfig(
                    provider="openai",
                    model="gpt-4o-mini",
                    api_key=None,
                    api_key_env="OPENAI_API_KEY",
                ),
                LlmProviderConfig(
                    provider="anthropic",
                    model="claude-sonnet-5",
                    api_key="sk-ant-test",
                    api_key_env="ANTHROPIC_API_KEY",
                ),
            ),
            max_provider_attempts=2,
        )
    )

    with patch("lcsp_workers.runtime.LLMGatewayClient") as gateway_class:
        gateway_class.return_value = MagicMock()
        client = _build_llm_client(config)

    assert isinstance(client, PrimaryThenFallbackLLMClient)
    gateway_class.assert_called_once()
    kwargs = gateway_class.call_args.kwargs
    assert kwargs["provider"] == "anthropic"
    assert kwargs["api_key"] == "sk-ant-test"


def test_build_llm_client_returns_none_when_no_provider_has_key() -> None:
    config = _worker_config(
        llm_runtime=LlmRuntimeConfig(
            providers=(
                LlmProviderConfig(
                    provider="openai",
                    model="gpt-4o-mini",
                    api_key=None,
                    api_key_env="OPENAI_API_KEY",
                ),
            ),
        )
    )

    assert _build_llm_client(config) is None


def test_build_consumer_injects_business_semantic_graph_assembler_when_llm_enabled() -> None:
    class GraphConsumer(ConsumerBase):
        queue_name = "test"
        routing_key = "test"

        def __init__(self, config, evidence_graph_assembler=None):
            super().__init__(config)
            self.evidence_graph_assembler = evidence_graph_assembler

        def handle(self, message: dict, correlationId: str) -> None:
            return None

    config = _worker_config()
    llm_client = MagicMock()

    with (
        patch("lcsp_workers.runtime.load_config", return_value=config),
        patch("lcsp_workers.runtime._load_consumer", return_value=GraphConsumer),
        patch("lcsp_workers.runtime._build_llm_client", return_value=llm_client),
    ):
        consumer = _build_consumer("ignored:GraphConsumer")

    assert isinstance(
        consumer.evidence_graph_assembler,
        BusinessSemanticProgramGraphAssembler,
    )


def test_build_consumer_keeps_deterministic_default_when_llm_disabled() -> None:
    class GraphConsumer(ConsumerBase):
        queue_name = "test"
        routing_key = "test"

        def __init__(self, config, evidence_graph_assembler=None):
            super().__init__(config)
            self.evidence_graph_assembler = evidence_graph_assembler

        def handle(self, message: dict, correlationId: str) -> None:
            return None

    config = _worker_config()
    with (
        patch("lcsp_workers.runtime.load_config", return_value=config),
        patch("lcsp_workers.runtime._load_consumer", return_value=GraphConsumer),
        patch("lcsp_workers.runtime._build_llm_client", return_value=None),
    ):
        consumer = _build_consumer("ignored:GraphConsumer")

    assert consumer.evidence_graph_assembler is None
