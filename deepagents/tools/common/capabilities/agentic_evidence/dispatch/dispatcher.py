"""Single explicit runtime binding index for every canonical LCSP tool."""
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Mapping
from ..governance.catalog import AGENTIC_TOOL_SPECS
from ..governance.registry import AgenticToolRequest, AgenticToolValidationError
from ..entrypoints.program_graph_tool_entrypoints import (
    find_provider_invocations, find_similar_symbols, get_evidence_subgraph, get_finding_detail,
    get_scan_coverage, get_symbol_context, inspect_data_path, inspect_decision_path,
    inspect_deployment_context, inspect_human_review_path, propose_missing_targets,
    search_evidence, trace_static_flow,
)
from ..entrypoints.remediation_tool_entrypoints import propose_gap_remediation
from ..entrypoints.tool_entrypoints import (
    AgenticToolExecutionContext, compare_wizard_claim, evaluate_gap_matrix,
    get_admin_source_catalog, get_artifact_chain, get_assessment_context,
    get_gap_evidence_trace, get_gap_requirements, get_legal_corpus_readiness,
    get_reconciliation_context, request_targeted_reanalysis,
    resume_waiting_runs, retrieve_legal_basis, validate_citation_set,
)
from ..entrypoints.scanner_tool_entrypoints import (
    ScannerToolExecutionContext, build_evidence_graph, classify_workspace_languages,
    materialize_snapshot, run_deptry_usage_analysis, run_knip_usage_analysis,
    run_python_semantic_analysis, run_semgrep_rules, run_structural_augmentation,
    run_syft_inventory, run_ts_js_semantic_analysis, validate_evidence_report,
)
from ..entrypoints.legal_tool_entrypoints import (
    LegalToolExecutionContext, activate_validated_corpus_version,
    build_legal_chunks, build_legal_retrieval_index, build_reviewed_corpus_input,
    build_vbpl_effected_chunk_set, evaluate_ocr_quality, extract_official_text,
    fetch_official_source_snapshot, run_ocr_fallback, validate_chunk_integrity,
    validate_retrieval_index,
)

class ToolRuntimeTarget(str, Enum):
    NEST_CQRS = "NEST_CQRS"; NEST_COMMAND = "NEST_COMMAND"; MANAGED_AGENT_COMMAND = "MANAGED_AGENT_COMMAND"; PYTHON_LOCAL = "PYTHON_LOCAL"; PROTECTED_API = "PROTECTED_API"
AgenticToolRuntimeTarget = ToolRuntimeTarget

@dataclass(frozen=True)
class ToolBinding:
    tool_name: str; runtime_target: ToolRuntimeTarget; entrypoint: Callable[..., object]; downstream_target: str
    def __post_init__(self) -> None:
        if self.entrypoint.__name__ != self.tool_name: raise ValueError(f"tool entrypoint name must exactly match canonical tool name: {self.tool_name} != {self.entrypoint.__name__}")
AgenticToolBinding = ToolBinding

def _binding(name, target, entrypoint, downstream): return ToolBinding(name, target, entrypoint, downstream)

PROGRAM_GRAPH_TOOL_BINDINGS = (
    _binding("propose_missing_targets", ToolRuntimeTarget.PYTHON_LOCAL, propose_missing_targets, "ProgramGraphQueryEngine.propose_missing_targets"),
    _binding("inspect_deployment_context", ToolRuntimeTarget.PYTHON_LOCAL, inspect_deployment_context, "ProgramGraphQueryEngine.inspect_deployment_context"),
    _binding("inspect_decision_path", ToolRuntimeTarget.PYTHON_LOCAL, inspect_decision_path, "ProgramGraphQueryEngine.inspect_decision_path"),
    _binding("find_similar_symbols", ToolRuntimeTarget.PYTHON_LOCAL, find_similar_symbols, "ProgramGraphQueryEngine.find_similar_symbols"),
    _binding("inspect_human_review_path", ToolRuntimeTarget.PYTHON_LOCAL, inspect_human_review_path, "ProgramGraphQueryEngine.inspect_human_review_path"),
    _binding("inspect_data_path", ToolRuntimeTarget.PYTHON_LOCAL, inspect_data_path, "ProgramGraphQueryEngine.inspect_data_path"),
    _binding("find_provider_invocations", ToolRuntimeTarget.PYTHON_LOCAL, find_provider_invocations, "ProgramGraphQueryEngine.provider_invocations"),
    _binding("get_finding_detail", ToolRuntimeTarget.PYTHON_LOCAL, get_finding_detail, "ProgramGraphQueryEngine.get_finding_detail"),
    _binding("get_symbol_context", ToolRuntimeTarget.PYTHON_LOCAL, get_symbol_context, "ProgramGraphQueryEngine.symbol_context"),
    _binding("get_scan_coverage", ToolRuntimeTarget.PYTHON_LOCAL, get_scan_coverage, "ProgramEvidenceGraph.coverage"),
    _binding("search_evidence", ToolRuntimeTarget.PYTHON_LOCAL, search_evidence, "ProgramGraphQueryEngine.search_nodes"),
    _binding("get_evidence_subgraph", ToolRuntimeTarget.PYTHON_LOCAL, get_evidence_subgraph, "ProgramGraphQueryEngine.subgraph"),
    _binding("trace_static_flow", ToolRuntimeTarget.PYTHON_LOCAL, trace_static_flow, "ProgramGraphQueryEngine.trace_static_flow"),
)

ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS = (
    _binding("resume_waiting_runs", ToolRuntimeTarget.MANAGED_AGENT_COMMAND, resume_waiting_runs, "ResumeWaitingRunsCommand"),
    _binding("request_targeted_reanalysis", ToolRuntimeTarget.MANAGED_AGENT_COMMAND, request_targeted_reanalysis, "RequestTargetedReanalysisCommand"),
    _binding("propose_gap_remediation", ToolRuntimeTarget.PYTHON_LOCAL, propose_gap_remediation, "Python remediation over GetGapEvidenceTraceQuery"),
    _binding("get_gap_evidence_trace", ToolRuntimeTarget.NEST_CQRS, get_gap_evidence_trace, "GetGapEvidenceTraceQuery"),
    _binding("get_reconciliation_context", ToolRuntimeTarget.NEST_CQRS, get_reconciliation_context, "GetReconciliationContextQuery"),
    *PROGRAM_GRAPH_TOOL_BINDINGS[:3],
    _binding("get_artifact_chain", ToolRuntimeTarget.NEST_CQRS, get_artifact_chain, "GetArtifactChainQuery"),
    *PROGRAM_GRAPH_TOOL_BINDINGS[3:],
)

