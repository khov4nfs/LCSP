from __future__ import annotations

from .language_types import (
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_PYTHON,
    LANGUAGE_TYPESCRIPT,
    SUPPORT_BASIC,
    SUPPORT_FULL,
    SUPPORT_MANIFEST_ONLY,
    AnalyzerDispatch,
    LanguageClassification,
)


DEFAULT_MAX_PYTHON_FILES = 500
DEFAULT_MAX_TS_JS_FILES = 500


class AnalyzerRouter:
    """Route classified repository files to supported analyzers with bounded work."""

    def __init__(
        self,
        *,
        max_python_files: int = DEFAULT_MAX_PYTHON_FILES,
        max_ts_js_files: int = DEFAULT_MAX_TS_JS_FILES,
    ) -> None:
        """Configure per-language full-analysis limits.

        Args:
            max_python_files: Maximum Python files sent to the full Python analyzer.
            max_ts_js_files: Maximum TypeScript/JavaScript files sent to the bridge.
        """
        self._max_python_files = max_python_files
        self._max_ts_js_files = max_ts_js_files

    def route(self, classifications: list[LanguageClassification]) -> AnalyzerDispatch:
        """Build an analyzer dispatch plan and preserve explicit coverage limitations.

        Files with full support are routed to language-specific analyzers. Basic or
        manifest-only files remain visible to lightweight analysis, while unsupported
        and over-limit files are recorded as skipped rather than silently discarded.

        Args:
            classifications: Per-file language/support classifications.

        Returns:
            A bounded analyzer dispatch containing routed files and limitation records.
        """
        python_files: list[str] = []
        ts_js_files: list[str] = []
        basic_files: list[str] = []
        skipped_files: list[str] = []
        coverage_limitations: list[dict[str, str]] = []

        for classification in classifications:
            if classification.support_level == SUPPORT_FULL:
                if classification.language == LANGUAGE_PYTHON:
                    python_files.append(classification.file_path)
                    continue
                if classification.language in {LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT}:
                    ts_js_files.append(classification.file_path)
                    continue
                basic_files.append(classification.file_path)
                continue

            if classification.support_level in {SUPPORT_BASIC, SUPPORT_MANIFEST_ONLY}:
                basic_files.append(classification.file_path)
            else:
                skipped_files.append(classification.file_path)

            if classification.coverage_limitation:
                coverage_limitations.append(
                    {
                        "file_path": classification.file_path,
                        "reason": classification.skip_reason
                        or f"support_level={classification.support_level}",
                    }
                )

        python_files, overflow_python_files = self._truncate(
            python_files,
            self._max_python_files,
        )
        skipped_files.extend(overflow_python_files)
        for file_path in overflow_python_files:
            coverage_limitations.append(
                {
                    "file_path": file_path,
                    "reason": f"python_file_limit_exceeded: limit={self._max_python_files}",
                }
            )

        ts_js_files, overflow_ts_js_files = self._truncate(
            ts_js_files,
            self._max_ts_js_files,
        )
        skipped_files.extend(overflow_ts_js_files)
        for file_path in overflow_ts_js_files:
            coverage_limitations.append(
                {
                    "file_path": file_path,
                    "reason": f"ts_js_file_limit_exceeded: limit={self._max_ts_js_files}",
                }
            )

        return AnalyzerDispatch(
            python_files=python_files,
            ts_js_files=ts_js_files,
            basic_files=basic_files,
            skipped_files=skipped_files,
            coverage_limitations=coverage_limitations,
        )

    def _truncate(self, items: list[str], limit: int) -> tuple[list[str], list[str]]:
        """Split a deterministic file list into analyzable and overflow portions."""
        if len(items) <= limit:
            return items, []
        trimmed = items[:limit]
        return trimmed, items[limit:]
