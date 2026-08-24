"""EngineeringRule corpus runtime grouped by lifecycle capability."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from pathlib import Path
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "contract": frozenset({"models", "legal_reasoning_contract", "validator"}),
    "compilation": frozenset({"chunk_triage", "compiler", "fingerprint"}),
    "registry": frozenset({"cache", "precompiled_contract_overrides", "precompiled_registry"}),
    "orchestration": frozenset({"service"}),
}
_PREFIXES: Final[tuple[str, ...]] = tuple(
    dict.fromkeys(
        (
            f"{__name__}.",
            "runtime.legal.corpus.engineering_rules.",
            "tools.legal.legal.engineering_rules.",
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


class _EngineeringRuleCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Route flat and moved-relative EngineeringRule imports to physical owners."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        module_path = _physical_module_path(fullname)
        if module_path is None or not module_path.is_file():
            return None
        return importlib.util.spec_from_file_location(fullname, module_path)


# Install before importing lifecycle modules: moved source blobs intentionally retain
# migration-era sibling-relative imports such as ``registry.cache -> .models``.
if not any(
    isinstance(finder, _EngineeringRuleCapabilityAliasFinder) for finder in sys.meta_path
):
    sys.meta_path.insert(0, _EngineeringRuleCapabilityAliasFinder())

from .registry.cache import EngineeringRuleCache
from .compilation.compiler import COMPILER_VERSION, PROMPT_VERSION, EngineeringRuleCompiler
from .compilation.fingerprint import engineering_rule_fingerprint
from .contract.legal_reasoning_contract import (
    LEGAL_REASONING_CONTRACT_SCHEMA_VERSION,
    LEGAL_REASONING_PLANNER_AUTHORITY,
    LegalReasoningContract,
    LegalReasoningContractValidationError,
    build_legal_reasoning_contract,
    validate_legal_reasoning_contract,
)
from .contract.models import ENGINEERING_RULE_SCHEMA_VERSION, EngineeringRule, GraphQueryTemplate
from .orchestration.service import EngineeringRuleService
from .contract.validator import EngineeringRuleValidationError, validate_engineering_rule

__all__ = [
    "EngineeringRuleCache",
    "EngineeringRuleService",
    "COMPILER_VERSION",
    "PROMPT_VERSION",
    "EngineeringRuleCompiler",
    "engineering_rule_fingerprint",
    "ENGINEERING_RULE_SCHEMA_VERSION",
    "LEGAL_REASONING_CONTRACT_SCHEMA_VERSION",
    "LEGAL_REASONING_PLANNER_AUTHORITY",
    "EngineeringRule",
    "GraphQueryTemplate",
    "LegalReasoningContract",
    "LegalReasoningContractValidationError",
    "build_legal_reasoning_contract",
    "validate_legal_reasoning_contract",
    "EngineeringRuleValidationError",
    "validate_engineering_rule",
]
