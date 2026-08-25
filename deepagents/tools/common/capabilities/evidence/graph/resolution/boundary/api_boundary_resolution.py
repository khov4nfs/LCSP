"""Resolve HTTP/GraphQL framework boundaries to concrete repository symbols."""
from __future__ import annotations

import re
from pathlib import Path

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.schema.source_roles import is_test_source_path

_SOURCE_EXTENSIONS = frozenset({".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"})
_EXCLUDED = frozenset(
    {
        ".git",
        "node_modules",
        "dist",
        "build",
        ".next",
        "coverage",
        "vendor",
        ".venv",
        "venv",
        "__pycache__",
        "target",
    }
)
_TS_ROUTE_RE = re.compile(
    r"@(Get|Post|Put|Patch|Delete)\s*\(\s*['\"]([^'\"]*)['\"]\s*\)",
    re.I,
)
_PY_ROUTE_RE = re.compile(
    r"@(?:app|router|blueprint)\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]",
    re.I,
)
_CONTROLLER_RE = re.compile(r"@Controller\s*\(\s*['\"]([^'\"]*)['\"]", re.I)
_TS_METHOD_RE = re.compile(
    r"(?m)^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::[^={]+)?\s*\{"
)
_PY_FUNCTION_RE = re.compile(r"(?m)^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(")
_GRAPHQL_DECORATOR_RE = re.compile(r"@(Query|Mutation|Subscription)\b", re.I)


