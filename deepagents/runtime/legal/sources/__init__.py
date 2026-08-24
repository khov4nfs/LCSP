"""Official legal-source runtime grouped by source-processing capability."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "change_detection": frozenset({"legal_change_detector_boundary"}),
    "recovery": frozenset({"legal_corpus_recovery_boundary", "legal_corpus_recovery_driver"}),
    "ingest": frozenset({"legal_source_ingest_boundary", "official_source_snapshot"}),
    "extraction": frozenset(
        {
            "official_text_extraction",
            "official_text_extraction_boundary",
            "official_text_extraction_repository",
        }
    ),
    "ocr_fallback": frozenset(
        {"ocr_fallback", "ocr_fallback_boundary", "ocr_fallback_repository"}
    ),
    "ocr_quality": frozenset(
        {"ocr_quality_boundary", "ocr_quality_repository", "ocr_quality_validator"}
    ),
    "vbpl_effects": frozenset(
        {
            "vbpl_effect_applier",
            "vbpl_effect_detector",
            "vbpl_effected_chunk_set_boundary",
            "vbpl_effected_chunk_set_exporter",
        }
    ),
}
_PREFIX = f"{__name__}."


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _canonical_source_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts or parts[0] == "scripts":
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


class _SourceCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_source_name(fullname)
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


if not any(isinstance(finder, _SourceCapabilityAliasFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _SourceCapabilityAliasFinder())
