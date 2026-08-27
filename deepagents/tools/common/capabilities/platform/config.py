"""Load and validate Managed Deep Agent, agentic, RBAC, and checkpoint configuration."""

import os
from dataclasses import dataclass
from pathlib import Path

from tools.common.capabilities.platform.env import load_runtime_env
from tools.common.capabilities.platform.logging_path import get_repo_root


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
class RbacPreflightConfig:
    """Timeout settings for worker-side RBAC authorization preflight."""

    timeout_seconds: float = 5.0


@dataclass(frozen=True)
class TracingConfig:
    """Phoenix/OpenTelemetry tracing settings for worker instrumentation."""

    enabled: bool = False
    project_name: str = "deepagents"
    collector_endpoint: str = "http://localhost:6006/v1/traces"


@dataclass(frozen=True)
class WorkerConfig:
    """Complete immutable runtime configuration shared by Managed Agent tools."""

    nestjs_api_base_url: str
    worker_api_key: str
    log_level: str
    max_retries: int
    legal_source_storage_root: str | None = None
    langgraph_checkpoint_database_url: str | None = None
    agentic_runtime: AgenticRuntimeConfig = AgenticRuntimeConfig()
    rbac_preflight: RbacPreflightConfig = RbacPreflightConfig()
    tracing: TracingConfig = TracingConfig()


def default_legal_source_storage_root() -> str:
    """Return the repository-level runtime corpus artifact root."""
    return str(Path(get_repo_root()) / ".corpus")


def load_config() -> WorkerConfig:
    """Load environment-backed worker configuration and validate required values.

    Returns:
        Fully parsed ``WorkerConfig`` including nested LLM/agentic/RBAC settings.

    Raises:
        RuntimeError: If required variables or typed optional settings are invalid.
    """
    load_runtime_env()

    missing = [
        v
        for v in ["NESTJS_API_BASE_URL", "WORKER_API_KEY"]
        if not os.getenv(v)
    ]
    if missing:
        raise RuntimeError(f"Missing required env vars: {missing}")

    return WorkerConfig(
        nestjs_api_base_url=os.getenv("NESTJS_API_BASE_URL"),
        worker_api_key=os.getenv("WORKER_API_KEY"),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        max_retries=int(os.getenv("MAX_RETRIES", "3")),
        legal_source_storage_root=os.getenv(
            "LEGAL_SOURCE_STORAGE_ROOT",
            default_legal_source_storage_root(),
        ),
        langgraph_checkpoint_database_url=os.getenv(
            "LANGGRAPH_CHECKPOINT_DATABASE_URL"
        ),
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
        rbac_preflight=RbacPreflightConfig(
            timeout_seconds=float(
                os.getenv("RBAC_PREFLIGHT_TIMEOUT_SECONDS", "5.0")
            )
        ),
        tracing=_load_tracing_config(),
    )


def load_tracing_config() -> TracingConfig:
    """Load tracing-only config without requiring the full worker environment."""
    load_runtime_env()
    return _load_tracing_config()


def _load_tracing_config() -> TracingConfig:
    """Load optional Phoenix tracing settings from the environment."""
    return TracingConfig(
        enabled=_read_bool("PHOENIX_TRACING", False)
        or _read_bool("LOCAL_TRACING", False),
        project_name=_optional_text("PHOENIX_PROJECT")
        or "deepagents",
        collector_endpoint=_optional_text("PHOENIX_COLLECTOR_ENDPOINT")
        or "http://localhost:6006/v1/traces",
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


def _optional_text(name: str) -> str | None:
    """Read and trim an optional text environment variable."""
    value = os.getenv(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None
