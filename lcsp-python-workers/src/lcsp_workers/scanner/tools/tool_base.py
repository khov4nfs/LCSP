from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, TypeVar


TResult = TypeVar("TResult")


OUTCOME_SUCCESS = "success"
OUTCOME_TOOL_FAILURE = "tool_failure"
OUTCOME_TOOL_TIMEOUT = "tool_timeout"


@dataclass(frozen=True)
class ToolExecutionResult:
    """Normalized provenance and outcome metadata for one scanner-tool execution."""

    tool_name: str
    tool_version: str
    outcome: str
    config_hash: str
    messages: list[str] = field(default_factory=list)


class ScannerTool(Protocol[TResult]):
    """Structural contract implemented by scanner tools that inspect a workspace."""

    def run(self, workspace_path: str | Path) -> TResult:
        """Execute the tool against an extracted immutable repository workspace."""
        ...