class ApiBoundaryResolver:
    """Connect source-declared HTTP/GraphQL boundaries to concrete handler symbols."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        nodes = {node.key: node for node in program.nodes}
        for path in self._files():
            rel = path.relative_to(self.workspace).as_posix()
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            self._http_file(program, nodes, rel, text, path.suffix.lower())
            self._graphql_file(program, nodes, rel, text, path.suffix.lower())
        return program

    def _http_file(
        self,
        program: SemanticProgram,
        nodes: dict[str, SemanticNodeFact],
        rel: str,
        text: str,
        suffix: str,
    ) -> None:
        prefix_match = _CONTROLLER_RE.search(text)
        prefix = self._normalize_route(prefix_match.group(1)) if prefix_match else ""
        pattern = _PY_ROUTE_RE if suffix == ".py" else _TS_ROUTE_RE
        for match in pattern.finditer(text):
            method = match.group(1).upper()
            path = self._join_route(prefix, match.group(2))
            route_key = f"http-route:{method}:{path}"
            handler_match = self._next_handler(text, match.end(), python=suffix == ".py")
            if not handler_match:
                self._mark_unresolved(
                    program,
                    route_key,
                    rel,
                    _line(text, match.start()),
                    f"{method} {path}",
                )
                continue
            handler, handler_line = handler_match
            symbol_key = f"symbol:{rel}:{handler}"
            target = nodes.get(symbol_key)
            if target is None and suffix != ".py":
                target = self._materialize_text_method(
                    program,
                    rel=rel,
                    symbol_key=symbol_key,
                    handler=handler,
                    line=handler_line,
                    boundary="HTTP",
                )
                nodes[symbol_key] = target
            if target is None or target.node_type not in {"FUNCTION", "METHOD"}:
                self._mark_unresolved(
                    program,
                    route_key,
                    rel,
                    _line(text, match.start()),
                    f"{method} {path}",
                )
                continue
            program.add_edge(
                SemanticEdgeFact(
                    "HANDLED_BY",
                    route_key,
                    symbol_key,
                    attributes={"frameworkBoundary": "HTTP"},
                    origin="FRAMEWORK_RESOLUTION",
                    resolution_state="CORROBORATED",
                )
            )

    def _graphql_file(
        self,
        program: SemanticProgram,
        nodes: dict[str, SemanticNodeFact],
        rel: str,
        text: str,
        suffix: str,
    ) -> None:
        for match in _GRAPHQL_DECORATOR_RE.finditer(text):
            operation_type = match.group(1).capitalize()
            handler_match = self._next_handler(text, match.end(), python=suffix == ".py")
            if not handler_match:
                continue
            handler, handler_line = handler_match
            operation_key = f"graphql-operation:{operation_type}:{handler}"
            target_key = f"symbol:{rel}:{handler}"
            target = nodes.get(target_key)
            if target is None and suffix != ".py":
                target = self._materialize_text_method(
                    program,
                    rel=rel,
                    symbol_key=target_key,
                    handler=handler,
                    line=handler_line,
                    boundary="GRAPHQL",
                )
                nodes[target_key] = target
            if target is None or target.node_type not in {"FUNCTION", "METHOD"}:
                continue
            # Only bind an operation that already exists in graph evidence (usually
            # GraphQL contract analysis). A decorator alone is not enough to invent a
            # public schema operation identity.
            if not any(node.key == operation_key for node in program.nodes):
                continue
            program.add_edge(
                SemanticEdgeFact(
                    "HANDLED_BY",
                    operation_key,
                    target_key,
                    attributes={"frameworkBoundary": "GRAPHQL"},
                    origin="FRAMEWORK_RESOLUTION",
                    resolution_state="CORROBORATED",
                )
            )

    @staticmethod
    def _next_handler(
        text: str,
        start: int,
        *,
        python: bool,
    ) -> tuple[str, int] | None:
        # Bound matching to the immediate declaration region so one decorator cannot
        # accidentally attach to a later unrelated symbol.
        tail = text[start : start + 1200]
        pattern = _PY_FUNCTION_RE if python else _TS_METHOD_RE
        match = pattern.search(tail)
        if not match:
            return None
        return match.group(1), _line(text, start + match.start())

    @staticmethod
    def _materialize_text_method(
        program: SemanticProgram,
        *,
        rel: str,
        symbol_key: str,
        handler: str,
        line: int,
        boundary: str,
    ) -> SemanticNodeFact:
        """Materialize a concrete JS/TS method proven by the decorator-adjacent source.

        The generic text extractor intentionally indexes declarations conservatively and
        does not create every class method. A framework decorator plus an immediate method
        declaration is sufficient static evidence to create this METHOD node, which keeps
        the API boundary from terminating at a module-only identity.
        """
        node = SemanticNodeFact(
            symbol_key,
            "METHOD",
            handler,
            rel,
            line,
            line,
            handler,
            attributes={"frameworkBoundary": boundary},
            origin="FRAMEWORK_RESOLUTION",
            resolution_state="OBSERVED",
        )
        program.add_node(node)
        program.add_edge(
            SemanticEdgeFact(
                "DECLARES",
                f"module:{rel}",
                symbol_key,
                attributes={"frameworkBoundary": boundary},
                origin="FRAMEWORK_RESOLUTION",
                resolution_state="OBSERVED",
            )
        )
        return node

    @staticmethod
    def _mark_unresolved(
        program: SemanticProgram,
        route_key: str,
        rel: str,
        line: int,
        identity: str,
    ) -> None:
        # Only source-declared routes call this resolver, so unresolved means the
        # framework declaration exists but the static implementation mapping failed.
        key = f"framework-unresolved:HTTP:{_safe(identity)}:{rel}:{line}"
        if any(node.key == key for node in program.nodes):
            return
        program.add_node(
            SemanticNodeFact(
                key,
                "UNRESOLVED_DYNAMIC_TARGET",
                f"HTTP:{identity}",
                rel,
                line,
                line,
                attributes={
                    "frameworkBoundary": "HTTP",
                    "boundaryIdentity": identity,
                    "resolutionState": "UNRESOLVED",
                },
                coverage_state="LIMITED",
                origin="FRAMEWORK_RESOLUTION",
                resolution_state="UNRESOLVED",
            )
        )
        program.add_edge(
            SemanticEdgeFact(
                "RESOLVES_TO",
                route_key,
                key,
                attributes={"frameworkBoundary": "HTTP"},
                coverage_state="LIMITED",
                origin="FRAMEWORK_RESOLUTION",
                resolution_state="UNRESOLVED",
            )
        )
        if key not in program.unresolved_frontiers:
            program.unresolved_frontiers.append(key)

    def _files(self) -> tuple[Path, ...]:
        result = []
        for path in self.workspace.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in _SOURCE_EXTENSIONS:
                continue
            try:
                relative = path.relative_to(self.workspace)
            except ValueError:
                continue
            if any(part in _EXCLUDED for part in relative.parts):
                continue
            rel = relative.as_posix()
            if is_test_source_path(rel):
                continue
            result.append(path)
        return tuple(sorted(result))

    @staticmethod
    def _normalize_route(value: str) -> str:
        path = str(value or "").split("?", 1)[0].strip()
        return "/" + path.strip("/") if path.strip("/") else "/"

    @classmethod
    def _join_route(cls, prefix: str, suffix: str) -> str:
        if not prefix:
            return cls._normalize_route(suffix)
        return cls._normalize_route(prefix.rstrip("/") + "/" + str(suffix).lstrip("/"))


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, max(0, offset)) + 1


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:/-]+", "_", value)[:160] or "unknown"
