from __future__ import annotations

from dataclasses import dataclass, field

from .signal_fuser import FindingCandidate


@dataclass(frozen=True)
class MergedFindingCandidate:
    finding_type: str
    file_path: str
    line_number: int | None
    rule_ids: list[str]
    source_tools: list[str]
    analysis_level: str
    library_group: str | None = None
    kwarg_names: list[str] = field(default_factory=list)
    has_dynamic_call: bool = False
    coverage_note: str | None = None
    function_names: list[str] = field(default_factory=list)
    has_output_assignment: bool = False
    output_is_used: bool = False


class FindingDeduplicator:
    def deduplicate(
        self, candidates: list[FindingCandidate]
    ) -> list[MergedFindingCandidate]:
        groups: dict[tuple[str, str, int | None, str], list[FindingCandidate]] = {}
        for candidate in candidates:
            groups.setdefault(self._key(candidate), []).append(candidate)

        merged = [self._merge(group) for group in groups.values()]
        return sorted(
            merged,
            key=lambda item: (
                item.file_path,
                item.line_number if item.line_number is not None else -1,
                item.finding_type,
                ",".join(item.rule_ids),
            ),
        )

    def _key(self, candidate: FindingCandidate) -> tuple[str, str, int | None, str]:
        if candidate.finding_type in {
            "SCAN_COVERAGE_LIMITATION",
            "UNSUPPORTED_DYNAMIC_FLOW",
        }:
            # Limitation findings describe scanner boundaries, so keep them
            # distinct per tool/rule instead of blending them into business signals.
            return (
                candidate.file_path,
                candidate.finding_type,
                candidate.line_number,
                candidate.rule_id,
            )
        return (
            candidate.file_path,
            candidate.finding_type,
            # A 3-line bucket catches equivalent Semgrep and AST/CST findings
            # that report nearby but not identical line numbers.
            self._line_bucket(candidate.line_number),
            "",
        )

    def _line_bucket(self, line_number: int | None) -> int | None:
        if line_number is None:
            return None
        return (max(1, line_number) // 3) * 3

    def _merge(self, candidates: list[FindingCandidate]) -> MergedFindingCandidate:
        first = candidates[0]
        return MergedFindingCandidate(
            finding_type=first.finding_type,
            file_path=first.file_path,
            line_number=self._first_line(candidates),
            rule_ids=sorted({candidate.rule_id for candidate in candidates}),
            source_tools=sorted({candidate.source_tool for candidate in candidates}),
            analysis_level=self._max_analysis_level(candidates),
            library_group=self._first_library_group(candidates),
            kwarg_names=self._ordered_unique(
                kwarg
                for candidate in candidates
                for kwarg in candidate.kwarg_names
            ),
            has_dynamic_call=any(candidate.has_dynamic_call for candidate in candidates),
            coverage_note=self._coverage_note(candidates),
            function_names=sorted(
                {
                    function_name
                    for candidate in candidates
                    for function_name in candidate.function_names
                }
            ),
            has_output_assignment=any(candidate.has_output_assignment for candidate in candidates),
            output_is_used=any(candidate.output_is_used for candidate in candidates),
        )

    def _ordered_unique(self, values) -> list[str]:
        return list(dict.fromkeys(value for value in values if value))

    def _first_line(self, candidates: list[FindingCandidate]) -> int | None:
        lines = sorted(
            candidate.line_number
            for candidate in candidates
            if candidate.line_number is not None
        )
        return lines[0] if lines else None

    def _max_analysis_level(self, candidates: list[FindingCandidate]) -> str:
        order = {"L0": 0, "L1": 1, "L2": 2, "L3": 3, "L4": 4}
        return max(
            (candidate.analysis_level for candidate in candidates),
            key=lambda level: order.get(level, 0),
        )

    def _first_library_group(self, candidates: list[FindingCandidate]) -> str | None:
        return next(
            (
                candidate.library_group
                for candidate in candidates
                if candidate.library_group
            ),
            None,
        )

    def _coverage_note(self, candidates: list[FindingCandidate]) -> str | None:
        notes = [
            candidate.coverage_note
            for candidate in candidates
            if candidate.coverage_note
        ]
        return "; ".join(dict.fromkeys(notes)) if notes else None