NEST_CQRS_DISCOVERY_BINDINGS = (
    _binding("get_assessment_context", ToolRuntimeTarget.NEST_CQRS, get_assessment_context, "GetAssessmentContextQuery"),
    _binding("compare_wizard_claim", ToolRuntimeTarget.NEST_CQRS, compare_wizard_claim, "CompareWizardClaimQuery"),
    _binding("get_gap_requirements", ToolRuntimeTarget.NEST_CQRS, get_gap_requirements, "GetGapRequirementsQuery"),
    _binding("evaluate_gap_matrix", ToolRuntimeTarget.NEST_CQRS, evaluate_gap_matrix, "EvaluateGapMatrixQuery"),
    _binding("get_admin_source_catalog", ToolRuntimeTarget.NEST_CQRS, get_admin_source_catalog, "GetAdminSourceCatalogQuery"),
    _binding("get_legal_corpus_readiness", ToolRuntimeTarget.NEST_CQRS, get_legal_corpus_readiness, "GetLegalCorpusReadinessQuery"),
    _binding("retrieve_legal_basis", ToolRuntimeTarget.NEST_CQRS, retrieve_legal_basis, "RetrieveLegalBasisQuery"),
    _binding("validate_citation_set", ToolRuntimeTarget.NEST_CQRS, validate_citation_set, "ValidateCitationSetQuery"),
)
PROTECTED_COMMAND_BINDINGS = ()
SCANNER_TOOL_BINDINGS = (
    _binding("materialize_snapshot", ToolRuntimeTarget.PYTHON_LOCAL, materialize_snapshot, "ScannerWorkspace.materialize"),
    _binding("classify_workspace_languages", ToolRuntimeTarget.PYTHON_LOCAL, classify_workspace_languages, "LanguageClassifier.classify_workspace"),
    _binding("run_syft_inventory", ToolRuntimeTarget.PYTHON_LOCAL, run_syft_inventory, "SyftTool.run"),
    _binding("run_semgrep_rules", ToolRuntimeTarget.PYTHON_LOCAL, run_semgrep_rules, "SemgrepTool.run"),
    _binding("run_knip_usage_analysis", ToolRuntimeTarget.PYTHON_LOCAL, run_knip_usage_analysis, "KnipTool.run"),
    _binding("run_deptry_usage_analysis", ToolRuntimeTarget.PYTHON_LOCAL, run_deptry_usage_analysis, "DeptryTool.run"),
    _binding("run_ts_js_semantic_analysis", ToolRuntimeTarget.PYTHON_LOCAL, run_ts_js_semantic_analysis, "TsJsBridge.analyze"),
    _binding("run_python_semantic_analysis", ToolRuntimeTarget.PYTHON_LOCAL, run_python_semantic_analysis, "PythonAnalyzer.analyze"),
    _binding("run_structural_augmentation", ToolRuntimeTarget.PYTHON_LOCAL, run_structural_augmentation, "StructuralAugmentor.augment"),
    _binding("build_evidence_graph", ToolRuntimeTarget.PYTHON_LOCAL, build_evidence_graph, "ProgramGraphAssembler.assemble"),
    _binding("validate_evidence_report", ToolRuntimeTarget.PYTHON_LOCAL, validate_evidence_report, "validate_schema + assert_privacy_flags + classify_quality"),
)
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
ALL_TOOL_BINDINGS = (*ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS, *NEST_CQRS_DISCOVERY_BINDINGS, *PROTECTED_COMMAND_BINDINGS, *SCANNER_TOOL_BINDINGS, *LEGAL_CORPUS_TOOL_BINDINGS)
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

class ScannerToolDispatcher:
    def __init__(self, context: ScannerToolExecutionContext) -> None: self._context = context; self._bindings = {b.tool_name: b for b in SCANNER_TOOL_BINDINGS}
    def names(self): return tuple(sorted(self._bindings))
    def binding(self, name):
        value = self._bindings.get(name)
        if not value: raise AgenticToolValidationError("SCANNER_TOOL_RUNTIME_BINDING_NOT_FOUND")
        return value
    def dispatch(self, tool_name: str, **tool_input): return self.binding(tool_name).entrypoint(tool_input, self._context)

class LegalToolDispatcher:
    def __init__(self, context: LegalToolExecutionContext) -> None:
        self._context = context; self._bindings = {b.tool_name: b for b in LEGAL_CORPUS_TOOL_BINDINGS}
    def names(self): return tuple(sorted(self._bindings))
    def binding(self, name):
        value = self._bindings.get(name)
        if not value: raise AgenticToolValidationError("LEGAL_TOOL_RUNTIME_BINDING_NOT_FOUND")
        return value
    def dispatch(self, tool_name: str, **tool_input): return self.binding(tool_name).entrypoint(tool_input, self._context)
