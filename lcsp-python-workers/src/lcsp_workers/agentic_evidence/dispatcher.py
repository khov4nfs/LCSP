"""Single runtime binding index and dispatchers for LCSP tools."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable, Mapping

from .catalog import AGENTIC_TOOL_SPECS
from .legal_tool_entrypoints import (
    LegalToolExecutionContext,
    activate_validated_corpus_version,
    build_legal_chunks,
    build_legal_retrieval_index,
    build_reviewed_corpus_input,
    evaluate_ocr_quality,
    extract_official_text,
    fetch_official_source_snapshot,
    run_ocr_fallback,
    validate_chunk_integrity,
    validate_retrieval_index,
)
from .registry import AgenticToolRequest, AgenticToolValidationError
from .scanner_tool_entrypoints import (
    ScannerToolExecutionContext,
    build_evidence_graph,
    classify_workspace_languages,
    materialize_snapshot,
    run_deptry_usage_analysis,
    run_knip_usage_analysis,
    run_python_semantic_analysis,
    run_semgrep_rules,
    run_structural_augmentation,
    run_syft_inventory,
    run_ts_js_semantic_analysis,
    validate_evidence_report,
)
from .tool_entrypoints import (
    AgenticToolExecutionContext,
    compare_wizard_claim,
    evaluate_gap_matrix,
    find_provider_invocations,
    find_similar_symbols,
    get_admin_source_catalog,
    get_artifact_chain,
    get_assessment_context,
    get_classification_baseline,
    get_evidence_subgraph,
    get_finding_detail,
    get_gap_evidence_trace,
    get_gap_requirements,
    get_legal_corpus_readiness,
    get_legal_rule_match,
    get_reconciliation_context,
    get_scan_coverage,
    get_symbol_context,
    get_verified_profile,
    inspect_data_path,
    inspect_decision_path,
    inspect_deployment_context,
    inspect_human_review_path,
    propose_gap_remediation,
    propose_missing_targets,
    reconcile_profile_to_verified_profile,
    request_targeted_reanalysis,
    resolve_independent_classification_review,
    resume_waiting_runs,
    retrieve_legal_basis,
    search_evidence,
    submit_classification_for_independent_review,
    trace_static_flow,
    validate_citation_set,
    validate_classification_proposal,
)


class ToolRuntimeTarget(str, Enum):
    """Execution mechanism reached after canonical tool-name resolution."""

    NEST_CQRS = "NEST_CQRS"
    NEST_COMMAND = "NEST_COMMAND"
    PYTHON_WORKER_BRIDGE = "PYTHON_WORKER_BRIDGE"
    PYTHON_LOCAL = "PYTHON_LOCAL"
    PROTECTED_API = "PROTECTED_API"


AgenticToolRuntimeTarget = ToolRuntimeTarget


@dataclass(frozen=True)
class ToolBinding:
    """Discoverable mapping from canonical tool name to its execution boundary."""

    tool_name: str
    runtime_target: ToolRuntimeTarget
    entrypoint: Callable[..., object]
    downstream_target: str

    def __post_init__(self) -> None:
        if self.entrypoint.__name__ != self.tool_name:
            raise ValueError(
                "tool entrypoint name must exactly match canonical tool name: "
                f"{self.tool_name} != {self.entrypoint.__name__}"
            )


AgenticToolBinding = ToolBinding


def _binding(
    tool_name: str,
    runtime_target: ToolRuntimeTarget,
    entrypoint: Callable[..., object],
    downstream_target: str,
) -> ToolBinding:
    return ToolBinding(tool_name, runtime_target, entrypoint, downstream_target)


SPRINT6_AGENTIC_TOOL_BINDINGS: tuple[ToolBinding, ...] = (
    _binding(
        "resume_waiting_runs",
        ToolRuntimeTarget.PYTHON_WORKER_BRIDGE,
        resume_waiting_runs,
        "PythonWorkerRuntimeClient.resumeWaitingRuns",
    ),
    _binding(
        "request_targeted_reanalysis",
        ToolRuntimeTarget.PYTHON_WORKER_BRIDGE,
        request_targeted_reanalysis,
        "PythonWorkerRuntimeClient.requestTargetedReanalysis",
    ),
    _binding(
        "propose_gap_remediation",
        ToolRuntimeTarget.NEST_CQRS,
        propose_gap_remediation,
        "ProposeGapRemediationQuery",
    ),
    _binding(
        "get_gap_evidence_trace",
        ToolRuntimeTarget.NEST_CQRS,
        get_gap_evidence_trace,
        "GetGapEvidenceTraceQuery",
    ),
    _binding(
        "get_reconciliation_context",
        ToolRuntimeTarget.NEST_CQRS,
        get_reconciliation_context,
        "GetReconciliationContextQuery",
    ),
    _binding(
        "propose_missing_targets",
        ToolRuntimeTarget.NEST_CQRS,
        propose_missing_targets,
        "ProposeMissingTargetsQuery",
    ),
    _binding(
        "inspect_deployment_context",
        ToolRuntimeTarget.NEST_CQRS,
        inspect_deployment_context,
        "InspectDeploymentContextQuery",
    ),
    _binding(
        "inspect_decision_path",
        ToolRuntimeTarget.NEST_CQRS,
        inspect_decision_path,
        "InspectDecisionPathQuery",
    ),
    _binding(
        "get_artifact_chain",
        ToolRuntimeTarget.NEST_CQRS,
        get_artifact_chain,
        "GetArtifactChainQuery",
    ),
    _binding(
        "find_similar_symbols",
        ToolRuntimeTarget.NEST_CQRS,
        find_similar_symbols,
        "FindSimilarSymbolsQuery",
    ),
    _binding(
        "inspect_human_review_path",
        ToolRuntimeTarget.NEST_CQRS,
        inspect_human_review_path,
        "InspectHumanReviewPathQuery",
    ),
    _binding(
        "inspect_data_path",
        ToolRuntimeTarget.NEST_CQRS,
        inspect_data_path,
        "InspectDataPathQuery",
    ),
    _binding(
        "find_provider_invocations",
        ToolRuntimeTarget.NEST_CQRS,
        find_provider_invocations,
        "FindProviderInvocationsQuery",
    ),
    _binding(
        "get_finding_detail",
        ToolRuntimeTarget.NEST_CQRS,
        get_finding_detail,
        "GetFindingDetailQuery",
    ),
    _binding(
        "get_symbol_context",
        ToolRuntimeTarget.NEST_CQRS,
        get_symbol_context,
        "GetSymbolContextQuery",
    ),
    _binding(
        "get_scan_coverage",
        ToolRuntimeTarget.NEST_CQRS,
        get_scan_coverage,
        "GetScanCoverageQuery",
    ),
    _binding(
        "search_evidence",
        ToolRuntimeTarget.NEST_CQRS,
        search_evidence,
        "SearchEvidenceQuery",
    ),
    _binding(
        "get_evidence_subgraph",
        ToolRuntimeTarget.NEST_CQRS,
        get_evidence_subgraph,
        "GetEvidenceSubgraphQuery",
    ),
    _binding(
        "trace_static_flow",
        ToolRuntimeTarget.NEST_CQRS,
        trace_static_flow,
        "TraceStaticFlowQuery",
    ),
)


NEST_CQRS_DISCOVERY_BINDINGS: tuple[ToolBinding, ...] = (
    _binding(
        "get_assessment_context",
        ToolRuntimeTarget.NEST_CQRS,
        get_assessment_context,
        "GetAssessmentContextQuery",
    ),
    _binding(
        "get_verified_profile",
        ToolRuntimeTarget.NEST_CQRS,
        get_verified_profile,
        "GetVerifiedProfileQuery",
    ),
    _binding(
        "compare_wizard_claim",
        ToolRuntimeTarget.NEST_CQRS,
        compare_wizard_claim,
        "CompareWizardClaimQuery",
    ),
    _binding(
        "get_classification_baseline",
        ToolRuntimeTarget.NEST_CQRS,
        get_classification_baseline,
        "GetClassificationBaselineQuery",
    ),
    _binding(
        "get_gap_requirements",
        ToolRuntimeTarget.NEST_CQRS,
        get_gap_requirements,
        "GetGapRequirementsQuery",
    ),
    _binding(
        "validate_classification_proposal",
        ToolRuntimeTarget.NEST_CQRS,
        validate_classification_proposal,
        "ValidateClassificationProposalQuery",
    ),
    _binding(
        "evaluate_gap_matrix",
        ToolRuntimeTarget.NEST_CQRS,
        evaluate_gap_matrix,
        "EvaluateGapMatrixQuery",
    ),
    _binding(
        "get_admin_source_catalog",
        ToolRuntimeTarget.NEST_CQRS,
        get_admin_source_catalog,
        "GetAdminSourceCatalogQuery",
    ),
    _binding(
        "get_legal_corpus_readiness",
        ToolRuntimeTarget.NEST_CQRS,
        get_legal_corpus_readiness,
        "GetLegalCorpusReadinessQuery",
    ),
    _binding(
        "retrieve_legal_basis",
        ToolRuntimeTarget.NEST_CQRS,
        retrieve_legal_basis,
        "RetrieveLegalBasisQuery",
    ),
    _binding(
        "get_legal_rule_match",
        ToolRuntimeTarget.NEST_CQRS,
        get_legal_rule_match,
        "GetLegalRuleMatchQuery",
    ),
    _binding(
        "validate_citation_set",
        ToolRuntimeTarget.NEST_CQRS,
        validate_citation_set,
        "ValidateCitationSetQuery",
    ),
)


PROTECTED_COMMAND_BINDINGS: tuple[ToolBinding, ...] = (
    _binding(
        "reconcile_profile_to_verified_profile",
        ToolRuntimeTarget.NEST_COMMAND,
        reconcile_profile_to_verified_profile,
        "ReconcileProfileToVerifiedProfileCommand",
    ),
    _binding(
        "submit_classification_for_independent_review",
        ToolRuntimeTarget.NEST_COMMAND,
        submit_classification_for_independent_review,
        "SubmitClassificationReviewCommand",
    ),
    _binding(
        "resolve_independent_classification_review",
        ToolRuntimeTarget.NEST_COMMAND,
        resolve_independent_classification_review,
        "ResolveClassificationReviewCommand",
    ),
)


AO1_SCANNER_TOOL_BINDINGS: tuple[ToolBinding, ...] = (
    _binding(
        "materialize_snapshot",
        ToolRuntimeTarget.PYTHON_LOCAL,
        materialize_snapshot,
        "ScannerWorkspace.materialize",
    ),
    _binding(
        "classify_workspace_languages",
        ToolRuntimeTarget.PYTHON_LOCAL,
        classify_workspace_languages,
        "LanguageClassifier.classify_workspace",
    ),
    _binding(
        "run_syft_inventory",
        ToolRuntimeTarget.PYTHON_LOCAL,
        run_syft_inventory,
        "SyftTool.run",
    ),
    _binding(
        "run_semgrep_rules",
        ToolRuntimeTarget.PYTHON_LOCAL,
        run_semgrep_rules,
        "SemgrepTool.run",
    ),
    _binding(
        "run_knip_usage_analysis",
        ToolRuntimeTarget.PYTHON_LOCAL,
        run_knip_usage_analysis,
        "KnipTool.run",
    ),
    _binding(
        "run_deptry_usage_analysis",
        ToolRuntimeTarget.PYTHON_LOCAL,
        run_deptry_usage_analysis,
        "DeptryTool.run",
    ),
    _binding(
        "run_ts_js_semantic_analysis",
        ToolRuntimeTarget.PYTHON_LOCAL,
        run_ts_js_semantic_analysis,
        "TsJsBridge.analyze",
    ),
    _binding(
        "run_python_semantic_analysis",
        ToolRuntimeTarget.PYTHON_LOCAL,
        run_python_semantic_analysis,
        "PythonAnalyzer.analyze",
    ),
    _binding(
        "run_structural_augmentation",
        ToolRuntimeTarget.PYTHON_LOCAL,
        run_structural_augmentation,
        "StructuralAugmentor.augment",
    ),
    _binding(
        "build_evidence_graph",
        ToolRuntimeTarget.PYTHON_LOCAL,
        build_evidence_graph,
        "EvidenceGraphAssembler.assemble",
    ),
    _binding(
        "validate_evidence_report",
        ToolRuntimeTarget.PYTHON_LOCAL,
        validate_evidence_report,
        "validate_schema + assert_privacy_flags + classify_quality",
    ),
)


AO6_LEGAL_TOOL_BINDINGS: tuple[ToolBinding, ...] = (
    _binding(
        "fetch_official_source_snapshot",
        ToolRuntimeTarget.PYTHON_LOCAL,
        fetch_official_source_snapshot,
        "OfficialSourceSnapshotFetcher.fetch",
    ),
    _binding(
        "extract_official_text",
        ToolRuntimeTarget.PYTHON_LOCAL,
        extract_official_text,
        "OfficialTextExtractor.extract",
    ),
    _binding(
        "run_ocr_fallback",
        ToolRuntimeTarget.PYTHON_LOCAL,
        run_ocr_fallback,
        "OcrFallbackTool.run",
    ),
    _binding(
        "evaluate_ocr_quality",
        ToolRuntimeTarget.PYTHON_LOCAL,
        evaluate_ocr_quality,
        "OcrQualityValidator.evaluate",
    ),
    _binding(
        "build_reviewed_corpus_input",
        ToolRuntimeTarget.PYTHON_LOCAL,
        build_reviewed_corpus_input,
        "ReviewedCorpusInputBuilder.build",
    ),
    _binding(
        "build_legal_chunks",
        ToolRuntimeTarget.PYTHON_LOCAL,
        build_legal_chunks,
        "LegalChunkBuilder.build",
    ),
    _binding(
        "validate_chunk_integrity",
        ToolRuntimeTarget.PYTHON_LOCAL,
        validate_chunk_integrity,
        "ChunkIntegrityValidator.validate",
    ),
    _binding(
        "build_legal_retrieval_index",
        ToolRuntimeTarget.PYTHON_LOCAL,
        build_legal_retrieval_index,
        "LegalRetrievalIndexBuilder.build",
    ),
    _binding(
        "validate_retrieval_index",
        ToolRuntimeTarget.PYTHON_LOCAL,
        validate_retrieval_index,
        "ChromaDbCitationRetriever.index_corpus + retrieve_exact",
    ),
    _binding(
        "activate_validated_corpus_version",
        ToolRuntimeTarget.PROTECTED_API,
        activate_validated_corpus_version,
        "WorkerApiClient.activate_validated_corpus_version",
    ),
)


ALL_TOOL_BINDINGS: tuple[ToolBinding, ...] = (
    *SPRINT6_AGENTIC_TOOL_BINDINGS,
    *NEST_CQRS_DISCOVERY_BINDINGS,
    *PROTECTED_COMMAND_BINDINGS,
    *AO1_SCANNER_TOOL_BINDINGS,
    *AO6_LEGAL_TOOL_BINDINGS,
)

_TOOL_BINDING_INDEX = {binding.tool_name: binding for binding in ALL_TOOL_BINDINGS}
if len(_TOOL_BINDING_INDEX) != len(ALL_TOOL_BINDINGS):
    raise RuntimeError("canonical tool runtime bindings must be globally unique")


def runtime_binding(tool_name: str) -> ToolBinding:
    """Resolve one canonical tool name to its runtime target and implementation seam."""
    binding = _TOOL_BINDING_INDEX.get(tool_name)
    if binding is None:
        raise AgenticToolValidationError("TOOL_RUNTIME_BINDING_NOT_FOUND")
    return binding


def tool_runtime_manifest() -> tuple[dict[str, str], ...]:
    """Return a deterministic debug view of every centrally registered tool binding."""
    return tuple(
        {
            "tool_name": binding.tool_name,
            "runtime_target": binding.runtime_target.value,
            "entrypoint": binding.entrypoint.__name__,
            "downstream_target": binding.downstream_target,
        }
        for binding in sorted(ALL_TOOL_BINDINGS, key=lambda item: item.tool_name)
    )


class AgenticToolDispatcher:
    """Dispatch validated AgenticToolRequest objects through explicit bindings."""

    def __init__(self, context: AgenticToolExecutionContext) -> None:
        self._context = context
        self._bindings = {
            binding.tool_name: binding for binding in SPRINT6_AGENTIC_TOOL_BINDINGS
        }
        self._assert_catalog_coverage()

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._bindings))

    def binding(self, tool_name: str) -> ToolBinding:
        binding = self._bindings.get(tool_name)
        if binding is None:
            raise AgenticToolValidationError("AGENTIC_TOOL_RUNTIME_BINDING_NOT_FOUND")
        return binding

    def dispatch(self, request: AgenticToolRequest) -> Mapping[str, object]:
        binding = self.binding(request.tool_name)
        return binding.entrypoint(request, self._context)  # type: ignore[return-value]

    def bound_handler(self, tool_name: str):
        binding = self.binding(tool_name)

        def execute(request: AgenticToolRequest) -> Mapping[str, object]:
            return binding.entrypoint(request, self._context)  # type: ignore[return-value]

        execute.__name__ = tool_name
        execute.__qualname__ = tool_name
        return execute

    def _assert_catalog_coverage(self) -> None:
        catalog_names = {spec.name for spec in AGENTIC_TOOL_SPECS}
        binding_names = set(self._bindings)
        if binding_names != catalog_names:
            missing = sorted(catalog_names - binding_names)
            extra = sorted(binding_names - catalog_names)
            raise ValueError(
                "agentic tool runtime bindings must exactly cover the canonical catalog; "
                f"missing={missing}, extra={extra}"
            )


class ScannerToolDispatcher:
    """Dispatch AO-1 system tools through exact-name local Python entrypoints."""

    def __init__(self, context: ScannerToolExecutionContext) -> None:
        self._context = context
        self._bindings = {
            binding.tool_name: binding for binding in AO1_SCANNER_TOOL_BINDINGS
        }

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._bindings))

    def binding(self, tool_name: str) -> ToolBinding:
        binding = self._bindings.get(tool_name)
        if binding is None:
            raise AgenticToolValidationError("SCANNER_TOOL_RUNTIME_BINDING_NOT_FOUND")
        return binding

    def dispatch(self, tool_name: str, **tool_input: object):
        binding = self.binding(tool_name)
        return binding.entrypoint(tool_input, self._context)


class LegalToolDispatcher:
    """Dispatch AO-6 legal tools without widening model or mutation authority."""

    def __init__(self, context: LegalToolExecutionContext) -> None:
        self._context = context
        self._bindings = {
            binding.tool_name: binding for binding in AO6_LEGAL_TOOL_BINDINGS
        }

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._bindings))

    def binding(self, tool_name: str) -> ToolBinding:
        binding = self._bindings.get(tool_name)
        if binding is None:
            raise AgenticToolValidationError("LEGAL_TOOL_RUNTIME_BINDING_NOT_FOUND")
        return binding

    def dispatch(self, tool_name: str, **tool_input: object):
        binding = self.binding(tool_name)
        return binding.entrypoint(tool_input, self._context)
