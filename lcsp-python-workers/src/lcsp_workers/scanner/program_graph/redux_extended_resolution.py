"""Resolve Redux Toolkit listener middleware and redux-observable epic boundaries."""
from __future__ import annotations

import re
from pathlib import Path

from .semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from .source_roles import is_test_source_path

_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
_EXCLUDED = {".git", "node_modules", "dist", "build", ".next", "coverage", "vendor"}
_SYMBOL_RE = re.compile(
    r"\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)"
    r"|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
)
_ACTION_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createAction\s*\(\s*['\"]([^'\"]+)['\"]"
)
_LISTENER_RE = re.compile(
    r"\b(?:listenerMiddleware\.)?startListening\s*\(\s*\{(?P<body>[\s\S]{0,2500}?)\}\s*\)",
    re.MULTILINE,
)
_LISTENER_ACTION_RE = re.compile(r"\bactionCreator\s*:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)")
_LISTENER_TYPE_RE = re.compile(r"\btype\s*:\s*['\"]([^'\"]+)['\"]")
_LISTENER_EFFECT_RE = re.compile(r"\beffect\s*:\s*([A-Za-z_$][\w$]*)")
_EPIC_OF_TYPE_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*?\.pipe\s*\([\s\S]{0,1800}?ofType\s*\((?P<types>[^\)]*)\)[\s\S]{0,1800}?\)",
    re.MULTILINE,
)
_EPIC_FUNCTION_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*[^;\n]*?\.pipe\s*\([\s\S]{0,2200}?ofType\s*\((?P<types>[^\)]*)\)",
    re.MULTILINE,
)
_DISPATCH_RE = re.compile(r"\bdispatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\(")


class ReduxExtendedResolver:
    """Add listener/epic continuations for statically identifiable Redux action types."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        sources = self._sources()
        symbols = self._symbols(sources)
        actions = self._actions(sources)
        for rel, text in sources:
            self._listeners(program, rel, text, symbols, actions)
            self._epics(program, rel, text, symbols, actions)
            self._dispatches(program, rel, text, actions)
        return program

    def _sources(self) -> tuple[tuple[str, str], ...]:
        result: list[tuple[str, str]] = []
        for path in sorted(p for p in self.workspace.rglob("*") if p.is_file()):
            try:
                relative = path.relative_to(self.workspace)
            except ValueError:
                continue
            if any(part in _EXCLUDED for part in relative.parts):
                continue
            rel = relative.as_posix()
            if is_test_source_path(rel) or path.suffix.lower() not in _EXTENSIONS:
                continue
            try:
                result.append((rel, path.read_text(encoding="utf-8", errors="replace")))
            except OSError:
                continue
        return tuple(result)

    @staticmethod
    def _symbols(sources: tuple[tuple[str, str], ...]) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for rel, text in sources:
            for match in _SYMBOL_RE.finditer(text):
                name = match.group(1) or match.group(2)
                if name:
                    result.setdefault(name, []).append(f"symbol:{rel}:{name}")
        return result

    @staticmethod
    def _actions(sources: tuple[tuple[str, str], ...]) -> dict[str, str]:
        result: dict[str, str] = {}
        for _, text in sources:
            for match in _ACTION_RE.finditer(text):
                result[match.group(1)] = match.group(2)
        return result

    @classmethod
    def _listeners(
        cls,
        program: SemanticProgram,
        rel: str,
        text: str,
        symbols: dict[str, list[str]],
        actions: dict[str, str],
    ) -> None:
        for match in _LISTENER_RE.finditer(text):
            body = match.group("body")
            action_match = _LISTENER_ACTION_RE.search(body)
            type_match = _LISTENER_TYPE_RE.search(body)
            effect_match = _LISTENER_EFFECT_RE.search(body)
            identity = ""
            if action_match:
                raw = action_match.group(1).replace(".type", "")
                identity = actions.get(raw, "")
            elif type_match:
                identity = type_match.group(1)
            if not identity:
                continue
            event_key = f"event:redux:{identity}"
            program.add_node(
                SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "RTK_LISTENER"})
            )
            if effect_match and len(symbols.get(effect_match.group(1), [])) == 1:
                program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", event_key, symbols[effect_match.group(1)][0]))
            else:
                _unresolved(program, "RTK_LISTENER", identity, event_key, rel, _line(text, match.start()))

    @classmethod
    def _epics(
        cls,
        program: SemanticProgram,
        rel: str,
        text: str,
        symbols: dict[str, list[str]],
        actions: dict[str, str],
    ) -> None:
        seen: set[tuple[str, str]] = set()
        for regex in (_EPIC_FUNCTION_RE, _EPIC_OF_TYPE_RE):
            for match in regex.finditer(text):
                epic = match.group(1)
                for raw in match.group("types").split(","):
                    token = raw.strip().replace(".type", "")
                    if (token.startswith("'") and token.endswith("'")) or (token.startswith('"') and token.endswith('"')):
                        identity = token[1:-1]
                    else:
                        identity = actions.get(token, "")
                    if not identity or (epic, identity) in seen:
                        continue
                    seen.add((epic, identity))
                    event_key = f"event:redux:{identity}"
                    program.add_node(
                        SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "REDUX_OBSERVABLE"})
                    )
                    if len(symbols.get(epic, [])) == 1:
                        program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", event_key, symbols[epic][0]))
                    else:
                        _unresolved(program, "REDUX_OBSERVABLE", identity, event_key, rel, _line(text, match.start()))

    @staticmethod
    def _dispatches(
        program: SemanticProgram,
        rel: str,
        text: str,
        actions: dict[str, str],
    ) -> None:
        for match in _DISPATCH_RE.finditer(text):
            identity = actions.get(match.group(1), "")
            if not identity:
                continue
            line = _line(text, match.start())
            call_key = f"call:{rel}:{line}:redux-extended-dispatch:{match.group(1)}"
            event_key = f"event:redux:{identity}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", "redux dispatch", rel, line, line, attributes={"frameworkBoundary": "REDUX"}))
            program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "REDUX"}))
            program.add_edge(SemanticEdgeFact("CALLS", f"module:{rel}", call_key))
            program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, event_key))


def _unresolved(program: SemanticProgram, boundary: str, identity: str, source_key: str, rel: str, line: int) -> None:
    safe = re.sub(r"[^A-Za-z0-9_.:/-]+", "_", identity)[:160] or "unknown"
    key = f"framework-unresolved:{boundary}:{safe}:{source_key}"
    program.add_node(
        SemanticNodeFact(
            key,
            "UNRESOLVED_DYNAMIC_TARGET",
            f"{boundary}:{identity}",
            rel,
            line,
            line,
            attributes={"frameworkBoundary": boundary, "boundaryIdentity": identity, "resolutionState": "UNRESOLVED"},
            coverage_state="LIMITED",
        )
    )
    program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", source_key, key, attributes={"frameworkBoundary": boundary}, coverage_state="LIMITED"))
    if key not in program.unresolved_frontiers:
        program.unresolved_frontiers.append(key)


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, max(0, offset)) + 1
