"""Program-graph construction runtime grouped by construction capability."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "assembly": frozenset({"assembler", "builder"}),
    "extraction": frozenset({"extractor", "source_evidence"}),
    "validation": frozenset({"semantic_integrity", "validator"}),
}
_PREFIX = f"{__name__}."
_GRAPH_PREFIX = "runtime.evidence.graph."


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _canonical_construction_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts:
        return None
    if parts[0] not in _CAPABILITY_MODULES:
        owner = _owner(parts[0])
        if owner is None:
            return None
        target = f"{_PREFIX}{owner}.{parts[0]}"
        tail = ".".join(parts[1:])
        return f"{target}.{tail}" if tail else target
    if len(parts) >= 2:
        nested = parts[1]
        owner = _owner(nested)
        tail = ".".join(parts[2:])
        if owner is not None and owner != parts[0]:
            target = f"{_PREFIX}{owner}.{nested}"
            return f"{target}.{tail}" if tail else target
        if owner is None:
            target = f"{_GRAPH_PREFIX}{nested}"
            return f"{target}.{tail}" if tail else target
    return None


class _ConstructionCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_construction_name(fullname)
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
    isinstance(finder, _ConstructionCapabilityAliasFinder) for finder in sys.meta_path
):
    sys.meta_path.insert(0, _ConstructionCapabilityAliasFinder())
