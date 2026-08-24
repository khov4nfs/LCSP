"""LLM runtime grouped by client entrypoint and owned support capabilities."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from pathlib import Path
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "providers": frozenset({"fallback_client"}),
    "budget": frozenset({"budget_tracker"}),
    "safety": frozenset({"prompt_safety"}),
    "sandbox": frozenset({"docker_sandbox"}),
}
_ROOT_MODULES: Final[frozenset[str]] = frozenset({"deep_agent_client"})
_PREFIXES: Final[tuple[str, ...]] = (
    "runtime.infrastructure.llm.",
    "tools.common.llm.",
    "runtime.platform.llm.",
)
_PHYSICAL_ROOT = Path(__file__).resolve().parent


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _parts(fullname: str) -> list[str] | None:
    for prefix in _PREFIXES:
        if fullname.startswith(prefix):
            return fullname[len(prefix) :].split(".")
    return None


def _physical_module_path(fullname: str) -> Path | None:
    parts = _parts(fullname)
    if not parts:
        return None

    head = parts[0]
    if head in _ROOT_MODULES:
        return None

    if head in _CAPABILITY_MODULES:
        if len(parts) < 2:
            return None
        nested = parts[1]
        if nested in _ROOT_MODULES:
            return _PHYSICAL_ROOT / f"{nested}.py"
        owner = _owner(nested)
        if owner is not None and owner != head:
            return _PHYSICAL_ROOT / owner / f"{nested}.py"
        return None

    owner = _owner(head)
    if owner is not None:
        return _PHYSICAL_ROOT / owner / f"{head}.py"
    return None


class _LlmCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Route flat and moved-relative LLM support imports to physical owners."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        module_path = _physical_module_path(fullname)
        if module_path is None or not module_path.is_file():
            return None
        return importlib.util.spec_from_file_location(fullname, module_path)


# Install before importing DeepAgentClient: that implementation intentionally keeps
# migration-era `tools.common.llm.*` imports while the physical runtime tree is split.
if not any(isinstance(finder, _LlmCapabilityAliasFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _LlmCapabilityAliasFinder())

from .deep_agent_client import (
    DeepAgentClient,
    LLMResponse,
    LLMStructuredResponse,
    LLMToolCall,
    LLMToolDefinition,
    LLMToolResponse,
)
from .providers.fallback_client import (
    LLMClientProtocol,
    LlmProviderCandidate,
    LlmProviderUnavailableError,
    PrimaryThenFallbackLLMClient,
    classify_provider_error,
    llm_limit_wait_reason,
)
from .safety.prompt_safety import PromptSafetyViolation, check_prompt_safety
from .budget.budget_tracker import BudgetTracker, BudgetExceeded

__all__ = [
    "DeepAgentClient",
    "LLMResponse",
    "LLMStructuredResponse",
    "LLMToolCall",
    "LLMToolDefinition",
    "LLMToolResponse",
    "LLMClientProtocol",
    "LlmProviderCandidate",
    "LlmProviderUnavailableError",
    "PrimaryThenFallbackLLMClient",
    "classify_provider_error",
    "llm_limit_wait_reason",
    "PromptSafetyViolation",
    "check_prompt_safety",
    "BudgetTracker",
    "BudgetExceeded",
]
