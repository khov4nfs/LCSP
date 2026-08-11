from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable

from lcsp_workers.platform.callback_schemas import (
    SCAN_CALLBACK_STATUSES,
    ScanCallbackPayload,
)
from lcsp_workers.platform.redaction import redact_dict, redact_source_code
from lcsp_workers.scanner.analyzers.ai_invocation_detector import TechnicalFinding
from lcsp_workers.scanner.analyzers.python_analyzer import PythonAnalysisResult
from lcsp_workers.scanner.dependencies.dependency_fact import PackageDependency
from lcsp_workers.scanner.inventory.language_types import LanguageClassification
from lcsp_workers.scanner.ts_js_bridge.bridge_types import TsJsBridgeResult

from .parsers.structural_types import StructuralFact
from .tools.semgrep_tool import SemgrepRunResult
from .tools.syft_tool import SyftRunResult
from .graph.graph_serializer import ScanGraph, serialize_graph
from .tools.tool_base import OUTCOME_SUCCESS, ToolExecutionResult


SCHEMA_VERSION = "1.0.0"
PRIVACY_ASSERTION_FAILED = "PRIVACY_ASSERTION_FAILED"
ALL_TOOLS_FAILED = "ALL_TOOLS_FAILED"


@dataclass(frozen=True)
class PrivacyFlags:
    contains_source_code: bool
    secrets_redacted: bool
    source_stripped_from_findings: bool

    def to_callback_dict(self) -> dict[str, bool]:
        return {
            "containsSourceCode": self.contains_source_code,
            "secretsRedacted": self.secrets_redacted,
            "sourceStrippedFromFindings": self.source_stripped_from_findings,
        }


@dataclass(frozen=True)
class ToolFailureRecord:
    tool_name: str
    tool_version: str
    outcome: str
    messages: list[str]


class PrivacyAssertionError(RuntimeError):
    def __init__(self, message: str, error_code: str = PRIVACY_ASSERTION_FAILED) -> None:
        super().__init__(message)
        self.error_code = error_code


class EvidenceAssembler:
    def assemble(
        self,
        *,
        scan_job_id: str,
        syft_result: SyftRunResult | None,
        semgrep_result: SemgrepRunResult,
        coverage_notes: list[str],
        package_dependencies: list[PackageDependency] | None = None,
        dependency_executions: list[ToolExecutionResult] | None = None,
        python_analysis: PythonAnalysisResult | None = None,
        ts_js_analysis: TsJsBridgeResult | None = None,
        technical_findings: list[TechnicalFinding] | None = None,
        structural_facts: list[StructuralFact] | None = None,
        evidence_graph: ScanGraph | None = None,
        scan_coverage: list[LanguageClassification] | None = None,
    ) -> ScanCallbackPayload:
        executions = [
            *( [syft_result.execution] if syft_result is not None else [] ),
            *semgrep_result.executions,
            *(dependency_executions or []),
        ]
        if ts_js_analysis is not None:
            executions.append(ts_js_analysis.execution)
        findings = [asdict(finding) for finding in semgrep_result.findings]
        redacted_findings = redact_source_code(findings)
        source_stripped = len(redacted_findings) == len(findings)

        evidence_payload = {
            "sbom_entries": [asdict(entry) for entry in (syft_result.entries if syft_result is not None else [])],
            "ai_usage_signals": redacted_findings,
            "package_dependencies": [
                asdict(package) for package in (package_dependencies or [])
            ],
            "python_analysis": asdict(python_analysis) if python_analysis else None,
            "ts_js_analysis": asdict(ts_js_analysis) if ts_js_analysis else None,
            "technical_findings": [
                asdict(finding) for finding in (technical_findings or [])
            ],
            "structural_facts": [
                asdict(fact) for fact in (structural_facts or [])
            ],
            "tool_failures": [
                asdict(record) for record in self._tool_failures(executions)
            ],
            "coverage_notes": list(coverage_notes),
            "scan_coverage": self._scan_coverage(scan_coverage or []),
            "evidence_graph": serialize_graph(evidence_graph) if evidence_graph else None,
        }
        safe_evidence_payload = redact_dict(evidence_payload)

        privacy_flags = PrivacyFlags(
            contains_source_code=False,
            secrets_redacted=True,
            source_stripped_from_findings=source_stripped,
        )
        self._assert_privacy(privacy_flags, findings, redacted_findings)

        status, error_code = self._status_for(executions)
        return ScanCallbackPayload(
            scan_job_id=scan_job_id,
            tools_version=self._tools_version(executions),
            config_hash=self._config_hash(executions),
            evidence_payload=safe_evidence_payload,
            privacy_flags=privacy_flags.to_callback_dict(),
            schema_version=SCHEMA_VERSION,
            status=status,
            error_code=error_code,
        )

    @staticmethod
    def _scan_coverage(
        classifications: list[LanguageClassification],
    ) -> dict[str, object]:
        files = [asdict(item) for item in classifications]
        return {
            "files": files,
            "counts": {
                "total": len(files),
                "limited": sum(1 for item in classifications if item.coverage_limitation),
                "skipped": sum(
                    1 for item in classifications if item.support_level == "SKIP"
                ),
            },
        }

    def _tools_version(
        self, executions: Iterable[ToolExecutionResult]
    ) -> dict[str, str]:
        return {execution.tool_name: execution.tool_version for execution in executions}

    def _config_hash(self, executions: Iterable[ToolExecutionResult]) -> dict[str, str]:
        return {execution.tool_name: execution.config_hash for execution in executions}

    def _tool_failures(
        self, executions: Iterable[ToolExecutionResult]
    ) -> list[ToolFailureRecord]:
        return [
            ToolFailureRecord(
                tool_name=execution.tool_name,
                tool_version=execution.tool_version,
                outcome=execution.outcome,
                messages=list(execution.messages),
            )
            for execution in executions
            if execution.outcome != OUTCOME_SUCCESS
        ]

    def _status_for(
        self, executions: Iterable[ToolExecutionResult]
    ) -> tuple[str, str | None]:
        outcomes = [execution.outcome for execution in executions]
        failed_count = sum(1 for outcome in outcomes if outcome != OUTCOME_SUCCESS)
        if failed_count == 0:
            return SCAN_CALLBACK_STATUSES["success"], None
        if failed_count == len(outcomes):
            return SCAN_CALLBACK_STATUSES["failed"], ALL_TOOLS_FAILED
        return SCAN_CALLBACK_STATUSES["partial"], None

    def _assert_privacy(
        self,
        privacy_flags: PrivacyFlags,
        original_findings: list[dict],
        redacted_findings: list[dict],
    ) -> None:
        if privacy_flags.contains_source_code:
            raise PrivacyAssertionError("evidence payload contains source code")
        if not privacy_flags.secrets_redacted:
            raise PrivacyAssertionError("evidence payload contains unredacted secrets")
        if len(original_findings) != len(redacted_findings):
            raise PrivacyAssertionError("raw source was stripped from findings")
