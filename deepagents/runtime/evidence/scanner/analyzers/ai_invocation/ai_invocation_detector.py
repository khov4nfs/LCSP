from __future__ import annotations

import uuid
from dataclasses import dataclass

from tools.graph.scanner.analyzers.python_analyzer import PythonAnalysisResult
from tools.graph.scanner.dependencies.dependency_fact import PackageDependency, is_ai_package
from tools.graph.scanner.tools.semgrep_tool import SemgrepRunResult
from tools.graph.scanner.tools.syft_tool import SyftRunResult
from tools.graph.scanner.tools.tool_base import OUTCOME_SUCCESS, ToolExecutionResult
from tools.graph.scanner.ts_js_bridge.bridge_types import TsJsBridgeResult

from .confidence_calculator import calculate_confidence
from .finding_deduplicator import FindingDeduplicator, MergedFindingCandidate
from .finding_types import (
    AI_INPUT_SIGNAL,
    AI_OUTPUT_SIGNAL,
    DISPLAY_ONLY_SIGNAL,
    DOMAIN_CONTEXT_SIGNAL,
    HARM_POTENTIAL_SIGNAL,
    RANKING_SIGNAL,
    RECOMMENDATION_SIGNAL,
    SCAN_COVERAGE_LIMITATION,
    STATUS_UPDATE_SIGNAL,
    UNSUPPORTED_DYNAMIC_FLOW,
    USER_IMPACT_SIGNAL,
)
from .signal_fuser import FindingCandidate, SignalFuser


INPUT_KWARG_NAMES = {
    "messages",
    "prompt",
    "input",
    "user_input",
    "query",
    "context",
    "document",
}
RANKING_PATTERNS = {"rank", "rerank", "rank_results", "sort_by_relevance", "rank_candidates"}
RECOMMENDATION_PATTERNS = {
    "recommend",
    "get_recommendations",
    "suggest",
    "suggest_items",
    "personalize",
}
STATUS_PATTERNS = {"status_update", "update_status", "set_status", "transition_to"}
USER_IMPACT_PATTERNS = {
    "send_email",
    "send_notification",
    "notify_user",
    "update_user",
    "set_eligibility",
    "set_price",
    "update_score",
}
DISPLAY_ONLY_PATTERNS = {
    "return",
    "render",
    "render_template",
    "jsonresponse",
    "logger.info",
    "logger.debug",
    "print",
}
DOMAIN_PACKAGES = {
    "medspacy",
    "pydicom",
    "hl7",
    "fhir",
    "legal-python",
    "courtlistener",
    "rdflib",
    "yfinance",
    "quantlib",
    "fredapi",
}
HIGH_STAKES_FUNCTION_NAMES = {
    "approve",
    "reject",
    "deny",
    "grant_access",
    "assess_risk",
    "evaluate_eligibility",
    "make_final_decision",
    "sentence",
}


@dataclass(frozen=True)
class TechnicalFinding:
    finding_id: str
    finding_type: str
    file_path: str
    line_number: int | None
    rule_ids: list[str]
    source_tools: list[str]
    analysis_level: str
    confidence: float
    confidence_components: dict[str, float]
    library_group: str | None
    kwarg_names: list[str]
    has_dynamic_call: bool
    coverage_note: str | None


