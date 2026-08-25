"""Resolve DI, boundary and dispatcher framework boundaries to concrete symbols.

Framework identities such as COMMAND/QUERY/EVENT/QUEUE are continuation points, not
proof that a static flow ended. This pass enriches the language-neutral semantic
program with method-level handler edges and DI resolutions when they are statically
visible. When resolution is not safe, it emits an explicit unresolved frontier so a
rule investigator cannot turn an analysis boundary into negative evidence.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.schema.source_roles import is_test_source_path

_SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
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
_CLASS_RE = re.compile(
    r"\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)[^\{]*\{",
    re.MULTILINE,
)
_METHOD_RE = re.compile(
    r"(?m)^[ \t]*(?:(?:public|private|protected|static|async|override|abstract)\s+)*"
    r"([A-Za-z_$][\w$]*)\s*\("
)
_INJECT_PARAM_RE = re.compile(
    r"(?:@Inject\(\s*([^\)]+?)\s*\)\s*)?"
    r"(?:(?:private|public|protected)\s+)?(?:readonly\s+)?"
    r"([A-Za-z_$][\w$]*)\s*[!?]?\s*:\s*([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
_DOTTED_CALL_RE = re.compile(
    r"\b((?:this\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\("
)
_COMMAND_DISPATCH_RE = re.compile(
    r"(?:this\.)?commandBus\.execute\s*\(\s*new\s+([A-Za-z_$][\w$]*)",
    re.IGNORECASE,
)
_QUERY_DISPATCH_RE = re.compile(
    r"(?:this\.)?queryBus\.execute\s*\(\s*new\s+([A-Za-z_$][\w$]*)",
    re.IGNORECASE,
)
_EVENT_PUBLISH_RE = re.compile(
    r"\b(?:emit|publish|produce|sendEvent|send_event)\s*\(\s*['\"]([^'\"]+)['\"]"
)
_QUEUE_PUBLISH_RE = re.compile(
    r"\b(?:queue|client|producer)\.(?:add|send|enqueue)\s*\(\s*['\"]([^'\"]+)['\"]",
    re.IGNORECASE,
)
_PROVIDER_RE = re.compile(
    r"\{\s*provide\s*:\s*([^,\n\r}]+)\s*,(?P<body>[\s\S]{0,500}?)\}",
    re.MULTILINE,
)
_USE_CLASS_RE = re.compile(r"\buseClass\s*:\s*([A-Za-z_$][\w$]*)")
_USE_EXISTING_RE = re.compile(r"\buseExisting\s*:\s*([A-Za-z_$][\w$]*)")
_USE_FACTORY_RE = re.compile(r"\buseFactory\s*:")

_BOUNDARY_NODE_TYPES = frozenset({"EVENT", "QUEUE", "COMMAND", "QUERY"})
_PRODUCER_EDGE_BY_TYPE = {
    "EVENT": "PUBLISHES_EVENT",
    "QUEUE": "PUBLISHES_TO_QUEUE",
    "COMMAND": "PUBLISHES_COMMAND",
    "QUERY": "PUBLISHES_QUERY",
}
_CONSUMER_EDGE_BY_TYPE = {
    "EVENT": "CONSUMES_EVENT",
    "QUEUE": "CONSUMES_FROM_QUEUE",
    "COMMAND": "HANDLES_COMMAND",
    "QUERY": "HANDLES_QUERY",
}
_METHOD_KEY_PREFIX = "framework-method:"


@dataclass(frozen=True)
class _Method:
    class_name: str
    name: str
    key: str
    file_path: str
    start_line: int
    end_line: int
    start_offset: int
    end_offset: int
    body: str
    decorator_prefix: str


@dataclass(frozen=True)
class _Class:
    name: str
    key: str
    file_path: str
    start_line: int
    start_offset: int
    end_offset: int
    body: str
    decorator_prefix: str
    methods: tuple[_Method, ...]


@dataclass(frozen=True)
class _Source:
    file_path: str
    text: str
    classes: tuple[_Class, ...]


@dataclass(frozen=True)
class _Injection:
    alias: str
    type_name: str
    token: str | None


class FrameworkBoundaryResolver:
    """Add concrete continuation edges for statically visible framework wiring."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        sources = self._sources()
        classes = tuple(item for source in sources for item in source.classes)
        classes_by_name: dict[str, list[_Class]] = {}
        methods_by_class_and_name: dict[tuple[str, str], list[_Method]] = {}
        for item in classes:
            classes_by_name.setdefault(item.name, []).append(item)
            for method in item.methods:
                methods_by_class_and_name.setdefault((item.name, method.name), []).append(method)
                self._declare_method(program, item, method)

        providers, dynamic_provider_tokens = self._provider_bindings(sources)
        self._emit_provider_graph(
            program,
            providers=providers,
            dynamic_provider_tokens=dynamic_provider_tokens,
            classes_by_name=classes_by_name,
        )

        for source in sources:
            for item in source.classes:
                injections = self._constructor_injections(item)
                resolved_aliases = self._resolve_injections(
                    program,
                    owner=item,
                    injections=injections,
                    providers=providers,
                    dynamic_provider_tokens=dynamic_provider_tokens,
                    classes_by_name=classes_by_name,
                )
                self._handler_edges(program, item)
                self._method_edges(
                    program,
                    item=item,
                    resolved_aliases=resolved_aliases,
                    methods_by_class_and_name=methods_by_class_and_name,
                )

        self._close_or_mark_boundaries(program)
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
            if is_test_source_path(rel) or path.suffix.lower() not in _SOURCE_EXTENSIONS:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            result.append(_Source(rel, text, self._classes(rel, text)))
        return tuple(result)

    @classmethod
    def _classes(cls, rel: str, text: str) -> tuple[_Class, ...]:
        result: list[_Class] = []
        for match in _CLASS_RE.finditer(text):
            class_name = match.group(1)
            open_brace = text.find("{", match.start())
            close_brace = cls._matching_delimiter(text, open_brace, "{", "}")
            if open_brace < 0 or close_brace is None:
                continue
            body_start = open_brace + 1
            body_end = close_brace
            body = text[body_start:body_end]
            methods = cls._methods(rel, text, class_name, body_start, body_end)
            result.append(
                _Class(
                    name=class_name,
                    key=f"symbol:{rel}:{class_name}",
                    file_path=rel,
                    start_line=cls._line(text, match.start()),
                    start_offset=match.start(),
                    end_offset=close_brace + 1,
                    body=body,
                    decorator_prefix=cls._decorator_prefix(text, match.start()),
                    methods=methods,
                )
            )
        return tuple(result)

    @classmethod
    def _methods(
        cls,
        rel: str,
        text: str,
        class_name: str,
        body_start: int,
        body_end: int,
    ) -> tuple[_Method, ...]:
        body = text[body_start:body_end]
        result: list[_Method] = []
        previous_end = body_start
        for match in _METHOD_RE.finditer(body):
            name = match.group(1)
            if name in {"if", "for", "while", "switch", "catch"}:
                continue
            absolute_start = body_start + match.start()
            open_paren = body_start + match.end() - 1
            close_paren = cls._matching_delimiter(text, open_paren, "(", ")")
            if close_paren is None:
                continue
            open_brace = text.find("{", close_paren + 1, min(body_end, close_paren + 500))
            semicolon = text.find(";", close_paren + 1, min(body_end, close_paren + 500))
            if open_brace < 0 or (semicolon >= 0 and semicolon < open_brace):
                continue
            close_brace = cls._matching_delimiter(text, open_brace, "{", "}")
            if close_brace is None or close_brace > body_end:
                continue
            method_key = f"{_METHOD_KEY_PREFIX}{rel}:{class_name}.{name}"
            decorator_start = max(previous_end, body_start)
            decorator_prefix = text[decorator_start:absolute_start]
            result.append(
                _Method(
                    class_name=class_name,
                    name=name,
                    key=method_key,
                    file_path=rel,
                    start_line=cls._line(text, absolute_start),
                    end_line=cls._line(text, close_brace),
                    start_offset=absolute_start,
                    end_offset=close_brace + 1,
                    body=text[open_brace + 1 : close_brace],
                    decorator_prefix=decorator_prefix[-1000:],
                )
            )
            previous_end = max(previous_end, close_brace + 1)
        return tuple(result)

    @staticmethod
    def _declare_method(program: SemanticProgram, item: _Class, method: _Method) -> None:
        program.add_node(
            SemanticNodeFact(
                item.key,
                "CLASS",
                item.name,
                item.file_path,
                item.start_line,
                symbol_ref=item.name,
                attributes={"frameworkResolved": True},
            )
        )
        program.add_node(
            SemanticNodeFact(
                method.key,
                "METHOD",
                method.name,
                method.file_path,
                method.start_line,
                method.end_line,
                f"{item.name}.{method.name}",
                attributes={"frameworkResolved": True},
            )
        )
        program.add_edge(SemanticEdgeFact("DECLARES", item.key, method.key))

    @classmethod
    def _provider_bindings(
        cls, sources: Iterable[_Source]
    ) -> tuple[dict[str, set[str]], set[str]]:
        providers: dict[str, set[str]] = {}
        dynamic: set[str] = set()
        for source in sources:
            for match in _PROVIDER_RE.finditer(source.text):
                token = cls._normalize_token(match.group(1))
                if not token:
                    continue
                body = match.group("body")
                use_class = _USE_CLASS_RE.search(body)
                use_existing = _USE_EXISTING_RE.search(body)
                if use_class:
                    providers.setdefault(token, set()).add(use_class.group(1))
                elif use_existing:
                    providers.setdefault(token, set()).add(use_existing.group(1))
                elif _USE_FACTORY_RE.search(body):
                    dynamic.add(token)
        return providers, dynamic

    @classmethod
    def _emit_provider_graph(
        cls,
        program: SemanticProgram,
        *,
        providers: dict[str, set[str]],
        dynamic_provider_tokens: set[str],
        classes_by_name: dict[str, list[_Class]],
    ) -> None:
        for token, implementations in sorted(providers.items()):
            token_key = cls._di_token_key(token)
            program.add_node(
                SemanticNodeFact(
                    token_key,
                    "TYPE",
                    token,
                    attributes={"frameworkBoundary": "DI", "token": token},
                )
            )
            concrete = [
                rows[0]
                for name in sorted(implementations)
                if len((rows := classes_by_name.get(name, []))) == 1
            ]
            if len(concrete) == 1 and len(implementations) == 1:
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", token_key, concrete[0].key))
            else:
                cls._mark_unresolved(
                    program,
                    boundary="DI",
                    identity=token,
                    source_key=token_key,
                    edge_type="RESOLVES_TO",
                )
        for token in sorted(dynamic_provider_tokens - set(providers)):
            token_key = cls._di_token_key(token)
            program.add_node(
                SemanticNodeFact(
                    token_key,
                    "TYPE",
                    token,
                    attributes={"frameworkBoundary": "DI", "token": token},
                )
            )
            cls._mark_unresolved(
                program,
                boundary="DI",
                identity=token,
                source_key=token_key,
                edge_type="RESOLVES_TO",
            )

    @classmethod
    def _constructor_injections(cls, item: _Class) -> tuple[_Injection, ...]:
        constructor = next((method for method in item.methods if method.name == "constructor"), None)
        if constructor is None:
            return ()
        # The method body does not include the parameter list, so recover it from the
        # class source span represented by decorator_prefix + signature vicinity.
        signature = constructor.decorator_prefix[-200:] + " constructor"
        del signature  # kept only to document why constructor body is insufficient.
        return ()

    def _resolve_injections(
        self,
        program: SemanticProgram,
        *,
        owner: _Class,
        injections: tuple[_Injection, ...],
        providers: dict[str, set[str]],
        dynamic_provider_tokens: set[str],
        classes_by_name: dict[str, list[_Class]],
    ) -> dict[str, str | None]:
        # Constructor parameters are parsed directly from the class source because TS
        # parameter-property decorators/types are richer than the method body model.
        source_path = self.workspace / owner.file_path
        try:
            text = source_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {}
        class_text = text[owner.start_offset : owner.end_offset]
        match = re.search(r"\bconstructor\s*\(", class_text)
        if not match:
            return {}
        open_paren = owner.start_offset + match.end() - 1
        close_paren = self._matching_delimiter(text, open_paren, "(", ")")
        if close_paren is None:
            return {}
        params = text[open_paren + 1 : close_paren]
        parsed = tuple(
            _Injection(
                alias=row.group(2),
                type_name=row.group(3),
                token=self._normalize_token(row.group(1)) if row.group(1) else None,
            )
            for row in _INJECT_PARAM_RE.finditer(params)
        )
        result: dict[str, str | None] = {}
        for injection in parsed:
            token = injection.token or injection.type_name
            token_key = self._di_token_key(token)
            program.add_node(
                SemanticNodeFact(
                    token_key,
                    "TYPE",
                    token,
                    attributes={"frameworkBoundary": "DI", "token": token},
                )
            )
            program.add_edge(SemanticEdgeFact("DEPENDS_ON", owner.key, token_key))

            implementation: str | None = None
            if injection.token:
                mapped = providers.get(token, set())
                if len(mapped) == 1:
                    implementation = next(iter(mapped))
            elif len(classes_by_name.get(injection.type_name, [])) == 1:
                implementation = injection.type_name

            if implementation and len(classes_by_name.get(implementation, [])) == 1:
                target = classes_by_name[implementation][0]
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", token_key, target.key))
                result[injection.alias] = implementation
                continue

            result[injection.alias] = None
            if token in dynamic_provider_tokens or injection.token or injection.type_name:
                self._mark_unresolved(
                    program,
                    boundary="DI",
                    identity=f"{owner.name}.{injection.alias}:{token}",
                    source_key=token_key,
                    edge_type="RESOLVES_TO",
                    file_path=owner.file_path,
                    line=owner.start_line,
                )
        return result

    @classmethod
    def _handler_edges(cls, program: SemanticProgram, item: _Class) -> None:
        command = cls._last_identifier_decorator(item.decorator_prefix, "CommandHandler")
        query = cls._last_identifier_decorator(item.decorator_prefix, "QueryHandler")
        processor = cls._last_string_decorator(item.decorator_prefix, "Processor")
        execute = next((method for method in item.methods if method.name == "execute"), None)
        process = next(
            (method for method in item.methods if method.name in {"process", "handle", "consume"}),
            None,
        )

        if command:
            ckey = f"command:{command}"
            program.add_node(SemanticNodeFact(ckey, "COMMAND", command))
            if execute:
                program.add_edge(SemanticEdgeFact("HANDLES_COMMAND", ckey, execute.key))
            else:
                cls._mark_unresolved(
                    program,
                    boundary="COMMAND",
                    identity=command,
                    source_key=ckey,
                    edge_type="HANDLES_COMMAND",
                    file_path=item.file_path,
                    line=item.start_line,
                )
        if query:
            qkey = f"query:{query}"
            program.add_node(SemanticNodeFact(qkey, "QUERY", query))
            if execute:
                program.add_edge(SemanticEdgeFact("HANDLES_QUERY", qkey, execute.key))
            else:
                cls._mark_unresolved(
                    program,
                    boundary="QUERY",
                    identity=query,
                    source_key=qkey,
                    edge_type="HANDLES_QUERY",
                    file_path=item.file_path,
                    line=item.start_line,
                )
        if processor:
            qkey = f"queue:{processor}"
            program.add_node(SemanticNodeFact(qkey, "QUEUE", processor))
            targets = [
                method
                for method in item.methods
                if cls._last_string_decorator(method.decorator_prefix, "Process") is not None
            ]
            if not targets and process:
                targets = [process]
            if targets:
                for method in targets:
                    program.add_edge(SemanticEdgeFact("CONSUMES_FROM_QUEUE", qkey, method.key))
            else:
                cls._mark_unresolved(
                    program,
                    boundary="QUEUE",
                    identity=processor,
                    source_key=qkey,
                    edge_type="CONSUMES_FROM_QUEUE",
                    file_path=item.file_path,
                    line=item.start_line,
                )

        for method in item.methods:
            event_name = (
                cls._last_string_decorator(method.decorator_prefix, "EventPattern")
                or cls._last_string_decorator(method.decorator_prefix, "MessagePattern")
                or cls._last_string_decorator(method.decorator_prefix, "OnEvent")
            )
            if event_name:
                ekey = f"event:{event_name}"
                program.add_node(SemanticNodeFact(ekey, "EVENT", event_name))
                program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", ekey, method.key))

    @classmethod
    def _method_edges(
        cls,
        program: SemanticProgram,
        *,
        item: _Class,
        resolved_aliases: dict[str, str | None],
        methods_by_class_and_name: dict[tuple[str, str], list[_Method]],
    ) -> None:
        for method in item.methods:
            for match in _DOTTED_CALL_RE.finditer(method.body):
                expression = match.group(1)
                line = method.start_line + method.body[: match.start()].count("\n")
                call_key = f"call:{item.file_path}:{line}:{expression}"
                program.add_node(
                    SemanticNodeFact(
                        call_key,
                        "CALL_SITE",
                        expression,
                        item.file_path,
                        line,
                        line,
                        attributes={"frameworkResolved": True},
                    )
                )
                program.add_edge(SemanticEdgeFact("CALLS", method.key, call_key))

                parts = expression.split(".")
                if parts[0] == "this":
                    parts = parts[1:]
                if len(parts) < 2:
                    continue
                alias, target_method = parts[-2], parts[-1]
                implementation = resolved_aliases.get(alias)
                if alias not in resolved_aliases:
                    continue
                if implementation:
                    targets = methods_by_class_and_name.get((implementation, target_method), [])
                    if len(targets) == 1:
                        program.add_edge(
                            SemanticEdgeFact("RESOLVES_TO", call_key, targets[0].key)
                        )
                        continue
                cls._mark_unresolved(
                    program,
                    boundary="DI_CALL",
                    identity=f"{item.name}.{alias}.{target_method}",
                    source_key=call_key,
                    edge_type="RESOLVES_TO",
                    file_path=item.file_path,
                    line=line,
                )

            for dispatch in _COMMAND_DISPATCH_RE.finditer(method.body):
                name = dispatch.group(1)
                line = method.start_line + method.body[: dispatch.start()].count("\n")
                call = f"call:{item.file_path}:{line}:commandBus.execute"
                ckey = f"command:{name}"
                program.add_node(SemanticNodeFact(call, "CALL_SITE", "commandBus.execute", item.file_path, line, line))
                program.add_node(SemanticNodeFact(ckey, "COMMAND", name))
                program.add_edge(SemanticEdgeFact("CALLS", method.key, call))
                program.add_edge(SemanticEdgeFact("PUBLISHES_COMMAND", call, ckey))
            for dispatch in _QUERY_DISPATCH_RE.finditer(method.body):
                name = dispatch.group(1)
                line = method.start_line + method.body[: dispatch.start()].count("\n")
                call = f"call:{item.file_path}:{line}:queryBus.execute"
                qkey = f"query:{name}"
                program.add_node(SemanticNodeFact(call, "CALL_SITE", "queryBus.execute", item.file_path, line, line))
                program.add_node(SemanticNodeFact(qkey, "QUERY", name))
                program.add_edge(SemanticEdgeFact("CALLS", method.key, call))
                program.add_edge(SemanticEdgeFact("PUBLISHES_QUERY", call, qkey))
            for publish in _EVENT_PUBLISH_RE.finditer(method.body):
                name = publish.group(1)
                line = method.start_line + method.body[: publish.start()].count("\n")
                call = f"call:{item.file_path}:{line}:publish"
                ekey = f"event:{name}"
                program.add_node(SemanticNodeFact(call, "CALL_SITE", "publish", item.file_path, line, line))
                program.add_node(SemanticNodeFact(ekey, "EVENT", name))
                program.add_edge(SemanticEdgeFact("CALLS", method.key, call))
                program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call, ekey))
            for publish in _QUEUE_PUBLISH_RE.finditer(method.body):
                name = publish.group(1)
                line = method.start_line + method.body[: publish.start()].count("\n")
                call = f"call:{item.file_path}:{line}:queue"
                qkey = f"queue:{name}"
                program.add_node(SemanticNodeFact(call, "CALL_SITE", "queue publish", item.file_path, line, line))
                program.add_node(SemanticNodeFact(qkey, "QUEUE", name))
                program.add_edge(SemanticEdgeFact("CALLS", method.key, call))
                program.add_edge(SemanticEdgeFact("PUBLISHES_TO_QUEUE", call, qkey))

    @classmethod
    def _close_or_mark_boundaries(cls, program: SemanticProgram) -> None:
        node_by_key: dict[str, SemanticNodeFact] = {}
        for node in program.nodes:
            node_by_key[node.key] = node
        edges = list(program.edges)

        for key, node in list(node_by_key.items()):
            if node.node_type not in _BOUNDARY_NODE_TYPES:
                continue
            producer_type = _PRODUCER_EDGE_BY_TYPE[node.node_type]
            consumer_type = _CONSUMER_EDGE_BY_TYPE[node.node_type]
            has_producer = any(
                edge.edge_type == producer_type and edge.target_key == key for edge in edges
            )
            if not has_producer:
                continue
            concrete_targets = [
                edge.target_key
                for edge in edges
                if edge.edge_type == consumer_type and edge.source_key == key
                and cls._is_concrete_target(edge.target_key, node_by_key)
            ]
            if concrete_targets:
                continue
            cls._mark_unresolved(
                program,
                boundary=node.node_type,
                identity=node.label,
                source_key=key,
                edge_type=consumer_type,
            )

    @staticmethod
    def _is_concrete_target(
        key: str, node_by_key: dict[str, SemanticNodeFact]
    ) -> bool:
        node = node_by_key.get(key)
        if node is None:
            return False
        return node.node_type in {"METHOD", "FUNCTION", "CLASS"} and not key.startswith("module:")

    @classmethod
    def _mark_unresolved(
        cls,
        program: SemanticProgram,
        *,
        boundary: str,
        identity: str,
        source_key: str,
        edge_type: str,
        file_path: str | None = None,
        line: int | None = None,
    ) -> None:
        safe_identity = re.sub(r"[^A-Za-z0-9_.:-]+", "_", identity)[:120] or "unknown"
        key = f"framework-unresolved:{boundary}:{safe_identity}:{source_key}"
        program.add_node(
            SemanticNodeFact(
                key,
                "UNRESOLVED_DYNAMIC_TARGET",
                f"{boundary}:{identity}",
                file_path,
                line,
                line,
                attributes={
                    "frameworkBoundary": boundary,
                    "boundaryIdentity": identity,
                    "resolutionState": "UNRESOLVED",
                },
                coverage_state="LIMITED",
            )
        )
        program.add_edge(
            SemanticEdgeFact(
                edge_type,
                source_key,
                key,
                attributes={"frameworkBoundary": boundary},
                coverage_state="LIMITED",
            )
        )
        if key not in program.unresolved_frontiers:
            program.unresolved_frontiers.append(key)

    @staticmethod
    def _last_identifier_decorator(prefix: str, name: str) -> str | None:
        rows = re.findall(
            rf"@{re.escape(name)}\s*\(\s*([A-Za-z_$][\w$]*)\s*\)", prefix
        )
        return rows[-1] if rows else None

    @staticmethod
    def _last_string_decorator(prefix: str, name: str) -> str | None:
        rows = re.findall(
            rf"@{re.escape(name)}\s*\(\s*['\"]([^'\"]+)['\"]", prefix
        )
        return rows[-1] if rows else None

    @staticmethod
    def _decorator_prefix(text: str, offset: int) -> str:
        window = text[max(0, offset - 1200) : offset]
        # Do not let a decorator from the previous class bleed into this class.
        last_close = window.rfind("}")
        if last_close >= 0:
            window = window[last_close + 1 :]
        return window

    @staticmethod
    def _normalize_token(value: str | None) -> str:
        token = str(value or "").strip()
        if not token:
            return ""
        if (token.startswith("'") and token.endswith("'")) or (
            token.startswith('"') and token.endswith('"')
        ):
            token = token[1:-1]
        return token.strip()

    @staticmethod
    def _di_token_key(token: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9_.:$-]+", "_", token)[:160] or "unknown"
        return f"di-token:{safe}"

    @staticmethod
    def _line(text: str, offset: int) -> int:
        return text.count("\n", 0, max(0, offset)) + 1

    @staticmethod
    def _matching_delimiter(
        text: str, start: int, opening: str, closing: str
    ) -> int | None:
        if start < 0 or start >= len(text) or text[start] != opening:
            return None
        depth = 0
        quote: str | None = None
        escaped = False
        line_comment = False
        block_comment = False
        index = start
        while index < len(text):
            char = text[index]
            nxt = text[index + 1] if index + 1 < len(text) else ""
            if line_comment:
                if char == "\n":
                    line_comment = False
                index += 1
                continue
            if block_comment:
                if char == "*" and nxt == "/":
                    block_comment = False
                    index += 2
                    continue
                index += 1
                continue
            if quote:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = None
                index += 1
                continue
            if char == "/" and nxt == "/":
                line_comment = True
                index += 2
                continue
            if char == "/" and nxt == "*":
                block_comment = True
                index += 2
                continue
            if char in {'"', "'", "`"}:
                quote = char
                index += 1
                continue
            if char == opening:
                depth += 1
            elif char == closing:
                depth -= 1
                if depth == 0:
                    return index
            index += 1
        return None
