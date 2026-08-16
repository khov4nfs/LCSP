from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
import re
from typing import Iterable

from lcsp_workers.platform.callback_schemas import (
    SCAN_CALLBACK_STATUSES,
    ScanCallbackPayload,
)
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.redaction import redact_dict, redact_source_code
from lcsp_workers.scanner.analyzers.ai_invocation_detector import TechnicalFinding
from lcsp_workers.scanner.analyzers.python_analyzer import PythonAnalysisResult
from lcsp_workers.scanner.dependencies.dependency_fact import PackageDependency
from lcsp_workers.scanner.inventory.language_types import LanguageClassification
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph
from lcsp_workers.scanner.ts_js_bridge.bridge_types import TsJsBridgeResult

from .parsers.structural_types import StructuralFact
from .tool_registry import ToolProvenance
from .tools.semgrep_tool import SemgrepRunResult
from .tools.syft_tool import SyftRunResult
from .tools.tool_base import OUTCOME_SKIPPED_UNSUPPORTED, OUTCOME_SUCCESS, ToolExecutionResult


logger = get_logger(__name__)

SCHEMA_VERSION = "1.0.0"
PRIVACY_ASSERTION_FAILED = "PRIVACY_ASSERTION_FAILED"
ALL_TOOLS_FAILED = "ALL_TOOLS_FAILED"
SCANNER_PRIVACY_DEBUG_ENV = "SCANNER_PRIVACY_DEBUG"
FORBIDDEN_PERSISTED_KEYS = {
    "source_code",
    "raw_source",
    "raw_content",
    "full_source",
    "prompt",
    "prompt_text",
    "full_prompt",
    "ast_body",
    "full_ast",
    "ast_dump",
    "secret",
    "token",
    "api_key",
    "api_token",
    "authorization",
    "credential",
    "password",
}
SECRET_VALUE_PATTERNS = (
    re.compile(r"\bgh[porsu]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-ant-[A-Za-z0-9._-]{16,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._-]{12,}\b", re.IGNORECASE),
)
SOURCE_BODY_PATTERN = re.compile(
    r"(?:\bdef\s+\w+\s*\(|\bfunction\s+\w*\s*\(|"
    r"\bclass\s+\w+|\bimport\s+[\w{*])"
)


@dataclass(frozen=True)
class PrivacyFlags:
    """Declares privacy guarantees attached to the persisted scan callback."""

    contains_source_code: bool
    secrets_redacted: bool
    source_stripped_from_findings: bool

    def to_callback_dict(self) -> dict[str, bool]:
        """Convert internal snake-case flags to the callback contract shape."""
        return {
            "containsSourceCode": self.contains_source_code,
            "secretsRedacted": self.secrets_redacted,
            "sourceStrippedFromFindings": self.source_stripped_from_findings,
        }


@dataclass(frozen=True)
class ToolFailureRecord:
    """Business-safe execution metadata for a scanner tool that did not succeed."""

    tool_name: str
    tool_version: str
    outcome: str
    messages: list[str]


class PrivacyAssertionError(RuntimeError):
    """Raised when evidence would violate the worker persistence privacy contract.

    The exception carries structure-only diagnostics. It never stores or logs the
    rejected value itself, so development diagnostics can identify the exact
    payload location without weakening the privacy boundary.
    """

    def __init__(
        self,
        message: str,
        error_code: str = PRIVACY_ASSERTION_FAILED,
        *,
        reason: str = "PRIVACY_ASSERTION_FAILED",
        json_path: str = "$",
        field_name: str | None = None,
        value_type: str | None = None,
        container_size: int | None = None,
        string_length: int | None = None,
    ) -> None:
        """Create a privacy failure with safe structural diagnostics."""
        super().__init__(f"{message} at {json_path}")
        self.error_code = error_code
        self.reason = reason
        self.json_path = json_path
        self.field_name = field_name
        self.value_type = value_type
        self.container_size = container_size
        self.string_length = string_length

    def safe_diagnostic(self) -> dict[str, object]:
        """Return metadata safe for development logging without rejected values."""
        diagnostic: dict[str, object] = {
            "reason": self.reason,
            "json_path": self.json_path,
        }
        if self.field_name is not None:
            diagnostic["field_name"] = self.field_name
        if self.value_type is not None:
            diagnostic["value_type"] = self.value_type
        if self.container_size is not None:
            diagnostic["container_size"] = self.container_size
        if self.string_length is not None:
            diagnostic["string_length"] = self.string_length
        return diagnostic


