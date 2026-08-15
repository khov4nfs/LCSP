from __future__ import annotations

from dataclasses import dataclass

from .tools.tool_base import ToolExecutionResult


@dataclass(frozen=True)
class ToolProvenance:
    """Persistable provenance summary for one scanner-tool execution."""

    tool_name: str
    tool_version: str
    config_hash: str
    outcome: str


class ToolRegistry:
    """Collect tool execution metadata for scan logging and evidence provenance."""

    def __init__(self) -> None:
        """Initialize an empty execution registry for one scan."""
        self._results: list[ToolExecutionResult] = []

    def register(self, result: ToolExecutionResult) -> None:
        """Record a tool execution in completion order."""
        self._results.append(result)

    def all(self) -> list[ToolProvenance]:
        """Return persistence-safe provenance without tool diagnostic payloads."""
        return [
            ToolProvenance(
                tool_name=result.tool_name,
                tool_version=result.tool_version,
                config_hash=result.config_hash,
                outcome=result.outcome,
            )
            for result in self._results
        ]
