"""Program-graph resolution runtime grouped by resolution capability."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "boundary": frozenset(
        {"api_boundary_resolution", "python_agent_boundary_resolution"}
    ),
    "framework": frozenset(
        {
            "framework_boundary_finalizer",
            "framework_links",
            "framework_metadata",
            "framework_resolution",
            "python_framework_adapters",
        }
    ),
    "architecture": frozenset(
        {
            "javascript_architecture_resolution",
            "managed_architecture_resolution",
            "python_architecture_resolution",
            "redux_extended_resolution",
        }
    ),
    "dispatch": frozenset(
        {"generic_dispatch_resolution", "protocol_resolution"}
    ),
}
_PREFIX = f"{__name__}."
_GRAPH_PREFIX = "runtime.evidence.graph."


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _canonical_resolution_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts:
        return None

    # Historical flat import: resolution.framework_links -> resolution.framework.framework_links.
    if parts[0] not in _CAPABILITY_MODULES:
        owner = _owner(parts[0])
        if owner is None:
            return None
        target = f"{_PREFIX}{owner}.{parts[0]}"
        tail = ".".join(parts[1:])
        return f"{target}.{tail}" if tail else target

    # Moved modules still contain sibling-relative imports. First route another
    # resolution module to its physical owner.
    if len(parts) >= 2:
        nested = parts[1]
        owner = _owner(nested)
        tail = ".".join(parts[2:])
        if owner is not None and owner != parts[0]:
            target = f"{_PREFIX}{owner}.{nested}"
            return f"{target}.{tail}" if tail else target

        # Relative imports such as `.models` historically relied on every graph
        # module sharing one flat package. Delegate those names back to the graph
        # root, whose alias finder resolves schema/construction/lineage/query owners.
        if owner is None:
            target = f"{_GRAPH_PREFIX}{nested}"
            return f"{target}.{tail}" if tail else target

    return None


class _ResolutionCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Resolve flat and moved-relative resolution imports to canonical owners."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_resolution_name(fullname)
        if canonical is None or canonical == fullname:
            return None
        spec = importlib.util.find_spec(canonical)
        if spec is None or spec.origin is None:
            return None
        locations = spec.submodule_search_locations
        return importlib.util.spec_from_file_location(
            fullname,
            spec.origin,
            submodule_search_locations=list(locations) if locations is not None else None,
        )


if not any(
    isinstance(finder, _ResolutionCapabilityAliasFinder) for finder in sys.meta_path
):
    sys.meta_path.insert(0, _ResolutionCapabilityAliasFinder())
