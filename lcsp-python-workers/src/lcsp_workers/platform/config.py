"""Load and validate worker, LLM, agentic, PBAC, and checkpoint configuration."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class LlmProviderConfig:
    """Configuration for one ordered LLM provider candidate."""

    provider: str
    model: str
    api_key: str | None
    api_key_env: str


@dataclass(frozen=True)
class LlmRuntimeConfig:
    """Budget, timeout, and provider-fallback policy for LLM-assisted workers."""

    providers: tuple[LlmProviderConfig, ...] = ()
    max_tokens_per_call: int = 4096
    monthly_budget_usd: float = 100.0
    monthly_token_cap: int = 1_000_000
    provider_timeout_seconds: float = 30.0
    fallback_on_codes: tuple[str, ...] = (
        "RATE_LIMIT",
        "QUOTA",
        "NETWORK",
        "TIMEOUT",
    )
    max_provider_attempts: int = 3
    redis_url: str | None = None

    @property
    def enabled(self) -> bool:
        """Return whether at least one LLM provider has been configured."""
        return len(self.providers) > 0


@dataclass(frozen=True)
class AgenticRuntimeConfig:
    """Limits and dispatch settings for model-callable read-only agentic tools."""

    enabled: bool = False
    max_tool_calls: int = 8
    default_max_items: int = 25
    default_max_depth: int = 5
    default_max_bytes: int = 131_072
    default_timeout_ms: int = 4_000
    dispatch_path: str = "/internal/evidence/agentic-tools/dispatch"


@dataclass(frozen=True)
class PbacPreflightConfig:
    """Timeout settings for worker-side PBAC authorization preflight."""

    timeout_seconds: float = 5.0


@dataclass(frozen=True)
class WorkerConfig:
    """Complete immutable runtime configuration shared by worker consumers."""

    rabbitmq_url: str
    rabbitmq_exchange: str
    nestjs_api_base_url: str
    worker_api_key: str
    log_level: str
    max_retries: int
    legal_source_storage_root: str | None = None
    langgraph_checkpoint_database_url: str | None = None
    llm_runtime: LlmRuntimeConfig = LlmRuntimeConfig()
    agentic_runtime: AgenticRuntimeConfig = AgenticRuntimeConfig()
    pbac_preflight: PbacPreflightConfig = PbacPreflightConfig()


def load_config() -> WorkerConfig:
    """Load environment-backed worker configuration and validate required values.

    Returns:
        Fully parsed ``WorkerConfig`` including nested LLM/agentic/PBAC settings.

    Raises:
        RuntimeError: If required variables or typed optional settings are invalid.
    """
    load_dotenv()
    missing = [
        v
        for v in ["RABBITMQ_URL", "NESTJS_API_BASE_URL", "WORKER_API_KEY"]
        if not os.getenv(v)
    ]
    if missing:
        raise RuntimeError(f"Missing required env vars: {missing}")

    return WorkerConfig(
        rabbitmq_url=os.getenv("RABBITMQ_URL"),
        rabbitmq_exchange=os.getenv("RABBITMQ_EXCHANGE", "lcsp.events"),
        nestjs_api_base_url=os.getenv("NESTJS_API_BASE_URL"),
        worker_api_key=os.getenv("WORKER_API_KEY"),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        max_retries=int(os.getenv("MAX_RETRIES", "3")),
        legal_source_storage_root=os.getenv("LEGAL_SOURCE_STORAGE_ROOT"),
        langgraph_checkpoint_database_url=os.getenv(
            "LANGGRAPH_CHECKPOINT_DATABASE_URL"
        ),
        llm_runtime=_load_llm_runtime_config(),
        agentic_runtime=AgenticRuntimeConfig(
            enabled=_read_bool("AGENTIC_RUNTIME_ENABLED", False),
            max_tool_calls=_read_int("AGENTIC_RUNTIME_MAX_TOOL_CALLS", 8),
            default_max_items=_read_int("AGENTIC_RUNTIME_DEFAULT_MAX_ITEMS", 25),
            default_max_depth=_read_int("AGENTIC_RUNTIME_DEFAULT_MAX_DEPTH", 5),
            default_max_bytes=_read_int(
                "AGENTIC_RUNTIME_DEFAULT_MAX_BYTES", 131_072
            ),
            default_timeout_ms=_read_int(
                "AGENTIC_RUNTIME_DEFAULT_TIMEOUT_MS", 4_000
            ),
            dispatch_path=os.getenv(
                "AGENTIC_RUNTIME_DISPATCH_PATH",
                "/internal/evidence/agentic-tools/dispatch",
            ),
        ),
        pbac_preflight=PbacPreflightConfig(
            timeout_seconds=float(
                os.getenv("PBAC_PREFLIGHT_TIMEOUT_SECONDS", "5.0")
            )
        ),
    )


def _read_bool(name: str, default: bool) -> bool:
    """Parse a conventional boolean environment variable or return its default."""
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"Invalid boolean env var: {name}")


def _read_int(name: str, default: int) -> int:
    """Parse an integer environment variable with a typed configuration error."""
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"Invalid integer env var: {name}") from exc


def _load_llm_runtime_config() -> LlmRuntimeConfig:
    """Load ordered primary/fallback providers plus budget/fallback policy."""
    providers: list[LlmProviderConfig] = []

    primary_provider = _optional_text("LLM_PRIMARY_PROVIDER")
    primary_model = _optional_text("LLM_PRIMARY_MODEL")
    if primary_provider and primary_model:
        providers.append(
            LlmProviderConfig(
                provider=primary_provider.lower(),
                model=primary_model,
                api_key=_provider_api_key(primary_provider),
                api_key_env=_provider_api_key_env(primary_provider),
            )
        )

    index = 1
    while True:
        provider = _optional_text(f"LLM_FALLBACK_PROVIDER_{index}")
        model = _optional_text(f"LLM_FALLBACK_MODEL_{index}")
        if not provider and not model:
            break
        if not provider or not model:
            raise RuntimeError(
                f"Incomplete LLM fallback config at index {index}: provider/model required"
            )
        providers.append(
            LlmProviderConfig(
                provider=provider.lower(),
                model=model,
                api_key=_provider_api_key(provider),
                api_key_env=_provider_api_key_env(provider),
            )
        )
        index += 1

    return LlmRuntimeConfig(
        providers=tuple(providers),
        max_tokens_per_call=_read_int("LLM_MAX_TOKENS_PER_CALL", 4096),
        monthly_budget_usd=_read_float("LLM_MONTHLY_BUDGET_USD", 100.0),
        monthly_token_cap=_read_int("LLM_MONTHLY_TOKEN_CAP", 1_000_000),
        provider_timeout_seconds=_read_float("LLM_PROVIDER_TIMEOUT_SECONDS", 30.0),
        fallback_on_codes=_read_csv(
            "LLM_FALLBACK_ON_CODES",
            ("RATE_LIMIT", "QUOTA", "NETWORK", "TIMEOUT"),
        ),
        max_provider_attempts=_read_int("LLM_MAX_PROVIDER_ATTEMPTS", 3),
        redis_url=_optional_text("LLM_BUDGET_REDIS_URL"),
    )


def _provider_api_key(provider: str) -> str | None:
    """Resolve a provider's credential from its supported environment variable."""
    env_name = _provider_api_key_env(provider)
    return _optional_text(env_name)


def _provider_api_key_env(provider: str) -> str:
    """Map a supported provider name to its credential environment variable."""
    normalized = provider.strip().lower()
    if normalized == "openai":
        return "OPENAI_API_KEY"
    if normalized == "anthropic":
        return "ANTHROPIC_API_KEY"
    if normalized in {"gemini", "google", "google-genai"}:
        gemini = _optional_text("GEMINI_API_KEY")
        if gemini is not None:
            return "GEMINI_API_KEY"
        return "GOOGLE_API_KEY"
    raise RuntimeError(f"Unsupported LLM provider in env config: {provider}")


def _optional_text(name: str) -> str | None:
    """Read and trim an optional text environment variable."""
    value = os.getenv(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _read_float(name: str, default: float) -> float:
    """Parse a float environment variable with a typed configuration error."""
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise RuntimeError(f"Invalid float env var: {name}") from exc


def _read_csv(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    """Parse a comma-separated uppercase policy list, falling back when empty."""
    value = os.getenv(name)
    if value is None:
        return default
    parts = tuple(
        part.strip().upper() for part in value.split(",") if part.strip()
    )
    return parts or default
