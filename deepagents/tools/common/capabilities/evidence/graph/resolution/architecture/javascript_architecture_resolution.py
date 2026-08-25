"""Resolve popular JavaScript/TypeScript architecture boundaries.

This adapter covers state dispatch and message/DI patterns that ordinary call graphs
cannot follow: Redux/Redux Toolkit/thunks/sagas, EventEmitter/RxJS, common container
APIs, Express-style routes, BullMQ/Rabbit-style queues, and KafkaJS topics. Resolution
is conservative: only literal identities and unique named targets are linked; dynamic
or ambiguous targets become explicit unresolved frontiers.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.schema.source_roles import is_test_source_path

_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
_EXCLUDED = {
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
}
_SYMBOL_RE = re.compile(
    r"\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)"
    r"|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>",
    re.MULTILINE,
)
_CREATE_ACTION_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createAction\s*\(\s*['\"]([^'\"]+)['\"]",
    re.MULTILINE,
)
_CREATE_ASYNC_THUNK_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createAsyncThunk\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
_CREATE_SLICE_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createSlice\s*\(\s*\{(?P<body>[\s\S]{0,12000}?)\}\s*\)",
    re.MULTILINE,
)
_SLICE_NAME_RE = re.compile(r"\bname\s*:\s*['\"]([^'\"]+)['\"]")
_REDUCERS_RE = re.compile(r"\breducers\s*:\s*\{(?P<body>[\s\S]{0,6000}?)\}\s*(?:,|$)", re.MULTILINE)
_REDUCER_NAME_RE = re.compile(r"(?m)^\s*([A-Za-z_$][\w$]*)\s*(?:\([^\n]*\)\s*\{|:\s*(?:\([^)]*\)\s*=>|function\b))")
_DISPATCH_CREATOR_RE = re.compile(
    r"\b(?:(?:store\.)?dispatch)\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\("
)
_DISPATCH_LITERAL_RE = re.compile(
    r"\b(?:(?:store\.)?dispatch)\s*\(\s*\{[\s\S]{0,300}?\btype\s*:\s*['\"]([^'\"]+)['\"]"
)
_PUT_CREATOR_RE = re.compile(r"\bput\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(")
_ADD_CASE_RE = re.compile(
    r"\b(?:builder\.)?addCase\s*\(\s*([^,\n]+)\s*,\s*([A-Za-z_$][\w$]*)"
)
_SAGA_RE = re.compile(
    r"\b(?:takeEvery|takeLatest|takeLeading)\s*\(\s*([^,\n]+)\s*,\s*([A-Za-z_$][\w$]*)"
)
_EVENT_SUB_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.(?:on|once|addListener)\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*([A-Za-z_$][\w$]*)"
)
_EVENT_PUB_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.(?:emit|publish)\s*\(\s*['\"]([^'\"]+)['\"]"
)
_RX_SUB_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\.subscribe\s*\(\s*([A-Za-z_$][\w$]*)")
_RX_NEXT_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\.next\s*\(")
_EXPRESS_ROUTE_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|options|head)\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*([A-Za-z_$][\w$]*)",
    re.IGNORECASE,
)
_CONTAINER_BIND_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.bind\s*\(\s*([^\)]+?)\s*\)\.to\s*\(\s*([A-Za-z_$][\w$]*)\s*\)"
)
_CONTAINER_TOSelf_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.bind\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\.toSelf\s*\("
)
_CONTAINER_REGISTER_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.(?:register|registerSingleton)\s*\(\s*([^,\n]+)\s*,\s*(?:\{[\s\S]{0,300}?useClass\s*:\s*)?([A-Za-z_$][\w$]*)"
)
_AWILIX_REGISTER_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.register\s*\(\s*\{(?P<body>[\s\S]{0,5000}?)\}\s*\)",
    re.MULTILINE,
)
_AWILIX_ENTRY_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\s*:\s*as(?:Class|Function)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)"
)
_CONTAINER_RESOLVE_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.(?:get|resolve)\s*\(\s*([^\)]+?)\s*\)"
)
_GENERIC_REGISTER_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.register\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*([A-Za-z_$][\w$]*)"
)
_GENERIC_DISPATCH_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.dispatch\s*\(\s*['\"]([^'\"]+)['\"]"
)
_RABBIT_CONSUME_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.consume\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*([A-Za-z_$][\w$]*)"
)
_RABBIT_SEND_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.sendToQueue\s*\(\s*['\"]([^'\"]+)['\"]"
)
_BULL_WORKER_RE = re.compile(
    r"\bnew\s+Worker\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*([A-Za-z_$][\w$]*)"
)
_BULL_QUEUE_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Queue\s*\(\s*['\"]([^'\"]+)['\"]"
)
_QUEUE_ADD_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\.add\s*\(")
_KAFKA_SUB_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.subscribe\s*\(\s*\{[\s\S]{0,250}?topic\s*:\s*['\"]([^'\"]+)['\"]"
)
_KAFKA_RUN_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.run\s*\(\s*\{[\s\S]{0,500}?eachMessage\s*:\s*([A-Za-z_$][\w$]*)"
)
_KAFKA_SEND_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.send\s*\(\s*\{[\s\S]{0,300}?topic\s*:\s*['\"]([^'\"]+)['\"]"
)


@dataclass(frozen=True)
class _Source:
    rel: str
    text: str


class JavaScriptArchitectureResolver:
    """Resolve major JS/TS state, DI, route and messaging boundaries."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        sources = self._sources()
        symbols = self._symbols(sources)
        action_types = self._redux_action_types(sources)
        di_bindings = self._di_bindings(sources)
        generic_bindings = self._generic_bindings(sources)
        queue_aliases = self._queue_aliases(sources)
        kafka_topics = self._kafka_subscriptions(sources)

        self._emit_di_bindings(program, di_bindings, symbols)
        self._emit_generic_bindings(program, generic_bindings, symbols)
        self._emit_redux_handlers(program, sources, symbols, action_types)

        for source in sources:
            self._redux_dispatch(program, source, symbols, action_types)
            self._event_emitter(program, source, symbols)
            self._rxjs(program, source, symbols)
            self._routes(program, source, symbols)
            self._di_resolutions(program, source, di_bindings)
            self._generic_dispatch(program, source, generic_bindings)
            self._brokers(program, source, symbols, queue_aliases, kafka_topics)
        return program

    def _sources(self) -> tuple[_Source, ...]:
        result: list[_Source] = []
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
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            result.append(_Source(rel, text))
        return tuple(result)

    @staticmethod
    def _symbols(sources: Iterable[_Source]) -> dict[str, list[tuple[str, str, int]]]:
        result: dict[str, list[tuple[str, str, int]]] = {}
        for source in sources:
            for match in _SYMBOL_RE.finditer(source.text):
                name = match.group(1) or match.group(2)
                if not name:
                    continue
                line = _line(source.text, match.start())
                result.setdefault(name, []).append((f"symbol:{source.rel}:{name}", source.rel, line))
        return result

    @staticmethod
    def _redux_action_types(sources: Iterable[_Source]) -> dict[str, str]:
        result: dict[str, str] = {}
        for source in sources:
            for match in _CREATE_ACTION_RE.finditer(source.text):
                result[match.group(1)] = match.group(2)
            for match in _CREATE_ASYNC_THUNK_RE.finditer(source.text):
                creator, identity = match.group(1), match.group(2)
                result[creator] = identity
                result[f"{creator}.pending"] = f"{identity}/pending"
                result[f"{creator}.fulfilled"] = f"{identity}/fulfilled"
                result[f"{creator}.rejected"] = f"{identity}/rejected"
            for match in _CREATE_SLICE_RE.finditer(source.text):
                body = match.group("body")
                slice_name_match = _SLICE_NAME_RE.search(body)
                reducers_match = _REDUCERS_RE.search(body)
                if not slice_name_match or not reducers_match:
                    continue
                slice_name = slice_name_match.group(1)
                for reducer in _REDUCER_NAME_RE.finditer(reducers_match.group("body")):
                    reducer_name = reducer.group(1)
                    result[reducer_name] = f"{slice_name}/{reducer_name}"
                    result[f"{match.group(1)}.actions.{reducer_name}"] = f"{slice_name}/{reducer_name}"
        return result

    @staticmethod
    def _di_bindings(sources: Iterable[_Source]) -> dict[tuple[str, str], set[str]]:
        result: dict[tuple[str, str], set[str]] = {}
        for source in sources:
            for match in _CONTAINER_BIND_RE.finditer(source.text):
                result.setdefault((match.group(1), _identity(match.group(2))), set()).add(match.group(3))
            for match in _CONTAINER_TOSelf_RE.finditer(source.text):
                result.setdefault((match.group(1), match.group(2)), set()).add(match.group(2))
            for match in _CONTAINER_REGISTER_RE.finditer(source.text):
                result.setdefault((match.group(1), _identity(match.group(2))), set()).add(match.group(3))
            for match in _AWILIX_REGISTER_RE.finditer(source.text):
                namespace = match.group(1)
                for entry in _AWILIX_ENTRY_RE.finditer(match.group("body")):
                    result.setdefault((namespace, entry.group(1)), set()).add(entry.group(2))
        return result

    @staticmethod
    def _generic_bindings(sources: Iterable[_Source]) -> dict[tuple[str, str], set[str]]:
        result: dict[tuple[str, str], set[str]] = {}
        for source in sources:
            for match in _GENERIC_REGISTER_RE.finditer(source.text):
                result.setdefault((match.group(1), match.group(2)), set()).add(match.group(3))
        return result

    @staticmethod
    def _queue_aliases(sources: Iterable[_Source]) -> dict[str, str]:
        result: dict[str, str] = {}
        for source in sources:
            for match in _BULL_QUEUE_RE.finditer(source.text):
                result[match.group(1)] = match.group(2)
        return result

    @staticmethod
    def _kafka_subscriptions(sources: Iterable[_Source]) -> dict[tuple[str, str], set[str]]:
        result: dict[tuple[str, str], set[str]] = {}
        for source in sources:
            topics: dict[str, list[str]] = {}
            for match in _KAFKA_SUB_RE.finditer(source.text):
                topics.setdefault(match.group(1), []).append(match.group(2))
            for match in _KAFKA_RUN_RE.finditer(source.text):
                boundary, handler = match.group(1), match.group(2)
                for topic in topics.get(boundary, []):
                    result.setdefault((boundary, topic), set()).add(handler)
        return result

    @classmethod
    def _emit_di_bindings(
        cls,
        program: SemanticProgram,
        bindings: dict[tuple[str, str], set[str]],
        symbols: dict[str, list[tuple[str, str, int]]],
    ) -> None:
        for (namespace, identity), implementations in sorted(bindings.items()):
            key = cls._di_key(namespace, identity)
            program.add_node(
                SemanticNodeFact(
                    key,
                    "TYPE",
                    f"{namespace}:{identity}",
                    attributes={"frameworkBoundary": "JS_DI", "bindingKey": identity, "namespace": namespace},
                )
            )
            targets = [rows[0][0] for name in implementations if len((rows := symbols.get(name, []))) == 1]
            if len(targets) == 1 and len(implementations) == 1:
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, targets[0]))
            else:
                _mark_unresolved(program, "JS_DI", f"{namespace}:{identity}", key, "RESOLVES_TO")

    @classmethod
    def _emit_generic_bindings(
        cls,
        program: SemanticProgram,
        bindings: dict[tuple[str, str], set[str]],
        symbols: dict[str, list[tuple[str, str, int]]],
    ) -> None:
        for (namespace, identity), handlers in sorted(bindings.items()):
            key = cls._registry_key(namespace, identity)
            program.add_node(
                SemanticNodeFact(key, "TYPE", f"{namespace}:{identity}", attributes={"frameworkBoundary": "JS_REGISTRY", "bindingKey": identity})
            )
            targets = [rows[0][0] for name in handlers if len((rows := symbols.get(name, []))) == 1]
            if len(targets) == 1 and len(handlers) == 1:
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, targets[0]))
            else:
                _mark_unresolved(program, "JS_REGISTRY", f"{namespace}:{identity}", key, "RESOLVES_TO")

    @classmethod
    def _emit_redux_handlers(
        cls,
        program: SemanticProgram,
        sources: Iterable[_Source],
        symbols: dict[str, list[tuple[str, str, int]]],
        action_types: dict[str, str],
    ) -> None:
        for source in sources:
            for match in _CREATE_SLICE_RE.finditer(source.text):
                body = match.group("body")
                slice_match = _SLICE_NAME_RE.search(body)
                reducers_match = _REDUCERS_RE.search(body)
                if not slice_match or not reducers_match:
                    continue
                slice_name = slice_match.group(1)
                reducers_body = reducers_match.group("body")
                body_offset = match.start("body") + reducers_match.start("body")
                for reducer in _REDUCER_NAME_RE.finditer(reducers_body):
                    name = reducer.group(1)
                    identity = f"{slice_name}/{name}"
                    line = _line(source.text, body_offset + reducer.start())
                    handler_key = f"redux-reducer:{source.rel}:{identity}:{line}"
                    event_key = cls._redux_event_key(identity)
                    program.add_node(SemanticNodeFact(handler_key, "FUNCTION", name, source.rel, line, line, name, attributes={"frameworkBoundary": "REDUX_REDUCER"}))
                    program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "REDUX"}))
                    program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", event_key, handler_key))

            for match in _ADD_CASE_RE.finditer(source.text):
                identity = cls._action_identity(match.group(1), action_types)
                if not identity:
                    continue
                handler = match.group(2)
                targets = symbols.get(handler, [])
                event_key = cls._redux_event_key(identity)
                program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "REDUX"}))
                if len(targets) == 1:
                    program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", event_key, targets[0][0]))
                else:
                    _mark_unresolved(program, "REDUX_REDUCER", identity, event_key, "CONSUMES_EVENT", source.rel, _line(source.text, match.start()))

            for match in _SAGA_RE.finditer(source.text):
                identity = cls._action_identity(match.group(1), action_types)
                if not identity:
                    continue
                worker = match.group(2)
                targets = symbols.get(worker, [])
                event_key = cls._redux_event_key(identity)
                program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "REDUX_SAGA"}))
                if len(targets) == 1:
                    program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", event_key, targets[0][0]))
                else:
                    _mark_unresolved(program, "REDUX_SAGA", identity, event_key, "CONSUMES_EVENT", source.rel, _line(source.text, match.start()))

            for match in _CREATE_ASYNC_THUNK_RE.finditer(source.text):
                creator, identity, handler = match.group(1), match.group(2), match.group(3)
                targets = symbols.get(handler, [])
                command_key = f"command:redux-thunk:{identity}"
                program.add_node(SemanticNodeFact(command_key, "COMMAND", identity, attributes={"frameworkBoundary": "REDUX_THUNK", "creator": creator}))
                if len(targets) == 1:
                    program.add_edge(SemanticEdgeFact("HANDLES_COMMAND", command_key, targets[0][0]))
                else:
                    _mark_unresolved(program, "REDUX_THUNK", identity, command_key, "HANDLES_COMMAND", source.rel, _line(source.text, match.start()))

    @classmethod
    def _redux_dispatch(
        cls,
        program: SemanticProgram,
        source: _Source,
        symbols: dict[str, list[tuple[str, str, int]]],
        action_types: dict[str, str],
    ) -> None:
        owner = f"module:{source.rel}"
        for match in _DISPATCH_CREATOR_RE.finditer(source.text):
            creator = match.group(1)
            identity = cls._action_identity(creator, action_types)
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:redux-dispatch:{creator}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", "redux dispatch", source.rel, line, line, attributes={"frameworkBoundary": "REDUX"}))
            program.add_edge(SemanticEdgeFact("CALLS", owner, call_key))
            if identity:
                if creator.split(".")[0] in {m.group(1) for m in _CREATE_ASYNC_THUNK_RE.finditer(source.text)}:
                    boundary_key = f"command:redux-thunk:{identity}"
                    program.add_node(SemanticNodeFact(boundary_key, "COMMAND", identity, attributes={"frameworkBoundary": "REDUX_THUNK"}))
                    program.add_edge(SemanticEdgeFact("PUBLISHES_COMMAND", call_key, boundary_key))
                else:
                    event_key = cls._redux_event_key(identity)
                    program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "REDUX"}))
                    program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, event_key))
            else:
                _mark_unresolved(program, "REDUX", creator, call_key, "RESOLVES_TO", source.rel, line)

        for match in _DISPATCH_LITERAL_RE.finditer(source.text):
            identity = match.group(1)
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:redux-dispatch:{identity}"
            event_key = cls._redux_event_key(identity)
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", "redux dispatch", source.rel, line, line, attributes={"frameworkBoundary": "REDUX"}))
            program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "REDUX"}))
            program.add_edge(SemanticEdgeFact("CALLS", owner, call_key))
            program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, event_key))

        for match in _PUT_CREATOR_RE.finditer(source.text):
            identity = cls._action_identity(match.group(1), action_types)
            if not identity:
                continue
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:redux-saga-put:{identity}"
            event_key = cls._redux_event_key(identity)
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", "redux saga put", source.rel, line, line, attributes={"frameworkBoundary": "REDUX_SAGA"}))
            program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "REDUX"}))
            program.add_edge(SemanticEdgeFact("CALLS", owner, call_key))
            program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, event_key))

    @staticmethod
    def _event_emitter(program: SemanticProgram, source: _Source, symbols: dict[str, list[tuple[str, str, int]]]) -> None:
        for match in _EVENT_SUB_RE.finditer(source.text):
            emitter, identity, handler = match.groups()
            event_key = f"event:emitter:{emitter}:{identity}"
            program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": "EVENT_EMITTER", "namespace": emitter}))
            targets = symbols.get(handler, [])
            if len(targets) == 1:
                program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", event_key, targets[0][0]))
            else:
                _mark_unresolved(program, "EVENT_EMITTER", f"{emitter}:{identity}", event_key, "CONSUMES_EVENT", source.rel, _line(source.text, match.start()))
        for match in _EVENT_PUB_RE.finditer(source.text):
            emitter, identity = match.groups()
            event_key = f"event:emitter:{emitter}:{identity}"
            if not any(node.key == event_key for node in program.nodes):
                continue
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:emit:{emitter}:{identity}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{emitter}.emit", source.rel, line, line, attributes={"frameworkBoundary": "EVENT_EMITTER"}))
            program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
            program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, event_key))

    @staticmethod
    def _rxjs(program: SemanticProgram, source: _Source, symbols: dict[str, list[tuple[str, str, int]]]) -> None:
        subjects: set[str] = set()
        for match in _RX_SUB_RE.finditer(source.text):
            subject, handler = match.groups()
            subjects.add(subject)
            event_key = f"event:rxjs:{subject}"
            program.add_node(SemanticNodeFact(event_key, "EVENT", subject, attributes={"frameworkBoundary": "RXJS"}))
            targets = symbols.get(handler, [])
            if len(targets) == 1:
                program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", event_key, targets[0][0]))
            else:
                _mark_unresolved(program, "RXJS", subject, event_key, "CONSUMES_EVENT", source.rel, _line(source.text, match.start()))
        for match in _RX_NEXT_RE.finditer(source.text):
            subject = match.group(1)
            if subject not in subjects:
                continue
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:rxjs:{subject}.next"
            event_key = f"event:rxjs:{subject}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{subject}.next", source.rel, line, line, attributes={"frameworkBoundary": "RXJS"}))
            program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
            program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, event_key))

    @staticmethod
    def _routes(program: SemanticProgram, source: _Source, symbols: dict[str, list[tuple[str, str, int]]]) -> None:
        for match in _EXPRESS_ROUTE_RE.finditer(source.text):
            _, method, route, handler = match.groups()
            route_key = f"http-route:{method.upper()}:{route}"
            program.add_node(SemanticNodeFact(route_key, "HTTP_ROUTE", f"{method.upper()} {route}", attributes={"method": method.upper(), "route": route, "frameworkBoundary": "JS_WEB"}))
            targets = symbols.get(handler, [])
            if len(targets) == 1:
                program.add_edge(SemanticEdgeFact("HANDLED_BY", route_key, targets[0][0]))
            else:
                _mark_unresolved(program, "JS_WEB", f"{method.upper()} {route}", route_key, "HANDLED_BY", source.rel, _line(source.text, match.start()))

    @classmethod
    def _di_resolutions(cls, program: SemanticProgram, source: _Source, bindings: dict[tuple[str, str], set[str]]) -> None:
        for match in _CONTAINER_RESOLVE_RE.finditer(source.text):
            namespace, raw_identity = match.groups()
            if not any(hint in namespace.lower() for hint in ("container", "injector", "resolver")):
                continue
            identity = _identity(raw_identity)
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:js-di:{namespace}:{identity}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{namespace}.resolve", source.rel, line, line, attributes={"frameworkBoundary": "JS_DI"}))
            program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
            if (namespace, identity) in bindings:
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", call_key, cls._di_key(namespace, identity)))
            else:
                _mark_unresolved(program, "JS_DI", f"{namespace}:{identity}", call_key, "RESOLVES_TO", source.rel, line)

    @classmethod
    def _generic_dispatch(cls, program: SemanticProgram, source: _Source, bindings: dict[tuple[str, str], set[str]]) -> None:
        for match in _GENERIC_DISPATCH_RE.finditer(source.text):
            namespace, identity = match.groups()
            if (namespace, identity) not in bindings:
                continue
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:js-registry:{namespace}:{identity}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{namespace}.dispatch", source.rel, line, line, attributes={"frameworkBoundary": "JS_REGISTRY"}))
            program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
            program.add_edge(SemanticEdgeFact("RESOLVES_TO", call_key, cls._registry_key(namespace, identity)))

    @staticmethod
    def _brokers(
        program: SemanticProgram,
        source: _Source,
        symbols: dict[str, list[tuple[str, str, int]]],
        queue_aliases: dict[str, str],
        kafka_topics: dict[tuple[str, str], set[str]],
    ) -> None:
        for match in _RABBIT_CONSUME_RE.finditer(source.text):
            _, queue, handler = match.groups()
            _boundary(program, symbols, source, "RABBITMQ", queue, handler, match.start())
        for match in _RABBIT_SEND_RE.finditer(source.text):
            _, queue = match.groups()
            _producer(program, source, "RABBITMQ", queue, match.start())
        for match in _BULL_WORKER_RE.finditer(source.text):
            queue, handler = match.groups()
            _boundary(program, symbols, source, "BULLMQ", queue, handler, match.start())
        for match in _QUEUE_ADD_RE.finditer(source.text):
            alias = match.group(1)
            queue = queue_aliases.get(alias)
            if queue:
                _producer(program, source, "BULLMQ", queue, match.start())
        for (boundary, topic), handlers in kafka_topics.items():
            if not any(m.group(1) == boundary and m.group(2) == topic for m in _KAFKA_SUB_RE.finditer(source.text)):
                continue
            for handler in handlers:
                _boundary(program, symbols, source, "KAFKAJS", topic, handler, 0)
        for match in _KAFKA_SEND_RE.finditer(source.text):
            _, topic = match.groups()
            _producer(program, source, "KAFKAJS", topic, match.start())

    @staticmethod
    def _action_identity(value: str, action_types: dict[str, str]) -> str:
        raw = value.strip()
        if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
            return raw[1:-1]
        raw = raw.replace(".type", "")
        return action_types.get(raw, action_types.get(raw.split(".")[-1], ""))

    @staticmethod
    def _redux_event_key(identity: str) -> str:
        return f"event:redux:{identity}"

    @staticmethod
    def _di_key(namespace: str, identity: str) -> str:
        return f"js-di:{_safe(namespace)}:{_safe(identity)}"

    @staticmethod
    def _registry_key(namespace: str, identity: str) -> str:
        return f"js-registry:{_safe(namespace)}:{_safe(identity)}"


