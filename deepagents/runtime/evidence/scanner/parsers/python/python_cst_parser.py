from __future__ import annotations

from dataclasses import dataclass, field
from importlib.metadata import version
from pathlib import Path

import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider


@dataclass(frozen=True)
class PythonCstParseResult:
    kwarg_names_by_line: dict[int, list[str]]
    coverage_limitations: list[str] = field(default_factory=list)


class _CallKeywordVisitor(cst.CSTVisitor):
    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self) -> None:
        self.names_by_line: dict[int, list[str]] = {}

    def visit_Call(self, node: cst.Call) -> None:
        names = [
            argument.keyword.value
            for argument in node.args
            if isinstance(argument.keyword, cst.Name)
        ]
        self.names_by_line[self.get_metadata(PositionProvider, node).start.line] = names


class PythonCstParser:
    """Pinned libcst adapter that extracts argument names without source values."""

    @staticmethod
    def tool_version() -> str:
        return version("libcst")

    def parse_call_keywords(self, path: Path, workspace: Path) -> PythonCstParseResult:
        """Extract call keyword names and report sanitized CST coverage limitations."""
        relative_path = self._relative_path(path, workspace)
        try:
            source = path.read_text(encoding="utf-8")
            module = cst.parse_module(source)
        except (OSError, UnicodeDecodeError, cst.ParserSyntaxError) as error:
            return PythonCstParseResult(
                kwarg_names_by_line={},
                coverage_limitations=[
                    f"python_libcst_parse_failed: file={relative_path} "
                    f"reason={type(error).__name__}"
                ],
            )

        visitor = _CallKeywordVisitor()
        MetadataWrapper(module).visit(visitor)
        return PythonCstParseResult(kwarg_names_by_line=visitor.names_by_line)

    def kwarg_names_for_calls(self, path: Path, workspace: Path) -> dict[int, list[str]]:
        """Backward-compatible keyword-name view for existing parser callers."""
        return self.parse_call_keywords(path, workspace).kwarg_names_by_line

    def _relative_path(self, path: Path, workspace: Path) -> str:
        try:
            return path.resolve(strict=False).relative_to(
                workspace.resolve(strict=False)
            ).as_posix()
        except ValueError:
            return path.name
