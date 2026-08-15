from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Mapping

from .inventory.language_types import (
    LANGUAGE_CSHARP,
    LANGUAGE_GO,
    LANGUAGE_JAVA,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_KOTLIN,
    LANGUAGE_PYTHON,
    LANGUAGE_RUST,
    LANGUAGE_TYPESCRIPT,
    SUPPORT_SKIP,
    LanguageClassification,
)

APPROVED_TOOL_NAMES: Final[Mapping[str, str]] = MappingProxyType({
    "syft": "syft",
    "knip": "knip",
    "deptry": "deptry",
    "python_ast": "python_ast",
    "python_libcst": "python_libcst",
    "ts_morph": "ts_morph",
    "tree_sitter": "tree_sitter_custom_parser",
    "semgrep": "semgrep",
})

TOOL_DISPOSITIONS: Final[Mapping[str, str]] = MappingProxyType({
    "run": "RUN",
    "skip": "SKIP",
})

_PYTHON_LANGUAGES = {LANGUAGE_PYTHON}
_TS_JS_LANGUAGES = {LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT}
_STRUCTURAL_LANGUAGES = {
    LANGUAGE_PYTHON,
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_JAVA,
    LANGUAGE_KOTLIN,
    LANGUAGE_GO,
    LANGUAGE_CSHARP,
    LANGUAGE_RUST,
}
_SEMGREP_LANGUAGES = {
    LANGUAGE_PYTHON,
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_JAVASCRIPT,
}


@dataclass(frozen=True)
class RepositoryLanguageProfile:
    languages: tuple[str, ...]
    file_counts: dict[str, int]


@dataclass(frozen=True)
class ToolExecutionPlanEntry:
    tool_name: str
    disposition: str
    applicable_languages: tuple[str, ...]
    reason: str | None
    coverage_limitation: bool


@dataclass(frozen=True)
class ToolchainExecutionPlan:
    language_profile: RepositoryLanguageProfile
    entries: tuple[ToolExecutionPlanEntry, ...]

    def should_run(self, tool_name: str) -> bool:
        return any(
            entry.tool_name == tool_name
            and entry.disposition == TOOL_DISPOSITIONS["run"]
            for entry in self.entries
        )

    def entry_for(self, tool_name: str) -> ToolExecutionPlanEntry:
        for entry in self.entries:
            if entry.tool_name == tool_name:
                return entry
        raise KeyError(f"tool is not approved: {tool_name}")

    def coverage_limitations(self) -> list[dict[str, str]]:
        return [
            {
                "file_path": f"<tool:{entry.tool_name}>",
                "reason": entry.reason or "unsupported_for_language_profile",
            }
            for entry in self.entries
            if entry.coverage_limitation
        ]


class ToolchainExecutionPlanner:
    def build(
        self,
        classifications: list[LanguageClassification],
        targeted: bool = False,
    ) -> ToolchainExecutionPlan:
        language_counts = Counter(
            classification.language
            for classification in classifications
            if classification.support_level != SUPPORT_SKIP
        )
        detected_languages = set(language_counts)
        profile = RepositoryLanguageProfile(
            languages=tuple(sorted(detected_languages)),
            file_counts=dict(sorted(language_counts.items())),
        )

        applicability = (
            # Syft (SBOM) runs on full scans only; targeted re-analysis is
            # file-scoped and does not re-inventory the dependency graph.
            (APPROVED_TOOL_NAMES["syft"], detected_languages, not targeted),
            (
                APPROVED_TOOL_NAMES["knip"],
                detected_languages & _TS_JS_LANGUAGES,
                bool(detected_languages & _TS_JS_LANGUAGES),
            ),
            (
                APPROVED_TOOL_NAMES["deptry"],
                detected_languages & _PYTHON_LANGUAGES,
                bool(detected_languages & _PYTHON_LANGUAGES),
            ),
            (
                APPROVED_TOOL_NAMES["python_ast"],
                detected_languages & _PYTHON_LANGUAGES,
                bool(detected_languages & _PYTHON_LANGUAGES),
            ),
            (
                APPROVED_TOOL_NAMES["python_libcst"],
                detected_languages & _PYTHON_LANGUAGES,
                bool(detected_languages & _PYTHON_LANGUAGES),
            ),
            (
                APPROVED_TOOL_NAMES["ts_morph"],
                detected_languages & _TS_JS_LANGUAGES,
                bool(detected_languages & _TS_JS_LANGUAGES),
            ),
            (
                APPROVED_TOOL_NAMES["tree_sitter"],
                detected_languages & _STRUCTURAL_LANGUAGES,
                bool(detected_languages & _STRUCTURAL_LANGUAGES),
            ),
            (
                APPROVED_TOOL_NAMES["semgrep"],
                detected_languages & _SEMGREP_LANGUAGES,
                bool(detected_languages & _SEMGREP_LANGUAGES),
            ),
        )
        entries = tuple(
            ToolExecutionPlanEntry(
                tool_name=tool_name,
                disposition=(
                    TOOL_DISPOSITIONS["run"]
                    if should_run
                    else TOOL_DISPOSITIONS["skip"]
                ),
                applicable_languages=tuple(sorted(applicable_languages)),
                reason=(None if should_run else "unsupported_for_language_profile"),
                coverage_limitation=not should_run,
            )
            for tool_name, applicable_languages, should_run in applicability
        )
        return ToolchainExecutionPlan(language_profile=profile, entries=entries)