def _boundary(
    program: SemanticProgram,
    symbols: dict[str, list[tuple[str, str, int]]],
    source: _Source,
    framework: str,
    identity: str,
    handler: str,
    offset: int,
) -> None:
    queue_key = f"queue:{framework.lower()}:{identity}"
    program.add_node(SemanticNodeFact(queue_key, "QUEUE", identity, attributes={"frameworkBoundary": framework}))
    targets = symbols.get(handler, [])
    if len(targets) == 1:
        program.add_edge(SemanticEdgeFact("CONSUMES_FROM_QUEUE", queue_key, targets[0][0]))
    else:
        _mark_unresolved(program, framework, identity, queue_key, "CONSUMES_FROM_QUEUE", source.rel, _line(source.text, offset))


def _producer(program: SemanticProgram, source: _Source, framework: str, identity: str, offset: int) -> None:
    line = _line(source.text, offset)
    call_key = f"call:{source.rel}:{line}:{framework.lower()}:{_safe(identity)}"
    queue_key = f"queue:{framework.lower()}:{identity}"
    program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{framework} publish", source.rel, line, line, attributes={"frameworkBoundary": framework}))
    program.add_node(SemanticNodeFact(queue_key, "QUEUE", identity, attributes={"frameworkBoundary": framework}))
    program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
    program.add_edge(SemanticEdgeFact("PUBLISHES_TO_QUEUE", call_key, queue_key))


def _mark_unresolved(
    program: SemanticProgram,
    boundary: str,
    identity: str,
    source_key: str,
    edge_type: str,
    file_path: str | None = None,
    line: int | None = None,
) -> None:
    key = f"framework-unresolved:{_safe(boundary)}:{_safe(identity)}:{source_key}"
    program.add_node(
        SemanticNodeFact(
            key,
            "UNRESOLVED_DYNAMIC_TARGET",
            f"{boundary}:{identity}",
            file_path,
            line,
            line,
            attributes={"frameworkBoundary": boundary, "boundaryIdentity": identity, "resolutionState": "UNRESOLVED"},
            coverage_state="LIMITED",
        )
    )
    program.add_edge(SemanticEdgeFact(edge_type, source_key, key, attributes={"frameworkBoundary": boundary}, coverage_state="LIMITED"))
    if key not in program.unresolved_frontiers:
        program.unresolved_frontiers.append(key)


def _identity(value: str) -> str:
    raw = value.strip()
    if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
        return raw[1:-1]
    return raw.replace("Symbol.for(", "").replace(")", "").strip().split(".")[-1]


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:/-]+", "_", value)[:160] or "unknown"


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, max(0, offset)) + 1
