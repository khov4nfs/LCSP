"""Bootstrap LCSP worker consumers and their runtime dependencies.

This module resolves a consumer class from the CLI target, injects optional
PBAC, agentic-tool, and LLM dependencies based on the consumer constructor,
and starts the selected RabbitMQ consumer without coupling individual workers
to process-level configuration code.
"""

from __future__ import annotations

import argparse
import importlib
import inspect
from typing import Type

from lcsp_workers.agentic_evidence import (
    AgenticToolResolver,
    bind_runtime_handlers,
    build_sprint6_agentic_registry,
)
from lcsp_workers.agentic_evidence.authorization import ApiPbacToolAuthorizer
from lcsp_workers.llm import (
    BudgetTracker,
    LLMGatewayClient,
    LlmProviderCandidate,
    PrimaryThenFallbackLLMClient,
)
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.config import load_config
from lcsp_workers.platform.pbac_client import PbacClient
from lcsp_workers.platform.queue_consumer import ConsumerBase


def _load_consumer(target: str) -> Type[ConsumerBase]:
    """Resolve and validate a worker consumer class from an import target.

    Args:
        target: Import target in ``module.path:ClassName`` format.

    Returns:
        The resolved ``ConsumerBase`` subclass.

    Raises:
        ValueError: If the target does not use the required module/class syntax.
        TypeError: If the resolved object is not a ``ConsumerBase`` subclass.
    """
    module_name, separator, class_name = target.partition(":")
    if not separator or not module_name or not class_name:
        raise ValueError(
            "worker target must use module.path:ClassName syntax"
        )

    module = importlib.import_module(module_name)
    consumer_type = getattr(module, class_name, None)
    if not inspect.isclass(consumer_type) or not issubclass(consumer_type, ConsumerBase):
        raise TypeError(f"{target} is not a ConsumerBase implementation")
    return consumer_type


def _build_consumer(target: str) -> ConsumerBase:
    """Construct a consumer and inject only the dependencies it declares.

    Constructor inspection keeps worker implementations lightweight: PBAC,
    agentic-tool resolution, and LLM clients are created only when the selected
    consumer exposes matching constructor parameters.

    Args:
        target: Import target identifying the consumer class to instantiate.

    Returns:
        A configured worker consumer ready to run.
    """
    config = load_config()
    consumer_type = _load_consumer(target)
    constructor = inspect.signature(consumer_type)
    kwargs: dict[str, object] = {}

    if "pbac_client" in constructor.parameters:
        kwargs["pbac_client"] = PbacClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )

    if "agentic_tool_resolver" in constructor.parameters:
        api_client = WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        registry = build_sprint6_agentic_registry()
        bind_runtime_handlers(
            registry,
            api_client=api_client,
            user_id="worker-runtime",
            organization_id="worker-runtime",
        )
        kwargs["agentic_tool_resolver"] = AgenticToolResolver(
            registry,
            ApiPbacToolAuthorizer(
                base_url=config.nestjs_api_base_url,
                worker_api_key=config.worker_api_key,
                timeout_seconds=config.pbac_preflight.timeout_seconds,
            ),
            max_tool_calls=config.agentic_runtime.max_tool_calls,
        )

    if "llm_client" in constructor.parameters:
        llm_client = _build_llm_client(config)
        if llm_client is not None:
            kwargs["llm_client"] = llm_client

    return consumer_type(config, **kwargs)


def _build_llm_client(config):
    """Build the budget-aware primary/fallback LLM client when enabled.

    Providers without credentials are ignored. Returning ``None`` deliberately
    preserves deterministic worker behavior when LLM runtime is disabled or no
    usable provider has been configured.

    Args:
        config: Loaded worker configuration containing LLM runtime settings.

    Returns:
        A ``PrimaryThenFallbackLLMClient`` when at least one provider is
        available; otherwise ``None``.
    """
    runtime = config.llm_runtime
    if not runtime.enabled:
        return None

    budget_tracker = BudgetTracker(
        monthly_budget_usd=runtime.monthly_budget_usd,
        monthly_token_cap=runtime.monthly_token_cap,
        redis_url=runtime.redis_url,
    )
    providers: list[LlmProviderCandidate] = []
    for provider in runtime.providers:
        if not provider.api_key:
            continue
        providers.append(
            LlmProviderCandidate(
                name=provider.provider,
                client=LLMGatewayClient(
                    provider=provider.provider,
                    api_key=provider.api_key,
                    model=provider.model,
                    budget_tracker=budget_tracker,
                    max_tokens_per_call=runtime.max_tokens_per_call,
                    timeout_seconds=runtime.provider_timeout_seconds,
                ),
            )
        )

    if not providers:
        return None

    return PrimaryThenFallbackLLMClient(
        tuple(providers),
        fallback_on_codes=runtime.fallback_on_codes,
        max_provider_attempts=runtime.max_provider_attempts,
    )


def main() -> None:
    """Parse the worker target from the CLI and run the configured consumer."""
    parser = argparse.ArgumentParser(
        description="Run one LCSP RabbitMQ worker consumer."
    )
    parser.add_argument(
        "target",
        help="Consumer import target in module.path:ClassName format",
    )
    args = parser.parse_args()

    consumer = _build_consumer(args.target)
    consumer.run()


if __name__ == "__main__":
    main()
