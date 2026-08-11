from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    OUTCOME_TOOL_TIMEOUT,
    ToolExecutionResult,
)


DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_SYFT_BINARY = "syft"
DEFAULT_PINNED_VERSION = "1."
DEFAULT_TOOL_NAME = "syft"


@dataclass(frozen=True)
class SBOMEntry:
    name: str
    version: str
    ecosystem: str
    location: str
    purl: str
    license: str | None


@dataclass(frozen=True)
class SyftRunResult:
    entries: list[SBOMEntry]
    execution: ToolExecutionResult


class SyftTool:
    def __init__(
        self,
        syft_binary: str = DEFAULT_SYFT_BINARY,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        config_path: str | Path | None = None,
        pinned_version: str = DEFAULT_PINNED_VERSION,
    ) -> None:
        self._syft_binary = syft_binary
        self._timeout_seconds = timeout_seconds
        self._config_path = Path(config_path) if config_path is not None else Path(__file__).resolve().parent.parent / "syft-config.yaml"
        self._pinned_version = pinned_version

    def run(self, workspace_path: str | Path) -> SyftRunResult:
        workspace = Path(workspace_path)
        try:
            config_hash = self._sha256_file(self._config_path)
        except OSError as error:
            return SyftRunResult(
                entries=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version="unknown",
                    outcome=OUTCOME_TOOL_FAILURE,
                    config_hash="sha256:unavailable",
                    messages=[f"syft config unavailable: {error}"],
                ),
            )

        version_result = self._read_version(config_hash)
        if version_result.outcome != OUTCOME_SUCCESS:
            return SyftRunResult(entries=[], execution=version_result)
        command = [
            self._syft_binary,
            f"dir:{workspace}",
            "-o",
            "json",
            "-c",
            str(self._config_path),
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
            return SyftRunResult(
                entries=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_TOOL_TIMEOUT,
                    config_hash=config_hash,
                    messages=[f"syft timed out after {self._timeout_seconds}s"],
                ),
            )
        except OSError as error:
            return SyftRunResult(
                entries=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_TOOL_FAILURE,
                    config_hash=config_hash,
                    messages=[f"syft execution failed: {error}"],
                ),
            )

        if completed.returncode != 0:
            return SyftRunResult(
                entries=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_TOOL_FAILURE,
                    config_hash=config_hash,
                    messages=[completed.stderr.strip() or "syft returned non-zero exit code"],
                ),
            )

        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return SyftRunResult(
                entries=[],
                execution=ToolExecutionResult(
                    tool_name=DEFAULT_TOOL_NAME,
                    tool_version=version_result.tool_version,
                    outcome=OUTCOME_TOOL_FAILURE,
                    config_hash=config_hash,
                    messages=["syft produced non-JSON output"],
                ),
            )

        entries = self._parse_entries(payload, workspace)
        return SyftRunResult(
            entries=entries,
            execution=ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version=version_result.tool_version,
                outcome=OUTCOME_SUCCESS,
                config_hash=config_hash,
                messages=[],
            ),
        )

    def _read_version(self, config_hash: str) -> ToolExecutionResult:
        try:
            completed = subprocess.run(
                [self._syft_binary, "--version"],
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
                messages=["syft --version timed out"],
            )
        except OSError as error:
            return ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version="unknown",
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[f"syft not available: {error}"],
            )

        raw_version = (completed.stdout or completed.stderr).strip()
        if completed.returncode != 0 or not raw_version:
            return ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version="unknown",
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=["unable to determine syft version"],
            )

        if self._pinned_version and self._pinned_version not in raw_version:
            return ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version=raw_version,
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                messages=[
                    f"syft version mismatch: expected {self._pinned_version}, got {raw_version}"
                ],
            )

        return ToolExecutionResult(
            tool_name=DEFAULT_TOOL_NAME,
            tool_version=raw_version,
            outcome=OUTCOME_SUCCESS,
            config_hash=config_hash,
            messages=[],
        )

    def _parse_entries(self, payload: dict, workspace: Path) -> list[SBOMEntry]:
        artifacts = payload.get("artifacts", [])
        entries: list[SBOMEntry] = []

        for artifact in artifacts:
            if not isinstance(artifact, dict):
                continue
            location = self._normalize_location(workspace, self._extract_location(artifact))
            entries.append(
                SBOMEntry(
                    name=str(artifact.get("name", "")),
                    version=str(artifact.get("version", "")),
                    ecosystem=self._extract_ecosystem(str(artifact.get("purl", ""))),
                    location=location,
                    purl=str(artifact.get("purl", "")),
                    license=self._extract_license(artifact),
                )
            )

        return entries

    def _extract_location(self, artifact: dict) -> str:
        locations = artifact.get("locations")
        if not isinstance(locations, list) or not locations:
            return ""

        first = locations[0]
        if isinstance(first, dict):
            return str(first.get("path", ""))

        return ""

    def _extract_ecosystem(self, purl: str) -> str:
        if not purl.startswith("pkg:"):
            return "unknown"

        tail = purl[4:]
        if not tail:
            return "unknown"

        ecosystem = tail.split("/", 1)[0]
        return ecosystem or "unknown"

    def _extract_license(self, artifact: dict) -> str | None:
        licenses = artifact.get("licenses")
        if not isinstance(licenses, list) or not licenses:
            return None

        first = licenses[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            for key in ("value", "spdxExpression"):
                value = first.get(key)
                if isinstance(value, str) and value.strip():
                    return value
        return None

    def _normalize_location(self, workspace: Path, raw_location: str) -> str:
        if not raw_location:
            return ""

        workspace_resolved = workspace.resolve(strict=False)
        candidate = Path(raw_location)

        if not candidate.is_absolute():
            cleaned = raw_location.replace("\\", "/")
            if cleaned.startswith("./"):
                cleaned = cleaned[2:]
            return cleaned

        try:
            relative = candidate.resolve(strict=False).relative_to(workspace_resolved)
            return relative.as_posix()
        except ValueError:
            # Force location to remain relative and avoid leaking host paths.
            _, tail = os.path.splitdrive(raw_location)
            return Path(tail).name

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(64 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return f"sha256:{digest.hexdigest()}"
