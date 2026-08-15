from __future__ import annotations

import ast
from pathlib import Path

from .python_ast_parser import PythonAstParser


class PythonCstParser:
    """Best-effort CST adapter.

    libcst is not required in this runtime image today. This adapter keeps the
    CST seam explicit while using stdlib AST for kwarg-name extraction. It never
    returns argument values or source snippets.
    """

    def kwarg_names_for_calls(self, path: Path, workspace: Path) -> dict[int, list[str]]:
        """Extract only keyword names for calls, keyed by source line.

        Args:
            path: Python file to parse inside the extracted workspace.
            workspace: Workspace root used for safe repository-relative parsing.

        Returns:
            Mapping from call line number to keyword argument names. Values and raw
            source are deliberately excluded from the result.
        """
        parsed = PythonAstParser().parse_file(path, workspace)
        if parsed.tree is None:
            return {}

        names_by_line: dict[int, list[str]] = {}
        for node in ast.walk(parsed.tree):
            if isinstance(node, ast.Call):
                names_by_line[getattr(node, "lineno", 1)] = [
                    keyword.arg for keyword in node.keywords if keyword.arg is not None
                ]
        return names_by_line