class AIInvocationDetector:
    def __init__(
        self,
        *,
        signal_fuser: SignalFuser | None = None,
        deduplicator: FindingDeduplicator | None = None,
    ) -> None:
        self._signal_fuser = signal_fuser or SignalFuser()
        self._deduplicator = deduplicator or FindingDeduplicator()

    def detect(
        self,
        *,
        semgrep_result: SemgrepRunResult | None = None,
        python_analysis: PythonAnalysisResult | None = None,
        ts_js_analysis: TsJsBridgeResult | None = None,
        syft_result: SyftRunResult | None = None,
        package_dependencies: list[PackageDependency] | None = None,
        tool_executions: list[ToolExecutionResult] | None = None,
    ) -> list[TechnicalFinding]:
        primary = self._signal_fuser.fuse(
            semgrep_result=semgrep_result,
            python_analysis=python_analysis,
            ts_js_analysis=ts_js_analysis,
        )
        primary.extend(self._coverage_candidates(tool_executions or []))
        merged = self._deduplicator.deduplicate(primary)
        # Extended signals are derived after primary dedup so one call site cannot
        # fan out duplicate business signals from Semgrep + AST/CST overlap.
        merged.extend(
            self._deduplicator.deduplicate(
                self._extended_candidates(
                    merged,
                    syft_result=syft_result,
                    package_dependencies=package_dependencies or [],
                )
            )
        )

        material_limitations = self._material_coverage_limitations(tool_executions or [])
        findings: list[TechnicalFinding] = []
        for candidate in merged:
            findings.append(
                self._technical_finding(
                    candidate,
                    syft_result=syft_result,
                    package_dependencies=package_dependencies or [],
                    material_limitations=material_limitations,
                )
            )
            if candidate.has_dynamic_call and candidate.finding_type != UNSUPPORTED_DYNAMIC_FLOW:
                findings.append(self._dynamic_flow_finding(candidate))

        return self._sort_findings(self._dedupe_technical_findings(findings))

    def _technical_finding(
        self,
        candidate: MergedFindingCandidate,
        *,
        syft_result: SyftRunResult | None,
        package_dependencies: list[PackageDependency],
        material_limitations: int,
    ) -> TechnicalFinding:
        if candidate.finding_type in {SCAN_COVERAGE_LIMITATION, UNSUPPORTED_DYNAMIC_FLOW}:
            # Limitation confidence means "the limitation exists"; it is not
            # evidence that the scanned app performs an AI business action.
            confidence, components = calculate_confidence(candidate.finding_type)
            source_tools = list(candidate.source_tools)
        else:
            corroborators = self._corroborating_tools(
                candidate,
                syft_result=syft_result,
                package_dependencies=package_dependencies,
            )
            confidence, components = calculate_confidence(
                candidate.finding_type,
                has_direct_ast_cst_evidence=self._has_direct_evidence(candidate),
                corroborating_tools=corroborators,
                material_coverage_limitations=material_limitations,
                has_unresolved_path=candidate.has_dynamic_call,
            )
            source_tools = sorted({*candidate.source_tools, *corroborators})

        return TechnicalFinding(
            finding_id=self._finding_id(candidate),
            finding_type=candidate.finding_type,
            file_path=candidate.file_path,
            line_number=candidate.line_number,
            rule_ids=list(candidate.rule_ids),
            source_tools=source_tools,
            analysis_level=candidate.analysis_level,
            confidence=confidence,
            confidence_components=components,
            library_group=candidate.library_group,
            kwarg_names=list(candidate.kwarg_names),
            has_dynamic_call=candidate.has_dynamic_call,
            coverage_note=candidate.coverage_note,
        )

    def _coverage_candidates(
        self, tool_executions: list[ToolExecutionResult]
    ) -> list[FindingCandidate]:
        # Tool failures stay visible in the evidence payload instead of silently
        # lowering confidence, which lets downstream reviewers explain gaps.
        return [
            FindingCandidate(
                finding_type=SCAN_COVERAGE_LIMITATION,
                file_path="<workspace>",
                line_number=None,
                rule_id=f"tool-failure:{execution.tool_name}",
                source_tool=execution.tool_name,
                analysis_level="L4",
                coverage_note="; ".join(execution.messages) or execution.outcome,
            )
            for execution in tool_executions
            if execution.outcome != OUTCOME_SUCCESS
        ]

    def _extended_candidates(
        self,
        merged: list[MergedFindingCandidate],
        *,
        syft_result: SyftRunResult | None,
        package_dependencies: list[PackageDependency],
    ) -> list[FindingCandidate]:
        candidates: list[FindingCandidate] = []
        primary = [
            item
            for item in merged
            if item.finding_type not in {SCAN_COVERAGE_LIMITATION, UNSUPPORTED_DYNAMIC_FLOW}
        ]
        for item in primary:
            candidates.extend(self._call_site_extended_candidates(item))
        candidates.extend(
            self._domain_candidates(primary, syft_result, package_dependencies)
        )
        return candidates

    def _call_site_extended_candidates(
        self, item: MergedFindingCandidate
    ) -> list[FindingCandidate]:
        candidates: list[FindingCandidate] = []
        if INPUT_KWARG_NAMES.intersection(item.kwarg_names):
            candidates.append(
                self._derived_candidate(item, AI_INPUT_SIGNAL, "extended-ai-input-signal")
            )
        if item.has_output_assignment and item.output_is_used:
            candidates.append(
                self._derived_candidate(
                    item,
                    AI_OUTPUT_SIGNAL,
                    "extended-ai-output-signal",
                )
            )

        decisive_type = self._decisive_signal_type(item)
        if decisive_type:
            candidates.append(
                self._derived_candidate(
                    item,
                    decisive_type,
                    f"extended-{decisive_type.lower()}",
                )
            )
        elif self._is_display_only(item):
            candidates.append(
                self._derived_candidate(
                    item,
                    DISPLAY_ONLY_SIGNAL,
                    "extended-display-only-signal",
                )
            )
        return candidates

    def _derived_candidate(
        self, item: MergedFindingCandidate, finding_type: str, rule_id: str
    ) -> FindingCandidate:
        return FindingCandidate(
            finding_type=finding_type,
            file_path=item.file_path,
            line_number=item.line_number,
            rule_id=rule_id,
            source_tool="signal_fuser",
            analysis_level=item.analysis_level,
            library_group=item.library_group,
            kwarg_names=list(item.kwarg_names),
            has_dynamic_call=item.has_dynamic_call,
            function_names=list(item.function_names),
        )

    def _domain_candidates(
        self,
        primary: list[MergedFindingCandidate],
        syft_result: SyftRunResult | None,
        package_dependencies: list[PackageDependency],
    ) -> list[FindingCandidate]:
        package_names = self._package_names(syft_result, package_dependencies)
        function_names = {
            function_name.lower()
            for item in primary
            for function_name in item.function_names
        }
        candidates: list[FindingCandidate] = []
        if DOMAIN_PACKAGES.intersection(package_names):
            candidates.append(
                FindingCandidate(
                    finding_type=DOMAIN_CONTEXT_SIGNAL,
                    file_path="<workspace>",
                    line_number=None,
                    rule_id="extended-domain-context-package",
                    source_tool="signal_fuser",
                    analysis_level="L0",
                    library_group=next(
                        iter(sorted(DOMAIN_PACKAGES.intersection(package_names)))
                    ),
                )
            )
        if (
            DOMAIN_PACKAGES.intersection(package_names)
            or HIGH_STAKES_FUNCTION_NAMES.intersection(function_names)
        ):
            candidates.append(
                FindingCandidate(
                    finding_type=HARM_POTENTIAL_SIGNAL,
                    file_path="<workspace>",
                    line_number=None,
                    rule_id="extended-harm-potential-signal",
                    source_tool="signal_fuser",
                    analysis_level="L0",
                )
            )
        return candidates

    def _decisive_signal_type(self, item: MergedFindingCandidate) -> str | None:
        names = {name.lower() for name in item.function_names}
        joined = " ".join(names)
        if any(pattern in joined for pattern in USER_IMPACT_PATTERNS):
            return USER_IMPACT_SIGNAL
        if any(pattern in joined for pattern in STATUS_PATTERNS):
            return STATUS_UPDATE_SIGNAL
        if any(pattern in joined for pattern in RANKING_PATTERNS):
            return RANKING_SIGNAL
        if any(pattern in joined for pattern in RECOMMENDATION_PATTERNS):
            return RECOMMENDATION_SIGNAL
        return None

    def _is_display_only(self, item: MergedFindingCandidate) -> bool:
        if item.has_dynamic_call:
            return False
        names = " ".join(name.lower() for name in item.function_names)
        return any(pattern in names for pattern in DISPLAY_ONLY_PATTERNS)

    def _corroborating_tools(
        self,
        candidate: MergedFindingCandidate,
        *,
        syft_result: SyftRunResult | None,
        package_dependencies: list[PackageDependency],
    ) -> list[str]:
        tools: set[str] = set()
        if self._sbom_corroborates(candidate, syft_result):
            tools.add("sbom")
        for dependency in package_dependencies:
            if not dependency.is_ai_relevant:
                continue
            if not self._package_matches(candidate.library_group, dependency.name):
                continue
            for fact in dependency.usage_facts:
                tools.add(fact.source_tool)
        return sorted(tools)

    def _sbom_corroborates(
        self, candidate: MergedFindingCandidate, syft_result: SyftRunResult | None
    ) -> bool:
        if syft_result is None:
            return False
        return any(
            is_ai_package(entry.name) and self._package_matches(candidate.library_group, entry.name)
            for entry in syft_result.entries
        )

    def _package_matches(self, library_group: str | None, package_name: str) -> bool:
        if not library_group:
            return is_ai_package(package_name)
        normalized_group = library_group.lower().replace("_", "-")
        normalized_package = package_name.lower().replace("_", "-")
        aliases = {
            "openai": {"openai", "openai-python", "langchain-openai"},
            "anthropic": {"anthropic", "@anthropic-ai/sdk", "langchain-anthropic"},
            "google-genai": {
                "google-generativeai",
                "@google/generative-ai",
                "google-cloud-aiplatform",
                "vertexai",
            },
            "huggingface": {"transformers", "huggingface-hub", "@huggingface/inference"},
            "llamaindex": {"llama-index", "llama-index-core", "llamaindex"},
        }
        if normalized_group not in aliases and not is_ai_package(normalized_group):
            return is_ai_package(normalized_package)
        return normalized_package in aliases.get(normalized_group, {normalized_group})

    def _package_names(
        self,
        syft_result: SyftRunResult | None,
        package_dependencies: list[PackageDependency],
    ) -> set[str]:
        names = {dependency.name.lower().replace("_", "-") for dependency in package_dependencies}
        if syft_result:
            names.update(entry.name.lower().replace("_", "-") for entry in syft_result.entries)
        return names

    def _has_direct_evidence(self, candidate: MergedFindingCandidate) -> bool:
        return bool({"python_ast", "ts_js_bridge"}.intersection(candidate.source_tools))

    def _material_coverage_limitations(self, tool_executions: list[ToolExecutionResult]) -> int:
        return sum(1 for execution in tool_executions if execution.outcome != OUTCOME_SUCCESS)

    def _dynamic_flow_finding(self, candidate: MergedFindingCandidate) -> TechnicalFinding:
        dynamic_candidate = MergedFindingCandidate(
            finding_type=UNSUPPORTED_DYNAMIC_FLOW,
            file_path=candidate.file_path,
            line_number=candidate.line_number,
            rule_ids=["unsupported-dynamic-flow"],
            source_tools=list(candidate.source_tools),
            analysis_level="L4",
            library_group=candidate.library_group,
            kwarg_names=list(candidate.kwarg_names),
            has_dynamic_call=True,
            coverage_note=candidate.coverage_note or "dynamic or unresolved AI call path",
        )
        return self._technical_finding(
            dynamic_candidate,
            syft_result=None,
            package_dependencies=[],
            material_limitations=0,
        )

    def _finding_id(self, candidate: MergedFindingCandidate) -> str:
        key = "|".join(
            [
                candidate.finding_type,
                candidate.file_path,
                str(candidate.line_number),
                ",".join(candidate.rule_ids),
                ",".join(candidate.source_tools),
            ]
        )
        return str(uuid.uuid5(uuid.NAMESPACE_URL, key))

    def _dedupe_technical_findings(
        self, findings: list[TechnicalFinding]
    ) -> list[TechnicalFinding]:
        seen: set[tuple[str, str, int | None, tuple[str, ...]]] = set()
        deduped: list[TechnicalFinding] = []
        for finding in findings:
            key = (
                finding.finding_type,
                finding.file_path,
                finding.line_number,
                tuple(finding.rule_ids),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(finding)
        return deduped

    def _sort_findings(self, findings: list[TechnicalFinding]) -> list[TechnicalFinding]:
        priority = {
            UNSUPPORTED_DYNAMIC_FLOW: 0,
            SCAN_COVERAGE_LIMITATION: 0,
        }
        return sorted(
            findings,
            key=lambda finding: (
                priority.get(finding.finding_type, 1),
                -finding.confidence,
                finding.file_path,
                finding.line_number if finding.line_number is not None else -1,
                finding.finding_type,
            ),
        )