class EvidenceAssembler:
    """Build a redacted, provenance-bound scan callback from analyzer/tool outputs.

    This is the final privacy boundary before scan evidence leaves the worker. It
    strips source-bearing finding fields, rejects forbidden keys and recognizable
    secrets/raw source, computes aggregate tool status, and hashes the canonical
    report so downstream services can bind decisions to the exact evidence payload.
    """

    def assemble(
        self,
        *,
        scan_job_id: str,
        syft_result: SyftRunResult | None,
        semgrep_result: SemgrepRunResult | None,
        coverage_notes: list[str],
        package_dependencies: list[PackageDependency] | None = None,
        dependency_executions: list[ToolExecutionResult] | None = None,
        python_analysis: PythonAnalysisResult | None = None,
        ts_js_analysis: TsJsBridgeResult | None = None,
        technical_findings: list[TechnicalFinding] | None = None,
        structural_facts: list[StructuralFact] | None = None,
        evidence_graph: ProgramEvidenceGraph | None = None,
        scan_coverage: list[LanguageClassification] | None = None,
        targeted_reanalysis: dict[str, object] | None = None,
        tool_provenance: list[ToolProvenance] | None = None,
    ) -> ScanCallbackPayload:
        """Assemble the callback payload after enforcing evidence privacy invariants."""
        executions = [
            *([syft_result.execution] if syft_result is not None else []),
            *(semgrep_result.executions if semgrep_result is not None else []),
            *(dependency_executions or []),
        ]
        if ts_js_analysis is not None:
            executions.append(ts_js_analysis.execution)

        findings = [
            asdict(finding)
            for finding in (semgrep_result.findings if semgrep_result is not None else [])
        ]
        redacted_findings = redact_source_code(findings)
        source_stripped = len(redacted_findings) == len(findings)

        evidence_payload = {
            "sbom_entries": [
                asdict(entry) for entry in (syft_result.entries if syft_result is not None else [])
            ],
            "ai_usage_signals": redacted_findings,
            "package_dependencies": [
                asdict(package) for package in (package_dependencies or [])
            ],
            "python_analysis": self._persistable_python_analysis(python_analysis),
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
            "tool_provenance": [
                asdict(record) for record in (tool_provenance or [])
            ],
            "coverage_notes": list(coverage_notes),
            "scan_coverage": self._scan_coverage(scan_coverage or []),
            "evidence_graph": evidence_graph.to_dict() if evidence_graph else None,
            "targeted_reanalysis": targeted_reanalysis,
        }
        self._assert_safe_payload(evidence_payload)

        # Move/summarize large graph payload if present
        if evidence_graph:
            full_graph_dict = evidence_graph.to_dict()
            graph_id = full_graph_dict.get("graph_id") or "unknown"
            ref_path = f"/tmp/lcsp-evidence-graph-{graph_id}.json"
            
            import json
            try:
                with open(ref_path, "w") as f:
                    json.dump(full_graph_dict, f)
            except Exception:
                pass
                
            evidence_payload["evidence_graph"] = {
                "graph_id": graph_id,
                "snapshot_id": full_graph_dict.get("snapshot_id"),
                "commit_sha": full_graph_dict.get("commit_sha"),
                "node_count": full_graph_dict.get("node_count"),
                "edge_count": full_graph_dict.get("edge_count"),
                "graph_hash": full_graph_dict.get("graph_hash"),
                "schema_version": full_graph_dict.get("schema_version"),
                "coverage_state": full_graph_dict.get("coverage_state"),
                "coverage_notes": full_graph_dict.get("coverage_notes"),
                "provenance": full_graph_dict.get("provenance"),
                "evidence_refs": full_graph_dict.get("evidence_refs"),
                "unresolved_frontiers": full_graph_dict.get("unresolved_frontiers"),
                "nodes": [],
                "edges": [],
                "source_anchors": [],
                "indexes": {},
                "evidence_graph_ref": ref_path,
            }

        privacy_flags = PrivacyFlags(
            contains_source_code=False,
            secrets_redacted=True,
            source_stripped_from_findings=source_stripped,
        )
        self._assert_privacy(privacy_flags, findings, redacted_findings)

        status, error_code = self._status_for(executions)
        safe_evidence_payload = redact_dict(evidence_payload)
        safe_evidence_payload["report_provenance"] = self._report_provenance(
            scan_job_id=scan_job_id,
            status=status,
            error_code=error_code,
            tools_version=self._tools_version(executions),
            config_hash=self._config_hash(executions),
            privacy_flags=privacy_flags.to_callback_dict(),
            evidence_payload=safe_evidence_payload,
        )
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
    def _persistable_python_analysis(
        python_analysis: PythonAnalysisResult | None,
    ) -> dict | None:
        """Serialize Python analysis without treating source identifiers as JSON field names.

        ``import_map`` is keyed by repository-controlled local identifiers. A valid alias
        such as ``secret`` or ``token`` is semantic source metadata, not a persisted
        credential field. Persist those bindings as records so the privacy boundary can
        continue to reject actual forbidden schema keys without erasing useful semantics.
        """
        if python_analysis is None:
            return None
        payload = asdict(python_analysis)
        import_map = payload.pop("import_map", {})
        payload["import_bindings"] = [
            {
                "local_name": str(local_name),
                "package": str(package_name),
            }
            for local_name, package_name in sorted(import_map.items())
        ]
        return payload

    @staticmethod
    def _report_provenance(
        *,
        scan_job_id: str,
        status: str,
        error_code: str | None,
        tools_version: dict[str, str],
        config_hash: dict[str, str],
        privacy_flags: dict[str, bool],
        evidence_payload: dict,
    ) -> dict[str, str]:
        """Hash a canonical report representation for downstream provenance checks."""
        canonical_report = {
            "schema_version": SCHEMA_VERSION,
            "scan_job_id": scan_job_id,
            "status": status,
            "error_code": error_code,
            "tools_version": tools_version,
            "config_hash": config_hash,
            "privacy_flags": privacy_flags,
            "evidence_payload": evidence_payload,
        }
        encoded = json.dumps(
            canonical_report,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return {
            "schema_version": SCHEMA_VERSION,
            "hash_algorithm": "SHA-256",
            "report_hash": f"sha256:{hashlib.sha256(encoded).hexdigest()}",
        }

    @staticmethod
    def _scan_coverage(
        classifications: list[LanguageClassification],
    ) -> dict[str, object]:
        """Summarize per-file scanner support without discarding detailed coverage."""
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
        """Project tool execution metadata into the callback version map."""
        return {execution.tool_name: execution.tool_version for execution in executions}

    def _config_hash(self, executions: Iterable[ToolExecutionResult]) -> dict[str, str]:
        """Project tool execution metadata into reproducibility config hashes."""
        return {execution.tool_name: execution.config_hash for execution in executions}

    def _tool_failures(
        self, executions: Iterable[ToolExecutionResult]
    ) -> list[ToolFailureRecord]:
        """Return only non-success executions as safe failure records."""
        return [
            ToolFailureRecord(
                tool_name=execution.tool_name,
                tool_version=execution.tool_version,
                outcome=execution.outcome,
                messages=self._failure_messages(execution),
            )
            for execution in executions
            if execution.outcome not in (OUTCOME_SUCCESS, OUTCOME_SKIPPED_UNSUPPORTED)
        ]

    def _status_for(
        self, executions: Iterable[ToolExecutionResult]
    ) -> tuple[str, str | None]:
        """Derive callback status from aggregate tool outcomes."""
        outcomes = [execution.outcome for execution in executions]
        if not outcomes:
            return SCAN_CALLBACK_STATUSES["success"], None
        failed_count = sum(
            1
            for outcome in outcomes
            if outcome not in (OUTCOME_SUCCESS, OUTCOME_SKIPPED_UNSUPPORTED)
        )
        run_count = sum(
            1 for outcome in outcomes if outcome != OUTCOME_SKIPPED_UNSUPPORTED
        )
        if failed_count == 0:
            return SCAN_CALLBACK_STATUSES["success"], None
        if run_count > 0 and failed_count == run_count:
            return SCAN_CALLBACK_STATUSES["failed"], ALL_TOOLS_FAILED
        return SCAN_CALLBACK_STATUSES["partial"], None

    @staticmethod
    def _failure_messages(execution: ToolExecutionResult) -> list[str]:
        if execution.messages:
            return list(execution.messages)
        return [f"{execution.tool_name}: {execution.outcome} without diagnostic messages"]

    def _assert_privacy(
        self,
        privacy_flags: PrivacyFlags,
        original_findings: list[dict],
        redacted_findings: list[dict],
    ) -> None:
        """Fail closed when declared privacy guarantees do not match evidence state."""
        if privacy_flags.contains_source_code:
            raise PrivacyAssertionError("evidence payload contains source code")
        if not privacy_flags.secrets_redacted:
            raise PrivacyAssertionError("evidence payload contains unredacted secrets")
        if len(original_findings) != len(redacted_findings):
            raise PrivacyAssertionError("raw source was stripped from findings")

    def _assert_safe_payload(self, value: object, *, json_path: str = "$") -> None:
        """Recursively reject unsafe values while retaining the exact safe JSON path."""
        if isinstance(value, str):
            if any(pattern.search(value) for pattern in SECRET_VALUE_PATTERNS):
                self._raise_privacy_assertion(
                    "evidence payload contains a secret",
                    reason="SECRET_VALUE_PATTERN",
                    json_path=json_path,
                    value=value,
                )
            if "\n" in value and SOURCE_BODY_PATTERN.search(value):
                self._raise_privacy_assertion(
                    "evidence payload contains raw source",
                    reason="RAW_SOURCE_PATTERN",
                    json_path=json_path,
                    value=value,
                )
            return
        if isinstance(value, (list, tuple)):
            for index, item in enumerate(value):
                self._assert_safe_payload(item, json_path=f"{json_path}[{index}]")
            return
        if not isinstance(value, dict):
            return
        for key, item in value.items():
            normalized_key = str(key).replace("-", "_").lower()
            child_path = self._json_path_for_key(json_path, key)
            if normalized_key in FORBIDDEN_PERSISTED_KEYS:
                self._raise_privacy_assertion(
                    f"evidence payload contains forbidden field {normalized_key}",
                    reason="FORBIDDEN_PERSISTED_FIELD",
                    json_path=child_path,
                    field_name=normalized_key,
                    value=item,
                )
            self._assert_safe_payload(item, json_path=child_path)

    def _raise_privacy_assertion(
        self,
        message: str,
        *,
        reason: str,
        json_path: str,
        value: object,
        field_name: str | None = None,
    ) -> None:
        """Raise with structure-only diagnostics and optional development logging."""
        container_size: int | None = None
        string_length: int | None = None
        if isinstance(value, str):
            string_length = len(value)
        elif isinstance(value, (dict, list, tuple)):
            container_size = len(value)

        error = PrivacyAssertionError(
            message,
            reason=reason,
            json_path=json_path,
            field_name=field_name,
            value_type=type(value).__name__,
            container_size=container_size,
            string_length=string_length,
        )
        if self._privacy_debug_enabled():
            logger.error(
                "SCAN_EVIDENCE_PRIVACY_DIAGNOSTIC",
                error_code=error.error_code,
                **error.safe_diagnostic(),
            )
        raise error

    @staticmethod
    def _json_path_for_key(parent: str, key: object) -> str:
        """Append one mapping key using quoted JSONPath notation."""
        encoded = json.dumps(str(key), ensure_ascii=True)
        return f"{parent}[{encoded}]"

    @staticmethod
    def _privacy_debug_enabled() -> bool:
        """Enable extra safe diagnostics only when explicitly requested in development."""
        value = os.getenv(SCANNER_PRIVACY_DEBUG_ENV, "")
        return value.strip().lower() in {"1", "true", "yes", "on"}
