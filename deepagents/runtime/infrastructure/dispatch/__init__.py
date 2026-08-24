"""Infrastructure dispatch runtime grouped by owned support capability.

`tool_dispatch` and `graph_runtime` remain the two dispatch entrypoints. Logging,
tracing and development diagnostics live under `observability`; Wizard request
payload support lives under `clarification`.
"""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Final

_OBSERVABILITY_MODULES: Final[frozenset[str]] = frozenset(
    {
        "correlation",
        "dev_unsafe_instrumentation",
        "dev_unsafe_trace",
        "logging",
        "logging_config",
        "logging_path",
        "orchestration_logging",
        "tracing",
    }
)
_CLARIFICATION_MODULES: Final[frozenset[str]] = frozenset({"wizard_clarification"})
_PREFIX = f"{__name__}."


def _canonical_dispatch_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    suffix = fullname[len(_PREFIX) :]
    head, _, tail = suffix.partition(".")

    if head in _OBSERVABILITY_MODULES:
        target = f"{_PREFIX}observability.{head}"
        return f"{target}.{tail}" if tail else target
    if head in _CLARIFICATION_MODULES:
        target = f"{_PREFIX}clarification.{head}"
        return f"{target}.{tail}" if tail else target
    return None


class _DispatchCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Route migration-era flat dispatch imports to capability packages."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_dispatch_name(fullname)
        if canonical is None or canonical == fullname:
            return None
        canonical_spec = importlib.util.find_spec(canonical)
        if canonical_spec is None or canonical_spec.origin is None:
            return None
        locations = canonical_spec.submodule_search_locations
        return importlib.util.spec_from_file_location(
            fullname,
            canonical_spec.origin,
            submodule_search_locations=list(locations) if locations is not None else None,
        )


def _install_dispatch_aliases() -> None:
    if not any(
        isinstance(finder, _DispatchCapabilityAliasFinder) for finder in sys.meta_path
    ):
        sys.meta_path.insert(0, _DispatchCapabilityAliasFinder())


_install_dispatch_aliases()
