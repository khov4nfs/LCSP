"""Evaluate scan evidence quality from tool coverage, failures, and AI signals."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


EVIDENCE_QUALITY_HIGH = "high"
EVIDENCE_QUALITY_MEDIUM = "medium"
EVIDENCE_QUALITY_LOW = "low"
EVIDENCE_QUALITY_INSUFFICIENT = "insufficient"

CRITICAL_TOOL_NAMES = ("syft", "semgrep")


@dataclass(frozen=True)
class EvidenceQualityResult:
    """Evidence quality classification and the coverage facts behind it."""

    evidence_quality: str
    coverage_notes: list[str]
    tool_coverage: dict[str, bool]


class EvidenceQualityEvaluator:
    """Derive evidence quality deterministically from scanner/tool availability."""

    def evaluate(
        self,
        *,
        tools_version: dict[str, str],
        tool_failures: list[dict[str, Any]],
        ai_usage_signals: list[dict[str, Any]],
        coverage_notes: list[str],
    ) -> EvidenceQualityResult:
        """Evaluate whether collected evidence is sufficient for downstream claims.

        Critical tool loss degrades or blocks evidence quality regardless of the
        presence of AI signals, preventing missing scanner coverage from being
        interpreted as a confident negative/positive result.

        Args:
            tools_version: Tools reported as available for the scan and versions.
            tool_failures: Structured records for tools that failed during the run.
            ai_usage_signals: AI-related signals produced by usable scanners.
            coverage_notes: Existing coverage limitations to preserve.

        Returns:
            Evidence quality, merged coverage notes, and per-tool coverage flags.
        """
        tool_coverage = self._tool_coverage(tools_version, tool_failures)
        critical_tools_failed = [
            name for name in CRITICAL_TOOL_NAMES if tool_coverage.get(name) is False
        ]

        if len(critical_tools_failed) == len(CRITICAL_TOOL_NAMES):
            return EvidenceQualityResult(
                evidence_quality=EVIDENCE_QUALITY_INSUFFICIENT,
                coverage_notes=self._coverage_notes(
                    coverage_notes,
                    critical_tools_failed,
                ),
                tool_coverage=tool_coverage,
            )

        if critical_tools_failed:
            return EvidenceQualityResult(
                evidence_quality=EVIDENCE_QUALITY_MEDIUM,
                coverage_notes=self._coverage_notes(
                    coverage_notes,
                    critical_tools_failed,
                ),
                tool_coverage=tool_coverage,
            )

        if not ai_usage_signals:
            return EvidenceQualityResult(
                evidence_quality=EVIDENCE_QUALITY_LOW,
                coverage_notes=list(coverage_notes),
                tool_coverage=tool_coverage,
            )

        return EvidenceQualityResult(
            evidence_quality=EVIDENCE_QUALITY_HIGH,
            coverage_notes=list(coverage_notes),
            tool_coverage=tool_coverage,
        )

    def _tool_coverage(
        self,
        tools_version: dict[str, str],
        tool_failures: list[dict[str, Any]],
    ) -> dict[str, bool]:
        """Build per-tool usable-coverage flags, normalizing Semgrep variants."""
        failed_tools = {
            str(record.get("tool_name", "")).strip()
            for record in tool_failures
            if record.get("tool_name")
        }
        available_tools = {str(name) for name in tools_version}

        semgrep_available = any(name.startswith("semgrep") for name in available_tools)
        semgrep_failed = any(name.startswith("semgrep") for name in failed_tools)

        coverage = {
            "syft": "syft" in available_tools and "syft" not in failed_tools,
            "semgrep": semgrep_available and not semgrep_failed,
        }

        for tool_name in sorted(available_tools - {"syft"}):
            if tool_name.startswith("semgrep"):
                continue
            coverage[tool_name] = tool_name not in failed_tools

        return coverage

    def _coverage_notes(
        self,
        existing_notes: list[str],
        failed_tools: list[str],
    ) -> list[str]:
        """Append a stable coverage limitation note for failed critical tools."""
        notes = list(existing_notes)
        if failed_tools:
            notes.append(
                "Evidence coverage is limited because "
                + ", ".join(sorted(failed_tools))
                + " did not produce usable results."
            )
        return notes
