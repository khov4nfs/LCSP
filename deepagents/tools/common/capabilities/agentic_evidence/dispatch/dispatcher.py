"""Single explicit runtime binding index for every canonical LCSP tool."""
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Mapping
from ..governance.catalog import AGENTIC_TOOL_SPECS
from ..governance.registry import AgenticToolRequest, AgenticToolValidationError
from ..entrypoints.remediation_tool_entrypoints import propose_gap_remediation
from ..entrypoints.tool_entrypoints import (
    AgenticToolExecutionContext, evaluate_gap_matrix,
    get_admin_source_catalog, get_artifact_chain,
    get_gap_evidence_trace, get_gap_requirements, get_legal_corpus_readiness,
    get_reconciliation_context,
    resume_waiting_runs, retrieve_legal_basis, validate_citation_set,
)
from ..entrypoints.legal_tool_entrypoints import (
    LegalToolExecutionContext, activate_validated_corpus_version,
    build_legal_chunks, build_legal_retrieval_index, build_reviewed_corpus_input,
    build_vbpl_effected_chunk_set, evaluate_ocr_quality, extract_official_text,
    fetch_official_source_snapshot, run_ocr_fallback, validate_chunk_integrity,
    validate_retrieval_index,
)

class ToolRuntimeTarget(str, Enum):
    NEST_CQRS = "NEST_CQRS"; NEST_COMMAND = "NEST_COMMAND"; AGENT_RUNTIME_COMMAND = "AGENT_RUNTIME_COMMAND"; PYTHON_LOCAL = "PYTHON_LOCAL"; PROTECTED_API = "PROTECTED_API"
AgenticToolRuntimeTarget = ToolRuntimeTarget

@dataclass(frozen=True)
class ToolBinding:
    tool_name: str; runtime_target: ToolRuntimeTarget; entrypoint: Callable[..., object]; downstream_target: str
    def __post_init__(self) -> None:
        if self.entrypoint.__name__ != self.tool_name: raise ValueError(f"tool entrypoint name must exactly match canonical tool name: {self.tool_name} != {self.entrypoint.__name__}")
AgenticToolBinding = ToolBinding

def _binding(name, target, entrypoint, downstream): return ToolBinding(name, target, entrypoint, downstream)

ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS = (
    _binding("resume_waiting_runs", ToolRuntimeTarget.AGENT_RUNTIME_COMMAND, resume_waiting_runs, "ResumeWaitingRunsCommand"),
    _binding("propose_gap_remediation", ToolRuntimeTarget.PYTHON_LOCAL, propose_gap_remediation, "Python remediation over GetGapEvidenceTraceQuery"),
    _binding("get_gap_evidence_trace", ToolRuntimeTarget.NEST_CQRS, get_gap_evidence_trace, "GetGapEvidenceTraceQuery"),
    _binding("get_reconciliation_context", ToolRuntimeTarget.NEST_CQRS, get_reconciliation_context, "GetReconciliationContextQuery"),
    _binding("get_artifact_chain", ToolRuntimeTarget.NEST_CQRS, get_artifact_chain, "GetArtifactChainQuery"),
)


