from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class ParsedPythonFile:
    path: Path
    relative_path: str
    tree: ast.AST | None
    import_map: dict[str, str] = field(default_factory=dict)
    imported_symbols: dict[str, tuple[str, str]] = field(default_factory=dict)
    coverage_limited: bool = False
    skip_reason: str | None = None


class PythonAstParser:
    """Parse complete Python files into AST without arbitrary character/byte chunking.

    Repository/archive safety limits are enforced by ``ScannerWorkspace``. Once a
    source file has been safely materialized, semantic chunking is derived from the
    AST/symbol line ranges rather than skipping files merely because they exceed a
    fixed source-size threshold.
    """

    def parse_file(self, path: Path, workspace: Path) -> ParsedPythonFile:
        relative = self._relative_path(path, workspace)
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            return ParsedPythonFile(
                path=path,
                relative_path=relative,
                tree=None,
                coverage_limited=True,
                skip_reason=f"file unreadable: {type(error).__name__}",
            )

        try:
            tree = ast.parse(source, filename=relative)
        except (SyntaxError, ValueError, MemoryError) as error:
            return ParsedPythonFile(
                path=path,
                relative_path=relative,
                tree=None,
                coverage_limited=True,
                skip_reason=f"AST parse failed: {type(error).__name__}",
            )

        visitor = _ImportVisitor()
        visitor.visit(tree)
        return ParsedPythonFile(
            path=path,
            relative_path=relative,
            tree=tree,
            import_map=visitor.import_map,
            imported_symbols=visitor.imported_symbols,
        )

    def _relative_path(self, path: Path, workspace: Path) -> str:
        try:
            return path.resolve(strict=False).relative_to(
                workspace.resolve(strict=False)
            ).as_posix()
        except ValueError:
            return path.name


class _ImportVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.import_map: dict[str, str] = {}
        self.imported_symbols: dict[str, tuple[str, str]] = {}

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            package = alias.name
            local_name = alias.asname or package.split(".", 1)[0]
            self.import_map[local_name] = package

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        root_package = module.split(".", 1)[0] if module else ""
        for alias in node.names:
            local_name = alias.asname or alias.name
            if root_package:
                self.import_map[local_name] = root_package
            self.imported_symbols[local_name] = (module, alias.name)
