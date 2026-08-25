from __future__ import annotations

from dataclasses import dataclass, field

from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalysisResult
from tools.common.capabilities.evidence.scanner.tools.semgrep.semgrep_tool import SemgrepRunResult
from tools.common.capabilities.evidence.scanner.ts_js_bridge.bridge_types import TsJsBridgeResult

from .finding_types import (
    SCAN_COVERAGE_LIMITATION,
    UNSUPPORTED_DYNAMIC_FLOW,
    is_canonical_finding_type,
)


@dataclass(frozen=True)
class FindingCandidate:
    finding_type: str
    file_path: str
    line_number: int | None
    rule_id: str
    source_tool: str
    analysis_level: str
    library_group: str | None = None
    kwarg_names: list[str] = field(default_factory=list)
    has_dynamic_call: bool = False
    coverage_note: str | None = None
    function_names: list[str] = field(default_factory=list)
    has_output_assignment: bool = False
    output_is_used: bool = False


class SignalFuser:
    def fuse(
        self,
        *,
        semgrep_result: SemgrepRunResult | None = None,
        python_analysis: PythonAnalysisResult | None = None,
        ts_js_analysis: TsJsBridgeResult | None = None,
    ) -> list[FindingCandidate]:
        candidates: list[FindingCandidate] = []
        candidates.extend(self._semgrep_candidates(semgrep_result))
        candidates.extend(self._python_candidates(python_analysis))
        candidates.extend(self._ts_js_candidates(ts_js_analysis))
        return candidates

    def _semgrep_candidates(
        self, semgrep_result: SemgrepRunResult | None
    ) -> list[FindingCandidate]:
        if semgrep_result is None:
            return []
        candidates: list[FindingCandidate] = []
        for finding in semgrep_result.findings:
            finding_type = self._finding_type(finding.finding_type)
            # Semgrep contributes rule metadata only; source snippets are already
            # stripped by the tool wrapper before fusion reaches this layer.
            candidates.append(
                FindingCandidate(
                    finding_type=finding_type,
                    file_path=finding.file_path,
                    line_number=max(1, finding.line_start),
                    rule_id=finding.rule_id,
                    source_tool="semgrep",
                    analysis_level="L1",
                    library_group=finding.library_group,
                )
            )
        return candidates

    def _python_candidates(
        self, python_analysis: PythonAnalysisResult | None
    ) -> list[FindingCandidate]:
        if python_analysis is None:
            return []

        candidates: list[FindingCandidate] = []
        for site in python_analysis.ai_call_sites:
            # Python AST/CST sites provide direct structural evidence, but only
            # argument names and metadata are carried forward for privacy.
            candidates.append(
                FindingCandidate(
                    finding_type=self._finding_type(site.finding_type),
                    file_path=site.file_path,
                    line_number=max(1, site.line_number),
                    rule_id=site.matched_rule_id,
                    source_tool="python_ast",
                    analysis_level=site.analysis_level,
                    library_group=self._library_group(site.module_alias),
                    kwarg_names=list(site.kwarg_names),
                    has_dynamic_call=site.has_dynamic_call,
                    function_names=[site.function_name],
                    has_output_assignment=self._has_output_assignment(site.evidence),
                    output_is_used=self._output_is_used(site.evidence),
                )
            )

        for flow in python_analysis.unsupported_dynamic_flows:
            candidates.append(
                FindingCandidate(
                    finding_type=UNSUPPORTED_DYNAMIC_FLOW,
                    file_path=str(flow.get("file", "<workspace>")),
                    line_number=self._optional_line(flow.get("line")),
                    rule_id="python-unsupported-dynamic-flow",
                    source_tool="python_ast",
                    analysis_level="L4",
                    has_dynamic_call=True,
                    coverage_note=str(flow.get("reason", "unsupported dynamic flow")),
                )
            )
        if python_analysis.coverage_limitation:
            candidates.append(
                FindingCandidate(
                    finding_type=SCAN_COVERAGE_LIMITATION,
                    file_path="<workspace>",
                    line_number=None,
                    rule_id="python-analysis-coverage-limited",
                    source_tool="python_ast",
                    analysis_level="L4",
                    coverage_note="python analysis coverage limitation",
                )
            )
        return candidates

    def _ts_js_candidates(
        self, ts_js_analysis: TsJsBridgeResult | None
    ) -> list[FindingCandidate]:
        if ts_js_analysis is None:
            return []

        candidates: list[FindingCandidate] = []
        for finding in ts_js_analysis.findings:
            # The subprocess bridge normalizes JS/TS calls into the same shape
            # as Python call sites so confidence can be calculated uniformly.
            candidates.append(
                FindingCandidate(
                    finding_type=self._finding_type(finding.finding_type),
                    file_path=finding.file_path,
                    line_number=max(1, finding.line_number),
                    rule_id=finding.rule_id,
                    source_tool="ts_js_bridge",
                    analysis_level=finding.analysis_level,
                    library_group=self._library_group(finding.import_source),
                    kwarg_names=list(finding.kwarg_names),
                    has_dynamic_call=finding.has_dynamic_call,
                    function_names=[finding.call_expression.rsplit(".", 1)[-1]],
                )
            )

        for flow in ts_js_analysis.unsupported_dynamic_flows:
            candidates.append(
                FindingCandidate(
                    finding_type=UNSUPPORTED_DYNAMIC_FLOW,
                    file_path=flow.file_path,
                    line_number=max(1, flow.line_number),
                    rule_id="ts-js-unsupported-dynamic-flow",
                    source_tool="ts_js_bridge",
                    analysis_level="L4",
                    has_dynamic_call=True,
                    coverage_note=flow.reason,
                )
            )
        return candidates

    def _finding_type(self, value: str) -> str:
        return value if is_canonical_finding_type(value) else "AI_PROVIDER_USAGE"

    def _library_group(self, value: str | None) -> str | None:
        if not value or value == "*":
            return None
        normalized = value.lower().replace("_", "-")
        if "openai" in normalized:
            return "openai"
        if "anthropic" in normalized:
            return "anthropic"
        if "google" in normalized or "vertex" in normalized:
            return "google-genai"
        if "huggingface" in normalized or "transformers" in normalized:
            return "huggingface"
        if "langchain" in normalized:
            return "langchain"
        if "llama" in normalized:
            return "llamaindex"
        return normalized

    def _optional_line(self, value: object) -> int | None:
        if isinstance(value, int) and value > 0:
            return value
        return None

    def _has_output_assignment(self, evidence: list[dict]) -> bool:
        return any(item.get("assigned_to") for item in evidence)

    def _output_is_used(self, evidence: list[dict]) -> bool:
        return any(bool(item.get("used")) for item in evidence)