NEST_CQRS_DISCOVERY_BINDINGS = (
    _binding("get_gap_requirements", ToolRuntimeTarget.NEST_CQRS, get_gap_requirements, "GetGapRequirementsQuery"),
    _binding("evaluate_gap_matrix", ToolRuntimeTarget.NEST_CQRS, evaluate_gap_matrix, "EvaluateGapMatrixQuery"),
    _binding("get_admin_source_catalog", ToolRuntimeTarget.NEST_CQRS, get_admin_source_catalog, "GetAdminSourceCatalogQuery"),
    _binding("get_legal_corpus_readiness", ToolRuntimeTarget.NEST_CQRS, get_legal_corpus_readiness, "GetLegalCorpusReadinessQuery"),
    _binding("retrieve_legal_basis", ToolRuntimeTarget.NEST_CQRS, retrieve_legal_basis, "RetrieveLegalBasisQuery"),
    _binding("validate_citation_set", ToolRuntimeTarget.NEST_CQRS, validate_citation_set, "ValidateCitationSetQuery"),
)
PROTECTED_COMMAND_BINDINGS = ()
LEGAL_CORPUS_TOOL_BINDINGS = (
    _binding("fetch_official_source_snapshot", ToolRuntimeTarget.PYTHON_LOCAL, fetch_official_source_snapshot, "OfficialSourceSnapshotFetcher.fetch"),
    _binding("extract_official_text", ToolRuntimeTarget.PYTHON_LOCAL, extract_official_text, "OfficialTextExtractor.extract"),
    _binding("run_ocr_fallback", ToolRuntimeTarget.PYTHON_LOCAL, run_ocr_fallback, "OcrFallbackTool.run"),
    _binding("evaluate_ocr_quality", ToolRuntimeTarget.PYTHON_LOCAL, evaluate_ocr_quality, "OcrQualityValidator.evaluate"),
    _binding("build_reviewed_corpus_input", ToolRuntimeTarget.PYTHON_LOCAL, build_reviewed_corpus_input, "ReviewedCorpusInputBuilder.build"),
    _binding("build_legal_chunks", ToolRuntimeTarget.PYTHON_LOCAL, build_legal_chunks, "LegalChunkBuilder.build"),
    _binding("build_vbpl_effected_chunk_set", ToolRuntimeTarget.PYTHON_LOCAL, build_vbpl_effected_chunk_set, "VBPL effect detector + applier + chunk-set exporter"),
    _binding("validate_chunk_integrity", ToolRuntimeTarget.PYTHON_LOCAL, validate_chunk_integrity, "ChunkIntegrityValidator.validate"),
    _binding("build_legal_retrieval_index", ToolRuntimeTarget.PYTHON_LOCAL, build_legal_retrieval_index, "LegalRetrievalIndexBuilder.build"),
    _binding("validate_retrieval_index", ToolRuntimeTarget.PYTHON_LOCAL, validate_retrieval_index, "ChromaDbCitationRetriever.index_corpus + retrieve_exact"),
    _binding("activate_validated_corpus_version", ToolRuntimeTarget.PROTECTED_API, activate_validated_corpus_version, "WorkerApiClient.activate_validated_corpus_version"),
)
ALL_TOOL_BINDINGS = (*ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS, *NEST_CQRS_DISCOVERY_BINDINGS, *PROTECTED_COMMAND_BINDINGS, *LEGAL_CORPUS_TOOL_BINDINGS)
_TOOL_BINDING_INDEX = {b.tool_name: b for b in ALL_TOOL_BINDINGS}
if len(_TOOL_BINDING_INDEX) != len(ALL_TOOL_BINDINGS): raise RuntimeError("canonical tool runtime bindings must be globally unique")

def runtime_binding(tool_name: str) -> ToolBinding:
    binding = _TOOL_BINDING_INDEX.get(tool_name)
    if binding is None: raise AgenticToolValidationError("TOOL_RUNTIME_BINDING_NOT_FOUND")
    return binding

def tool_runtime_manifest() -> tuple[dict[str, str], ...]: return tuple({"tool_name": b.tool_name, "runtime_target": b.runtime_target.value, "entrypoint": b.entrypoint.__name__, "downstream_target": b.downstream_target} for b in sorted(ALL_TOOL_BINDINGS, key=lambda x: x.tool_name))

class AgenticToolDispatcher:
    def __init__(self, context: AgenticToolExecutionContext) -> None:
        self._context = context; self._bindings = {b.tool_name: b for b in ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS}; self._assert_catalog_coverage()
    def names(self): return tuple(sorted(self._bindings))
    def binding(self, name):
        value = self._bindings.get(name)
        if not value: raise AgenticToolValidationError("AGENTIC_TOOL_RUNTIME_BINDING_NOT_FOUND")
        return value
    def dispatch(self, request: AgenticToolRequest) -> Mapping[str, object]: return self.binding(request.tool_name).entrypoint(request, self._context)  # type: ignore[return-value]
    def bound_handler(self, tool_name: str):
        binding = self.binding(tool_name)
        def execute(request: AgenticToolRequest): return binding.entrypoint(request, self._context)
        execute.__name__ = tool_name; execute.__qualname__ = tool_name; return execute
    def _assert_catalog_coverage(self):
        catalog, bindings = {s.name for s in AGENTIC_TOOL_SPECS}, set(self._bindings)
        if catalog != bindings: raise ValueError(f"agentic tool runtime bindings must exactly cover catalog; missing={sorted(catalog-bindings)}, extra={sorted(bindings-catalog)}")

class LegalToolDispatcher:
    def __init__(self, context: LegalToolExecutionContext) -> None:
        self._context = context; self._bindings = {b.tool_name: b for b in LEGAL_CORPUS_TOOL_BINDINGS}
    def names(self): return tuple(sorted(self._bindings))
    def binding(self, name):
        value = self._bindings.get(name)
        if not value: raise AgenticToolValidationError("LEGAL_TOOL_RUNTIME_BINDING_NOT_FOUND")
        return value
    def dispatch(self, tool_name: str, **tool_input): return self.binding(tool_name).entrypoint(tool_input, self._context)
