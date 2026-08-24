"""Agentic evidence provenance runtime grouped by governance, dispatch, and entrypoints."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from pathlib import Path
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "governance": frozenset({"authorization", "catalog", "registry", "resolver"}),
    "dispatch": frozenset({"dispatcher", "runtime_binding"}),
    "entrypoints": frozenset(
        {
            "tool_entrypoints",
            "program_graph_tool_entrypoints",
            "scanner_tool_entrypoints",
            "legal_tool_entrypoints",
            "remediation_tool_entrypoints",
        }
    ),
}
_PREFIXES: Final[tuple[str, ...]] = tuple(
    dict.fromkeys(
        (
            f"{__name__}.",
            "runtime.evidence.provenance.",
            "runtime.platform.agentic_evidence.",
            "tools.common.agentic_evidence.",
        )
    )
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
    if head in _CAPABILITY_MODULES:
        if len(parts) < 2:
            return None
        nested = parts[1]
        owner = _owner(nested)
        if owner is None or owner == head:
            return None
        return _PHYSICAL_ROOT / owner / f"{nested}.py"

    owner = _owner(head)
    if owner is None:
        return None
    return _PHYSICAL_ROOT / owner / f"{head}.py"


class _ProvenanceCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Route migration-era flat and moved-relative imports to physical owners."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        module_path = _physical_module_path(fullname)
        if module_path is None or not module_path.is_file():
            return None
        return importlib.util.spec_from_file_location(fullname, module_path)


# Install before eager public imports: moved source blobs intentionally retain
# sibling-relative imports while the rest of the codebase migrates to owner paths.
if not any(isinstance(finder, _ProvenanceCapabilityAliasFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _ProvenanceCapabilityAliasFinder())

from .governance.authorization import (
    AgenticAuthorizationResult,
    AgenticToolAuthorizer,
    ApiPbacToolAuthorizer,
    TOOL_PBAC_ACTIONS,
)
from .governance.catalog import (
    AgenticToolSpec,
    AGENTIC_TOOL_SPECS,
    build_llm_tool_definitions,
    llm_callable_tool_specs,
)
from .dispatch.dispatcher import (
    ALL_TOOL_BINDINGS,
    AO1_SCANNER_TOOL_BINDINGS,
    AO6_LEGAL_TOOL_BINDINGS,
    NEST_CQRS_DISCOVERY_BINDINGS,
    PROTECTED_COMMAND_BINDINGS,
    AgenticToolBinding,
    AgenticToolDispatcher,
    AgenticToolRuntimeTarget,
    LegalToolDispatcher,
    SPRINT6_AGENTIC_TOOL_BINDINGS,
    ScannerToolDispatcher,
    ToolBinding,
    ToolRuntimeTarget,
    runtime_binding,
    tool_runtime_manifest,
)
from .entrypoints.legal_tool_entrypoints import LegalToolExecutionContext
from .governance.registry import (
    AgenticToolBudget,
    AgenticToolCapability,
    AgenticToolRegistry,
    AgenticToolRequest,
    AgenticToolValidationError,
    SPRINT6_AGENTIC_CAPABILITIES,
    build_sprint6_agentic_registry,
)
from .governance.resolver import (
    AgenticInvocationContext,
    AgenticToolCallResult,
    AgenticToolResolver,
)
from .dispatch.runtime_binding import bind_runtime_handlers
from .entrypoints.scanner_tool_entrypoints import ScannerToolExecutionContext
from .entrypoints.tool_entrypoints import AgenticToolExecutionContext

__all__ = [
    "ALL_TOOL_BINDINGS",
    "AO1_SCANNER_TOOL_BINDINGS",
    "AO6_LEGAL_TOOL_BINDINGS",
    "NEST_CQRS_DISCOVERY_BINDINGS",
    "PROTECTED_COMMAND_BINDINGS",
    "AGENTIC_TOOL_SPECS",
    "AgenticAuthorizationResult",
    "AgenticInvocationContext",
    "AgenticToolAuthorizer",
    "AgenticToolBinding",
    "AgenticToolBudget",
    "AgenticToolCallResult",
    "AgenticToolCapability",
    "AgenticToolDispatcher",
    "AgenticToolExecutionContext",
    "AgenticToolRegistry",
    "AgenticToolRequest",
    "AgenticToolResolver",
    "AgenticToolRuntimeTarget",
    "AgenticToolSpec",
    "AgenticToolValidationError",
    "ApiPbacToolAuthorizer",
    "LegalToolDispatcher",
    "LegalToolExecutionContext",
    "SPRINT6_AGENTIC_CAPABILITIES",
    "SPRINT6_AGENTIC_TOOL_BINDINGS",
    "ScannerToolDispatcher",
    "ScannerToolExecutionContext",
    "TOOL_PBAC_ACTIONS",
    "ToolBinding",
    "ToolRuntimeTarget",
    "bind_runtime_handlers",
    "build_llm_tool_definitions",
    "build_sprint6_agentic_registry",
    "llm_callable_tool_specs",
    "runtime_binding",
    "tool_runtime_manifest",
]
