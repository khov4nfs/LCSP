"""Mechanical legal-source acquisition bindings; no assessment semantic dispatcher."""
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Callable
from ..entrypoints.legal_tool_entrypoints import (
    LegalToolExecutionContext, activate_validated_legal_source_version,
    build_legal_chunks, build_legal_retrieval_index, build_reviewed_legal_source_input,
    build_vbpl_effected_chunk_set, evaluate_ocr_quality, extract_official_text,
    fetch_official_source_snapshot, run_ocr_fallback, validate_chunk_integrity,
    validate_retrieval_index,
)
class ToolRuntimeTarget(str, Enum):
    PYTHON_LOCAL = "PYTHON_LOCAL"
    PROTECTED_API = "PROTECTED_API"

@dataclass(frozen=True)
class ToolBinding:
    tool_name: str
    runtime_target: ToolRuntimeTarget
    entrypoint: Callable[..., object]
    downstream_target: str

    def __post_init__(self) -> None:
        if self.entrypoint.__name__ != self.tool_name:
            raise ValueError(f"tool entrypoint name must exactly match canonical tool name: {self.tool_name} != {self.entrypoint.__name__}")

def _binding(name, target, entrypoint, downstream):
    return ToolBinding(name, target, entrypoint, downstream)

LEGAL_SOURCE_TOOL_BINDINGS = (
    _binding("fetch_official_source_snapshot", ToolRuntimeTarget.PYTHON_LOCAL, fetch_official_source_snapshot, "OfficialSourceSnapshotFetcher.fetch"),
    _binding("extract_official_text", ToolRuntimeTarget.PYTHON_LOCAL, extract_official_text, "OfficialTextExtractor.extract"),
    _binding("run_ocr_fallback", ToolRuntimeTarget.PYTHON_LOCAL, run_ocr_fallback, "OcrFallbackTool.run"),
    _binding("evaluate_ocr_quality", ToolRuntimeTarget.PYTHON_LOCAL, evaluate_ocr_quality, "OcrQualityValidator.evaluate"),
    _binding("build_reviewed_legal_source_input", ToolRuntimeTarget.PYTHON_LOCAL, build_reviewed_legal_source_input, "ReviewedLegalSourceInputBuilder.build"),
    _binding("build_legal_chunks", ToolRuntimeTarget.PYTHON_LOCAL, build_legal_chunks, "LegalChunkBuilder.build"),
    _binding("build_vbpl_effected_chunk_set", ToolRuntimeTarget.PYTHON_LOCAL, build_vbpl_effected_chunk_set, "VBPL effect detector + applier + chunk-set exporter"),
    _binding("validate_chunk_integrity", ToolRuntimeTarget.PYTHON_LOCAL, validate_chunk_integrity, "ChunkIntegrityValidator.validate"),
    _binding("build_legal_retrieval_index", ToolRuntimeTarget.PYTHON_LOCAL, build_legal_retrieval_index, "LegalRetrievalIndexBuilder.build"),
    _binding("validate_retrieval_index", ToolRuntimeTarget.PYTHON_LOCAL, validate_retrieval_index, "ChromaDbCitationRetriever.index_legal_source + retrieve_exact"),
    _binding("activate_validated_legal_source_version", ToolRuntimeTarget.PROTECTED_API, activate_validated_legal_source_version, "WorkerApiClient.activate_validated_legal_source_version"),
)
ALL_TOOL_BINDINGS = LEGAL_SOURCE_TOOL_BINDINGS
_TOOL_BINDING_INDEX = {binding.tool_name: binding for binding in ALL_TOOL_BINDINGS}
if len(_TOOL_BINDING_INDEX) != len(ALL_TOOL_BINDINGS):
    raise RuntimeError("canonical tool runtime bindings must be globally unique")

def runtime_binding(tool_name: str) -> ToolBinding:
    binding = _TOOL_BINDING_INDEX.get(tool_name)
    if binding is None:
        raise ValueError("TOOL_RUNTIME_BINDING_NOT_FOUND")
    return binding

def tool_runtime_manifest() -> tuple[dict[str, str], ...]:
    return tuple({"tool_name": binding.tool_name, "runtime_target": binding.runtime_target.value,
        "entrypoint": binding.entrypoint.__name__, "downstream_target": binding.downstream_target}
        for binding in sorted(ALL_TOOL_BINDINGS, key=lambda binding: binding.tool_name))

class LegalToolDispatcher:
    def __init__(self, context: LegalToolExecutionContext) -> None:
        self._context = context; self._bindings = {b.tool_name: b for b in LEGAL_SOURCE_TOOL_BINDINGS}
    def names(self): return tuple(sorted(self._bindings))
    def binding(self, name):
        value = self._bindings.get(name)
        if not value: raise ValueError("LEGAL_TOOL_RUNTIME_BINDING_NOT_FOUND")
        return value
    def dispatch(self, tool_name: str, **tool_input): return self.binding(tool_name).entrypoint(tool_input, self._context)
