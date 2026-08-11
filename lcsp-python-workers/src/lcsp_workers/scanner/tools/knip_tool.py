from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from lcsp_workers.scanner.dependencies.dependency_fact import (
    DependencyUsageFact,
    USAGE_MISSING,
    USAGE_UNUSED,
    USAGE_USED,
    is_ai_package,
)

from .tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    OUTCOME_TOOL_TIMEOUT,
    ToolExecutionResult,
)


DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_PINNED_VERSION = "6."
DEFAULT_TOOL_NAME = "knip"


@dataclass(frozen=True)
class KnipRunResult:
    facts: list[DependencyUsageFact]
    execution: ToolExecutionResult


class KnipTool:
    def __init__(
        self,
        npx_binary: str = "npx",
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        pinned_version: str = DEFAULT_PINNED_VERSION,
    ) -> None:
        self._npx_binary = npx_binary
        self._timeout_seconds = timeout_seconds
        self._pinned_version = pinned_version

    @staticmethod
    def fact(
        *,
        package_name: str,
        usage_state: str,
        file_refs: list[str],
    ) -> DependencyUsageFact:
        return DependencyUsageFact(
            package_name=package_name,
            version=None,
            ecosystem="npm",
            usage_state=usage_state,
            source_tool=DEFAULT_TOOL_NAME,
            file_refs=file_refs,
            is_ai_relevant=is_ai_package(package_name),
        )

    def run(self, workspace_path: str | Path) -> KnipRunResult:
        workspace = Path(workspace_path)
        config_hash = self._config_hash()

        project_roots = self._find_project_roots(workspace)
        if not project_roots:
            return KnipRunResult(
                facts=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version="not-run",
                    outcome=OUTCOME_SUCCESS,
                    config_hash=config_hash,
                    messages=["knip skipped: package.json not found in workspace"],
                ),
            )

        version_result = self._read_version(config_hash)
        if version_result.outcome != OUTCOME_SUCCESS:
            return KnipRunResult(facts=[], execution=version_result)

        facts: list[DependencyUsageFact] = []
        messages: list[str] = []
        outcome = OUTCOME_SUCCESS
        for project_root in project_roots:
            result = self._run_project(project_root, version_result, config_hash)
            facts.extend(result.facts)
            messages.extend(
                f"{project_root.relative_to(workspace)}: {message}"
                for message in result.execution.messages
            )
            if result.execution.outcome != OUTCOME_SUCCESS:
                outcome = result.execution.outcome

        return KnipRunResult(
            facts=facts,
            execution=ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version=version_result.tool_version,
                outcome=outcome,
                config_hash=config_hash,
                messages=messages,
            ),
        )

    def _run_project(
        self,
        project_root: Path,
        version_result: ToolExecutionResult,
        config_hash: str,
    ) -> KnipRunResult:
        if not self._should_run(project_root):
            return KnipRunResult(
                facts=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_SUCCESS,
                    config_hash=config_hash,
                    messages=["knip skipped: no JS/TS files present"],
                ),
            )

        command = [self._npx_binary, "--no-install", "knip", "--reporter", "json"]
        try:
            completed = subprocess.run(
                command,
                cwd=project_root,
                capture_output=True,
                text=True,
                timeout=self._timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return KnipRunResult(
                facts=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_TOOL_TIMEOUT,
                    config_hash=config_hash,
                    messages=[f"knip timed out after {self._timeout_seconds}s"],
                ),
            )
        except OSError as error:
            return KnipRunResult(
                facts=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_TOOL_FAILURE,
                    config_hash=config_hash,
                    messages=[f"knip execution failed: {error}"],
                ),
            )

        if completed.returncode not in (0, 1):
            return KnipRunResult(
                facts=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_TOOL_FAILURE,
                    config_hash=config_hash,
                    messages=[completed.stderr.strip() or "knip returned non-zero exit code"],
                ),
            )

        try:
            payload = json.loads(completed.stdout or "{}")
        except json.JSONDecodeError:
            return KnipRunResult(
                facts=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_TOOL_FAILURE,
                    config_hash=config_hash,
                    messages=["knip produced non-JSON output"],
                ),
            )

        return KnipRunResult(
            facts=self._parse_facts(payload, project_root),
            execution=ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version=version_result.tool_version,
                outcome=OUTCOME_SUCCESS,
                config_hash=config_hash,
                messages=[],
            ),
        )

    def _read_version(self, config_hash: str) -> ToolExecutionResult:
        command = [self._npx_binary, "--no-install", "knip", "--version"]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version="unknown",
                outcome=OUTCOME_TOOL_TIMEOUT,
                config_hash=config_hash,
                messages=["knip --version timed out"],
            )
        except OSError as error:
            return ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version="unknown",
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[f"knip not available: {error}"],
            )

        raw_version = (completed.stdout or completed.stderr).strip()
        if completed.returncode != 0 or not raw_version:
            return ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version="unknown",
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=["unable to determine knip version"],
            )
        if self._pinned_version and self._pinned_version not in raw_version:
            return ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version=raw_version,
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[
                    f"knip version mismatch: expected {self._pinned_version}, got {raw_version}"
                ],
            )

        return ToolExecutionResult(
            tool_name=DEFAULT_TOOL_NAME,
            tool_version=raw_version,
            outcome=OUTCOME_SUCCESS,
            config_hash=config_hash,
            messages=[],
        )

    def _parse_facts(self, payload: dict[str, Any], workspace: Path) -> list[DependencyUsageFact]:
        facts: list[DependencyUsageFact] = []
        seen: set[tuple[str, str]] = set()

        for name, files in self._iter_dependency_entries(payload.get("dependencies")):
            self._append_fact(facts, seen, name, USAGE_USED, files, workspace)

        for name, files in self._iter_dependency_entries(payload.get("unusedDependencies")):
            self._append_fact(facts, seen, name, USAGE_UNUSED, files, workspace)

        for name, files in self._iter_dependency_entries(
            payload.get("unlistedDependencies")
        ):
            self._append_fact(facts, seen, name, USAGE_MISSING, files, workspace)

        return facts

    def _iter_dependency_entries(self, value: Any) -> list[tuple[str, list[str]]]:
        if isinstance(value, dict):
            entries: list[tuple[str, list[str]]] = []
            for name, details in value.items():
                entries.append((str(name), self._read_files(details)))
            return entries
        if isinstance(value, list):
            entries = []
            for item in value:
                if isinstance(item, str):
                    entries.append((item, []))
                elif isinstance(item, dict):
                    name = item.get("name") or item.get("packageName") or item.get("module")
                    if isinstance(name, str):
                        entries.append((name, self._read_files(item)))
            return entries
        return []

    def _read_files(self, details: Any) -> list[str]:
        if not isinstance(details, dict):
            return []
        files = details.get("files") or details.get("fileRefs") or details.get("file")
        if isinstance(files, str):
            return [files]
        if isinstance(files, list):
            return [item for item in files if isinstance(item, str)]
        return []

    def _append_fact(
        self,
        facts: list[DependencyUsageFact],
        seen: set[tuple[str, str]],
        package_name: str,
        usage_state: str,
        file_refs: list[str],
        workspace: Path,
    ) -> None:
        key = (package_name.lower(), usage_state)
        if key in seen:
            return
        seen.add(key)
        facts.append(
            self.fact(
                package_name=package_name,
                usage_state=usage_state,
                file_refs=[self._relative_path(path, workspace) for path in file_refs],
            )
        )

    def _relative_path(self, raw_path: str, workspace: Path) -> str:
        candidate = Path(raw_path)
        if not candidate.is_absolute():
            cleaned = raw_path.replace("\\", "/")
            return cleaned[2:] if cleaned.startswith("./") else cleaned
        try:
            return candidate.resolve(strict=False).relative_to(
                workspace.resolve(strict=False)
            ).as_posix()
        except ValueError:
            return candidate.name

    def _should_run(self, workspace: Path) -> bool:
        suffixes = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
        return any(
            path.is_file()
            and path.suffix in suffixes
            and "node_modules" not in path.parts
            for path in workspace.rglob("*")
        )

    def _find_project_roots(self, workspace: Path) -> list[Path]:
        manifests = sorted(
            (
                path
                for path in workspace.rglob("package.json")
                if "node_modules" not in path.parts
            ),
            key=lambda path: (len(path.relative_to(workspace).parts), str(path)),
        )
        if not manifests:
            return []
        if self._has_workspace_configuration(workspace):
            return [workspace]
        return [manifest.parent for manifest in manifests]

    def _has_workspace_configuration(self, workspace: Path) -> bool:
        if (workspace / "pnpm-workspace.yaml").is_file():
            return True
        if any(
            (workspace / name).is_file()
            for name in (
                "knip.json",
                "knip.jsonc",
                ".knip.json",
                ".knip.jsonc",
                "knip.ts",
                "knip.js",
                "knip.config.ts",
                "knip.config.js",
            )
        ):
            return True
        root_manifest = workspace / "package.json"
        if not root_manifest.is_file():
            return False
        try:
            payload = json.loads(root_manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        return bool(payload.get("workspaces")) if isinstance(payload, dict) else False

    def _config_hash(self) -> str:
        material = f"{DEFAULT_TOOL_NAME}:{self._pinned_version}:npx-no-install-json-all-manifest-roots"
        return f"sha256:{hashlib.sha256(material.encode('utf-8')).hexdigest()}"
