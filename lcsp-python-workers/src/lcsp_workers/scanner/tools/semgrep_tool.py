from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    OUTCOME_TOOL_TIMEOUT,
    ToolExecutionResult,
)


DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_SEMGREP_BINARY = "semgrep"
DEFAULT_PINNED_VERSION = "1."
AI_USAGE_TOOL_NAME = "semgrep_ai_usage"
SECRET_DETECT_TOOL_NAME = "semgrep_secret_detect"
INFO_SEVERITY = "INFO"
WARNING_SEVERITY = "WARNING"
DEFAULT_FINDING_MESSAGE = "AI usage pattern detected"
DEFAULT_FINDING_TYPE = "AI_PROVIDER_USAGE"
DEFAULT_BASE_CONFIDENCE = 0.0
RULE_SIGNAL_TYPES = {
    "lcsp.openai-client": "provider_integration",
    "lcsp.anthropic-client": "provider_integration",
    "lcsp.langchain-import": "framework_usage",
    "lcsp.autogen-import": "agent_pattern",
    "lcsp.model-call": "model_call",
    "lcsp.embeddings-call": "model_call",
    "lcsp.llm-api-key-ref": "provider_integration",
}
FINDING_TYPE_SIGNAL_TYPES = {
    "AI_PROVIDER_USAGE": "provider_integration",
    "AI_FRAMEWORK_USAGE": "framework_usage",
    "AI_MODEL_INVOCATION": "model_call",
    "AI_DECISION_FLOW_SIGNAL": "agent_pattern",
    "SYSTEM_PROMPT_DETECTED": "prompt_signal",
    "DYNAMIC_SYSTEM_PROMPT_REFERENCE": "prompt_signal",
    "RAG_USAGE_SIGNAL": "rag_signal",
    "MODEL_OUTPUT_PARSER_SIGNAL": "output_parser_signal",
}


@dataclass(frozen=True)
class SemgrepFinding:
    rule_id: str
    signal_type: str
    file_path: str
    line_start: int
    line_end: int
    message: str
    severity: str
    finding_type: str = DEFAULT_FINDING_TYPE
    base_confidence: float = DEFAULT_BASE_CONFIDENCE
    library_group: str | None = None


@dataclass(frozen=True)
class SemgrepRunResult:
    findings: list[SemgrepFinding]
    executions: list[ToolExecutionResult]
    redaction_applied: bool


