from __future__ import annotations

from dataclasses import dataclass

from .toolchain_execution import RepositoryLanguageProfile
from .toolchain_execution import TOOL_DISPOSITIONS, ToolExecutionPlanEntry
from .tools.tool_base import (
    NOT_EXECUTED_HASH,
    NOT_RUN_VERSION,
    OUTCOME_SKIPPED_UNSUPPORTED,
    OUTCOME_SUCCESS,
    ToolExecutionResult,
)


@dataclass(frozen=True)
class ToolProvenance:
    """Persistable provenance summary for one scanner-tool execution."""

    tool_name: str
    tool_version: str
    config_hash: str
    ruleset_hash: str
    started_at: str
    ended_at: str
    language_profile: RepositoryLanguageProfile
    coverage_limitations: tuple[str, ...]
    outcome: str
    disposition: str
    evidence_eligible: bool


class ToolRegistry:
    """Collect tool execution metadata for scan logging and evidence provenance."""

    def __init__(self) -> None:
        self._records: list[ToolProvenance] = []

    def register(
        self,
        result: ToolExecutionResult,
        *,
        ruleset_hash: str,
        started_at: str,
        ended_at: str,
        language_profile: RepositoryLanguageProfile,
        coverage_limitations: list[str],
        tool_name: str | None = None,
    ) -> None:
        self._records.append(
            ToolProvenance(
                tool_name=tool_name or result.tool_name,
                tool_version=result.tool_version,
                config_hash=result.config_hash,
                ruleset_hash=ruleset_hash,
                started_at=started_at,
                ended_at=ended_at,
                language_profile=language_profile,
                coverage_limitations=tuple(coverage_limitations),
                outcome=result.outcome,
                disposition=TOOL_DISPOSITIONS["run"],
                evidence_eligible=result.outcome == OUTCOME_SUCCESS,
            )
        )

    def register_skipped(
        self,
        entry: ToolExecutionPlanEntry,
        *,
        language_profile: RepositoryLanguageProfile,
        recorded_at: str,
    ) -> ToolExecutionResult:
        limitation = f"{entry.tool_name}: {entry.reason or 'unsupported'}"
        execution = ToolExecutionResult(
            tool_name=entry.tool_name,
            tool_version=NOT_RUN_VERSION,
            outcome=OUTCOME_SKIPPED_UNSUPPORTED,
            config_hash=NOT_EXECUTED_HASH,
            messages=[limitation],
        )
        self._records.append(
            ToolProvenance(
                tool_name=entry.tool_name,
                tool_version=execution.tool_version,
                config_hash=execution.config_hash,
                ruleset_hash=NOT_EXECUTED_HASH,
                started_at=recorded_at,
                ended_at=recorded_at,
                language_profile=language_profile,
                coverage_limitations=(limitation,),
                outcome=execution.outcome,
                disposition=entry.disposition,
                evidence_eligible=False,
            )
        )
        return execution

    def all(self) -> list[ToolProvenance]:
        return list(self._records)
