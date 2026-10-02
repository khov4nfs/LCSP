from __future__ import annotations

import re
from pathlib import Path

import pytest

from tools.common.capabilities.agent_runtime import local_server
from tools.common.capabilities.agentic_evidence.governance.resolver import (
    DEFAULT_MAX_TOOL_CALLS,
    AgenticToolResolver,
)
from tools.common.capabilities.platform import config as config_module
from tools.common.capabilities.platform.config import WorkerConfig, load_config
from tools.common.capabilities.platform.orchestration_logging import (
    orchestration_debug_enabled,
)

WORKER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = WORKER_ROOT.parent
RETIRED_ENV = (
    "AGENTIC_RUNTIME_",
    "PBAC_PREFLIGHT_TIMEOUT_SECONDS",
    "LLM_PRIMARY_",
    "LLM_FALLBACK_",
    "LLM_MODEL_PRICING",
    "LLM_MONTHLY_",
    "LLM_MAX_PROVIDER_ATTEMPTS",
    "LLM_MAX_TOKENS_PER_CALL",
    "LCSP_MODEL_PROVIDER",
    "WORKER_RUNTIME_VERSION",
    "WORKER_RUNTIME_BUILD_REF",
    "MDA_INGRESS_SECRET",
    "MDA_PUBLIC_API_URL",
    "REDIS_URI",
    "LLM_BUDGET_REDIS_URL",
)


def _env(monkeypatch) -> None:
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://api.test")
    monkeypatch.setenv("WORKER_API_KEY", "worker-key")


def test_agentic_runtime_config_is_gone(monkeypatch) -> None:
    assert not hasattr(config_module, "AgenticRuntimeConfig")
    _env(monkeypatch)
    monkeypatch.setenv("AGENTIC_RUNTIME_MAX_TOOL_CALLS", "3")
    assert not hasattr(load_config(), "agentic_runtime")
    assert "agentic_runtime" not in WorkerConfig.__dataclass_fields__


def test_checkpoint_database_falls_back_to_database_url(monkeypatch) -> None:
    _env(monkeypatch)
    monkeypatch.delenv("LANGGRAPH_CHECKPOINT_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db/lcsp")
    assert load_config().langgraph_checkpoint_database_url == "postgresql://u:p@db/lcsp"
    monkeypatch.setenv("LANGGRAPH_CHECKPOINT_DATABASE_URL", "postgresql://u:p@db/ckpt")
    assert load_config().langgraph_checkpoint_database_url == "postgresql://u:p@db/ckpt"


def test_local_server_checkpointer_uses_database_url_fallback(monkeypatch) -> None:
    monkeypatch.delenv("LANGGRAPH_CHECKPOINT_DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_URI", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("LCSP_AGENT_RUNTIME_MODE", raising=False)
    from langgraph.checkpoint.memory import InMemorySaver

    assert isinstance(local_server.LocalAgentRuntime()._open_checkpointer(), InMemorySaver)
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_MODE", "production")
    with pytest.raises(RuntimeError, match="LANGGRAPH_CHECKPOINT_DATABASE_URL"):
        local_server.LocalAgentRuntime()._open_checkpointer()
    monkeypatch.setenv("DATABASE_URL", "mysql://nope")
    with pytest.raises(ValueError, match="postgres"):
        local_server.LocalAgentRuntime()._open_checkpointer()


def test_surviving_tool_call_limit_is_one_fixed_default() -> None:
    assert DEFAULT_MAX_TOOL_CALLS == 8
    resolver = AgenticToolResolver(object(), object())
    assert resolver.max_tool_calls == DEFAULT_MAX_TOOL_CALLS
    with pytest.raises(ValueError):
        AgenticToolResolver(object(), object(), max_tool_calls=0)


def test_orchestration_debug_is_off_unless_explicitly_true(monkeypatch) -> None:
    monkeypatch.delenv("ORCHESTRATION_DEBUG", raising=False)
    assert orchestration_debug_enabled() is False
    monkeypatch.setenv("ORCHESTRATION_DEBUG", "true")
    assert orchestration_debug_enabled() is True
    run_mjs = (REPO_ROOT / "scripts" / "run.mjs").read_text(encoding="utf-8")
    assert not re.search(r"ORCHESTRATION_DEBUG\s*:", run_mjs)


def test_retired_env_names_are_not_consumed_by_worker_code() -> None:
    offenders: list[str] = []
    skip = {".venv", ".mda", "node_modules", "tests", "__pycache__"}
    for path in WORKER_ROOT.rglob("*.py"):
        if skip & set(path.relative_to(WORKER_ROOT).parts):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        offenders += [f"{path.name}:{name}" for name in RETIRED_ENV if name in text]
    assert offenders == []


def test_worker_usage_path_has_no_pricing_or_reservation_terms() -> None:
    for name in ("middleware/usage_metering.py", "middleware/usage_recovery.py"):
        text = (WORKER_ROOT / name).read_text(encoding="utf-8").lower()
        code = re.sub(r'""".*?"""', "", text, flags=re.S)
        for term in ("pricing_snapshot", "reserve(", "reservation_id", "max_charge", "amountcredits"):
            assert term not in code, f"{name}: {term}"
