"""Legal corpus runtime grouped by artifact lifecycle capability."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "chunk_integrity": frozenset(
        {"chunk_integrity_boundary", "chunk_integrity_repository", "chunk_integrity_validator"}
    ),
    "legal_chunks": frozenset(
        {"legal_chunk_boundary", "legal_chunk_builder", "legal_chunk_repository"}
    ),
    "reviewed_input": frozenset(
        {
            "reviewed_corpus_input_boundary",
            "reviewed_corpus_input_builder",
            "reviewed_corpus_input_repository",
        }
    ),
    "partial_update": frozenset({"partial_update_context_builder"}),
    "relationships": frozenset({"relationship_manifest_repository"}),
}
_EXTERNAL_SOURCE_MODULES: Final[dict[str, str]] = {
    "official_text_extraction": "runtime.legal.sources.extraction.official_text_extraction",
    "official_text_extraction_repository": (
        "runtime.legal.sources.extraction.official_text_extraction_repository"
    ),
    "ocr_fallback_repository": "runtime.legal.sources.ocr_fallback.ocr_fallback_repository",
    "ocr_quality_repository": "runtime.legal.sources.ocr_quality.ocr_quality_repository",
}
_PREFIX = f"{__name__}."


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _canonical_corpus_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts:
        return None

    if parts[0] in _CAPABILITY_MODULES:
        if len(parts) >= 2:
            external = _EXTERNAL_SOURCE_MODULES.get(parts[1])
            if external is not None:
                tail = ".".join(parts[2:])
                return f"{external}.{tail}" if tail else external
            owner = _owner(parts[1])
            if owner is not None and owner != parts[0]:
                target = f"{_PREFIX}{owner}.{parts[1]}"
                tail = ".".join(parts[2:])
                return f"{target}.{tail}" if tail else target
        return None

    if parts[0] in {"engineering_rules", "models"}:
        return None

    external = _EXTERNAL_SOURCE_MODULES.get(parts[0])
    if external is not None:
        tail = ".".join(parts[1:])
        return f"{external}.{tail}" if tail else external

    owner = _owner(parts[0])
    if owner is None:
        return None
    target = f"{_PREFIX}{owner}.{parts[0]}"
    tail = ".".join(parts[1:])
    return f"{target}.{tail}" if tail else target


class _CorpusCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_corpus_name(fullname)
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


if not any(isinstance(finder, _CorpusCapabilityAliasFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _CorpusCapabilityAliasFinder())
