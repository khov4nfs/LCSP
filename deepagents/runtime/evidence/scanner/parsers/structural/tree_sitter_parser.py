from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

from .structural_types import StructuralFact

_ROUTE_PATTERNS = [
    r"@(?:app|router|blueprint)\.(get|post|put|delete|patch)\s*\(",
    r"@(?:app\.route|router\.route)\s*\(",
    r"@(?:Get|Post|Put|Delete|Patch)\b(?:\s*\(|\s*$)",
    r"\b(?:app|router|server)\.(?:get|post|put|delete|patch|route)\s*\(",
    r"path\s*\(",
    r"urlpatterns\s*=",
]

_CONTROLLER_PATTERNS = [
    r"@(?:Controller|Injectable|Resolver)\b(?:\s*\(|\s*$)",
]

_CQRS_HANDLER_PATTERN = re.compile(
    r"@(?:CommandHandler|QueryHandler|EventsHandler)\s*\("
)
_ASYNC_PATTERNS = [
    re.compile(r"^\s*async\s+def\s+([A-Za-z_][A-Za-z0-9_]*)"),
    re.compile(r"^\s*async\s+function\s+([A-Za-z_][A-Za-z0-9_]*)"),
    re.compile(
        r"^\s*(?:public|private|protected)?\s*async\s+([A-Za-z_][A-Za-z0-9_]*)\s*\("
    ),
]
_FUNCTION_PATTERN = re.compile(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)")
_TS_FUNCTION_PATTERN = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)"
)
_TS_METHOD_PATTERN = re.compile(
    r"^\s*(?:public|private|protected)?\s*(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\("
)
_CLASS_PATTERN = re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)")
_TS_CLASS_PATTERN = re.compile(
    r"^\s*(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)"
)
_CELERY_PATTERN = re.compile(r"@(?:celery|app)\.task|@shared_task")
_AI_BASE_PATTERN = re.compile(r"\b(?:AgentExecutor|BaseAgent|Assistant|OpenAIAgent|LangChainAgent)\b")


class StructuralParser:
    def parse_file(self, file_path: str | Path) -> list[StructuralFact]:
        path = Path(file_path)
        if not path.exists():
            return []

        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return []

        facts: list[StructuralFact] = []
        lines = text.splitlines()
        for index, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped:
                continue

            if re.search("|".join(_ROUTE_PATTERNS), line):
                facts.append(
                    StructuralFact(
                        file_path=str(path),
                        pattern_type="route_handler",
                        name=self._extract_name(lines, index, default="route"),
                        line_number=index,
                        decorators=[self._decorator_name(stripped)],
                        graph_node_type="ROUTE",
                        parse_source="custom_regex_fallback",
                    )
                )

            if re.search("|".join(_CONTROLLER_PATTERNS), line):
                facts.append(
                    StructuralFact(
                        file_path=str(path),
                        pattern_type="controller",
                        name=self._extract_name(lines, index, default="controller"),
                        line_number=index,
                        decorators=[self._decorator_name(stripped)],
                        graph_node_type="CONTROLLER",
                        parse_source="custom_regex_fallback",
                    )
                )

            if _CELERY_PATTERN.search(line):
                facts.append(
                    StructuralFact(
                        file_path=str(path),
                        pattern_type="celery_task",
                        name=self._extract_name(lines, index, default="task"),
                        line_number=index,
                        decorators=[self._decorator_name(stripped)],
                        graph_node_type="FUNCTION",
                        parse_source="custom_regex_fallback",
                    )
                )

            if _CQRS_HANDLER_PATTERN.search(line):
                facts.append(
                    StructuralFact(
                        file_path=str(path),
                        pattern_type="cqrs_handler",
                        name=self._extract_name(lines, index, default="handler"),
                        line_number=index,
                        decorators=[self._decorator_name(stripped)],
                        graph_node_type="HANDLER",
                        parse_source="custom_regex_fallback",
                    )
                )

            class_match = _CLASS_PATTERN.match(line)
            if class_match and _AI_BASE_PATTERN.search(line):
                facts.append(
                    StructuralFact(
                        file_path=str(path),
                        pattern_type="ai_class",
                        name=class_match.group(1),
                        line_number=index,
                        decorators=[],
                        graph_node_type="CLASS",
                        parse_source="custom_regex_fallback",
                    )
                )

            async_match = self._async_match(line)
            if async_match:
                facts.append(
                    StructuralFact(
                        file_path=str(path),
                        pattern_type="async_ai_function",
                        name=async_match,
                        line_number=index,
                        decorators=[],
                        is_async=True,
                        graph_node_type="FUNCTION",
                        parse_source="custom_regex_fallback",
                    )
                )

        return self._dedupe(facts)

    def parse_files(self, file_paths: Iterable[str | Path]) -> list[StructuralFact]:
        facts: list[StructuralFact] = []
        for file_path in file_paths:
            facts.extend(self.parse_file(file_path))
        return self._dedupe(facts)

    def _dedupe(self, facts: list[StructuralFact]) -> list[StructuralFact]:
        seen: set[tuple[str, str, int, str]] = set()
        unique: list[StructuralFact] = []
        for fact in facts:
            key = (fact.file_path, fact.pattern_type, fact.line_number, fact.name)
            if key in seen:
                continue
            seen.add(key)
            unique.append(fact)
        return unique

    def _extract_name(self, lines: list[str], line_number: int, *, default: str) -> str:
        for index in range(line_number, min(line_number + 4, len(lines))):
            function_match = _FUNCTION_PATTERN.match(lines[index - 1])
            if function_match:
                return function_match.group(1)
            ts_function_match = _TS_FUNCTION_PATTERN.match(lines[index - 1])
            if ts_function_match:
                return ts_function_match.group(1)
            ts_method_match = _TS_METHOD_PATTERN.match(lines[index - 1])
            if ts_method_match:
                return ts_method_match.group(1)
            class_match = _CLASS_PATTERN.match(lines[index - 1])
            if class_match:
                return class_match.group(1)
            ts_class_match = _TS_CLASS_PATTERN.match(lines[index - 1])
            if ts_class_match:
                return ts_class_match.group(1)
        return default

    def _decorator_name(self, line: str) -> str:
        match = re.match(r"@([A-Za-z0-9_.]+)", line)
        if match:
            return f"@{match.group(1)}"
        return "@decorator"

    def _async_match(self, line: str) -> str | None:
        for pattern in _ASYNC_PATTERNS:
            match = pattern.match(line)
            if match:
                return match.group(1)
        return None
