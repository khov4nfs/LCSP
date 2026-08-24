"""Vectorless legal retrieval runtime grouped by retrieval capability."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "index": frozenset(
        {
            "chroma_path",
            "chroma_vectorless",
            "legal_retrieval_index_boundary",
            "legal_retrieval_index_builder",
            "legal_retrieval_index_repository",
        }
    ),
    "legal_basis": frozenset(
        {
            "chromadb_citation_retriever",
            "legal_match_builder",
            "legal_retrieval_boundary",
            "normative_chunk_filter",
            "rule_applicability_evaluator",
        }
    ),
}
_PREFIX = f"{__name__}."


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _canonical_retrieval_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts:
        return None
    if parts[0] in _CAPABILITY_MODULES:
        if len(parts) >= 2:
            owner = _owner(parts[1])
            if owner is not None and owner != parts[0]:
                target = f"{_PREFIX}{owner}.{parts[1]}"
                tail = ".".join(parts[2:])
                return f"{target}.{tail}" if tail else target
        return None
    owner = _owner(parts[0])
    if owner is None:
        return None
    target = f"{_PREFIX}{owner}.{parts[0]}"
    tail = ".".join(parts[1:])
    return f"{target}.{tail}" if tail else target


class _RetrievalCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_retrieval_name(fullname)
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


if not any(isinstance(finder, _RetrievalCapabilityAliasFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _RetrievalCapabilityAliasFinder())