class SemgrepTool:
    def __init__(
        self,
        semgrep_binary: str = DEFAULT_SEMGREP_BINARY,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        ai_ruleset_path: str | Path | None = None,
        secret_ruleset_path: str | Path | None = None,
        pinned_version: str = DEFAULT_PINNED_VERSION,
    ) -> None:
        base_dir = Path(__file__).resolve().parent.parent / "rulesets"
        self._semgrep_binary = semgrep_binary
        self._timeout_seconds = timeout_seconds
        self._ai_ruleset_path = (
            Path(ai_ruleset_path)
            if ai_ruleset_path is not None
            else base_dir / "lcsp-ai-usage.yaml"
        )
        self._secret_ruleset_path = (
            Path(secret_ruleset_path)
            if secret_ruleset_path is not None
            else base_dir / "lcsp-secret-detect.yaml"
        )
        self._pinned_version = pinned_version

    def run(
        self,
        workspace_path: str | Path,
        include_files: list[str] | None = None,
    ) -> SemgrepRunResult:
        workspace = Path(workspace_path)
        targets = self._resolve_targets(workspace, include_files)
        try:
            ai_ruleset_hash = self._sha256_file(self._ai_ruleset_path)
            secret_ruleset_hash = self._sha256_file(self._secret_ruleset_path)
        except OSError as error:
            message = f"semgrep ruleset unavailable: {error}"
            return SemgrepRunResult(
                findings=[],
                executions=[
                    ToolExecutionResult(
                        tool_name=AI_USAGE_TOOL_NAME,
                        tool_version="unknown",
                        outcome=OUTCOME_TOOL_FAILURE,
                        config_hash="sha256:unavailable",
                        messages=[message],
                    ),
                    ToolExecutionResult(
                        tool_name=SECRET_DETECT_TOOL_NAME,
                        tool_version="unknown",
                        outcome=OUTCOME_TOOL_FAILURE,
                        config_hash="sha256:unavailable",
                        messages=[message],
                    ),
                ],
                redaction_applied=False,
            )

        version_result = self._read_version(ai_ruleset_hash)
        if version_result.outcome != OUTCOME_SUCCESS:
            return SemgrepRunResult(
                findings=[],
                executions=[
                    self._clone_execution(version_result, AI_USAGE_TOOL_NAME, ai_ruleset_hash),
                    self._clone_execution(version_result, SECRET_DETECT_TOOL_NAME, secret_ruleset_hash),
                ],
                redaction_applied=False,
            )

        ai_payload, ai_execution = self._run_ruleset(
            workspace=workspace,
            ruleset_path=self._ai_ruleset_path,
            config_hash=ai_ruleset_hash,
            tool_name=AI_USAGE_TOOL_NAME,
            tool_version=version_result.tool_version,
            targets=targets,
        )
        secret_payload, secret_execution = self._run_ruleset(
            workspace=workspace,
            ruleset_path=self._secret_ruleset_path,
            config_hash=secret_ruleset_hash,
            tool_name=SECRET_DETECT_TOOL_NAME,
            tool_version=version_result.tool_version,
            targets=targets,
        )

        findings = []
        if ai_payload is not None and ai_execution.outcome == OUTCOME_SUCCESS:
            findings = self._parse_findings(ai_payload, workspace)

        secret_matches = self._count_results(secret_payload)
        sanitized_findings = self._sanitize_findings(findings)

        return SemgrepRunResult(
            findings=sanitized_findings,
            executions=[ai_execution, secret_execution],
            redaction_applied=secret_matches > 0,
        )

    def _read_version(self, config_hash: str) -> ToolExecutionResult:
        try:
            completed = subprocess.run(
                [self._semgrep_binary, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return ToolExecutionResult(
                tool_name=AI_USAGE_TOOL_NAME,
                tool_version="unknown",
                outcome=OUTCOME_TOOL_TIMEOUT,
                config_hash=config_hash,
                messages=["semgrep --version timed out"],
            )
        except OSError as error:
            return ToolExecutionResult(
                tool_name=AI_USAGE_TOOL_NAME,
                tool_version="unknown",
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[f"semgrep not available: {error}"],
            )

        raw_version = (completed.stdout or completed.stderr).strip()
        if completed.returncode != 0 or not raw_version:
            return ToolExecutionResult(
                tool_name=AI_USAGE_TOOL_NAME,
                tool_version="unknown",
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=["unable to determine semgrep version"],
            )

        if self._pinned_version and self._pinned_version not in raw_version:
            return ToolExecutionResult(
                tool_name=AI_USAGE_TOOL_NAME,
                tool_version=raw_version,
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[
                    f"semgrep version mismatch: expected {self._pinned_version}, got {raw_version}"
                ],
            )

        return ToolExecutionResult(
            tool_name=AI_USAGE_TOOL_NAME,
            tool_version=raw_version,
            outcome=OUTCOME_SUCCESS,
            config_hash=config_hash,
            messages=[],
        )

    def _run_ruleset(
        self,
        *,
        workspace: Path,
        ruleset_path: Path,
        config_hash: str,
        tool_name: str,
        tool_version: str,
        targets: list[Path] | None = None,
    ) -> tuple[dict | None, ToolExecutionResult]:
        command = [
            self._semgrep_binary,
            "--config",
            str(ruleset_path),
            "--json",
            "--no-git-ignore",
            *(str(target) for target in (targets if targets is not None else [workspace])),
        ]

        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self._timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return None, ToolExecutionResult(
                tool_name=tool_name,
                tool_version=tool_version,
                outcome=OUTCOME_TOOL_TIMEOUT,
                config_hash=config_hash,
                messages=[f"{tool_name} timed out after {self._timeout_seconds}s"],
            )
        except OSError as error:
            return None, ToolExecutionResult(
                tool_name=tool_name,
                tool_version=tool_version,
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[f"{tool_name} execution failed: {error}"],
            )

        if completed.returncode != 0:
            return None, ToolExecutionResult(
                tool_name=tool_name,
                tool_version=tool_version,
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[completed.stderr.strip() or f"{tool_name} returned non-zero exit code"],
            )

        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return None, ToolExecutionResult(
                tool_name=tool_name,
                tool_version=tool_version,
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[f"{tool_name} produced non-JSON output"],
            )

        return payload, ToolExecutionResult(
            tool_name=tool_name,
            tool_version=tool_version,
            outcome=OUTCOME_SUCCESS,
            config_hash=config_hash,
            messages=[],
        )

    @staticmethod
    def _resolve_targets(workspace: Path, include_files: list[str] | None) -> list[Path] | None:
        if include_files is None:
            return None
        resolved_workspace = workspace.resolve()
        targets: list[Path] = []
        for file_path in sorted(set(include_files)):
            candidate = (workspace / file_path).resolve()
            if (
                not candidate.is_relative_to(resolved_workspace)
                or not candidate.is_file()
            ):
                raise ValueError("semgrep target is outside the materialized workspace")
            targets.append(candidate)
        return targets

    def _parse_findings(self, payload: dict, workspace: Path) -> list[SemgrepFinding]:
        findings: list[SemgrepFinding] = []
        for result in payload.get("results", []):
            if not isinstance(result, dict):
                continue

            rule_id = str(result.get("check_id", "")).strip()
            if not rule_id:
                continue

            start = result.get("start") if isinstance(result.get("start"), dict) else {}
            end = result.get("end") if isinstance(result.get("end"), dict) else {}
            extra = result.get("extra") if isinstance(result.get("extra"), dict) else {}
            metadata = extra.get("metadata") if isinstance(extra.get("metadata"), dict) else {}
            finding_type = self._read_finding_type(metadata)

            # Store only rule metadata and positional facts. Semgrep source
            # snippets live in extra.lines/metavars and are intentionally ignored.
            finding = SemgrepFinding(
                rule_id=rule_id,
                signal_type=self._signal_type(rule_id, finding_type),
                file_path=self._normalize_path(workspace, str(result.get("path", ""))),
                line_start=self._read_line_number(start.get("line")),
                line_end=self._read_line_number(end.get("line")),
                message=self._sanitize_message(str(extra.get("message", DEFAULT_FINDING_MESSAGE))),
                severity=self._normalize_severity(str(extra.get("severity", INFO_SEVERITY))),
                finding_type=finding_type,
                base_confidence=self._read_base_confidence(metadata),
                library_group=self._read_library_group(metadata),
            )
            findings.append(finding)

        return findings

    def _sanitize_findings(self, findings: list[SemgrepFinding]) -> list[SemgrepFinding]:
        sanitized: list[SemgrepFinding] = []
        for finding in findings:
            sanitized.append(
                SemgrepFinding(
                    rule_id=finding.rule_id,
                    signal_type=finding.signal_type,
                    file_path=finding.file_path,
                    line_start=finding.line_start,
                    line_end=finding.line_end,
                    message=self._sanitize_message(finding.message),
                    severity=self._normalize_severity(finding.severity),
                    finding_type=self._read_finding_type(
                        {"finding_type": finding.finding_type}
                    ),
                    base_confidence=self._clamp_confidence(finding.base_confidence),
                    library_group=finding.library_group,
                )
            )
        return sanitized

    def _sanitize_message(self, message: str) -> str:
        cleaned = message.replace("\r", " ").replace("\n", " ").strip()
        if not cleaned:
            return DEFAULT_FINDING_MESSAGE
        return cleaned

    def _normalize_path(self, workspace: Path, raw_path: str) -> str:
        if not raw_path:
            return ""

        candidate = Path(raw_path)
        if not candidate.is_absolute():
            cleaned = raw_path.replace("\\", "/")
            if cleaned.startswith("./"):
                cleaned = cleaned[2:]
            return cleaned

        try:
            return candidate.resolve(strict=False).relative_to(workspace.resolve(strict=False)).as_posix()
        except ValueError:
            return candidate.name

    def _normalize_severity(self, severity: str) -> str:
        upper = severity.upper()
        if upper == WARNING_SEVERITY:
            return WARNING_SEVERITY
        return INFO_SEVERITY

    def _read_line_number(self, value: object) -> int:
        if isinstance(value, int) and value > 0:
            return value
        return 1

    def _signal_type(self, rule_id: str, finding_type: str) -> str:
        if rule_id in RULE_SIGNAL_TYPES:
            return RULE_SIGNAL_TYPES[rule_id]
        return FINDING_TYPE_SIGNAL_TYPES.get(finding_type, "provider_integration")

    def _read_finding_type(self, metadata: dict) -> str:
        value = metadata.get("finding_type")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return DEFAULT_FINDING_TYPE

    def _read_base_confidence(self, metadata: dict) -> float:
        return self._clamp_confidence(metadata.get("base_confidence", DEFAULT_BASE_CONFIDENCE))

    def _read_library_group(self, metadata: dict) -> str | None:
        value = metadata.get("library_group")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    def _clamp_confidence(self, value: object) -> float:
        if not isinstance(value, (int, float)):
            return DEFAULT_BASE_CONFIDENCE
        return round(min(1.0, max(0.0, float(value))), 2)

    def _count_results(self, payload: dict | None) -> int:
        if payload is None:
            return 0
        results = payload.get("results", [])
        if not isinstance(results, list):
            return 0
        return len(results)

    def _clone_execution(
        self,
        execution: ToolExecutionResult,
        tool_name: str,
        config_hash: str,
    ) -> ToolExecutionResult:
        return ToolExecutionResult(
            tool_name=tool_name,
            tool_version=execution.tool_version,
            outcome=execution.outcome,
            config_hash=config_hash,
            messages=list(execution.messages),
        )

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(64 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return f"sha256:{digest.hexdigest()}"
