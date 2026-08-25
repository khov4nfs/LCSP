"""Resolve common JVM/Spring and .NET architecture boundaries.

These ecosystems frequently hide control flow behind dependency injection, mediator
buses, annotations/attributes and broker listeners. This pass records exact static
continuations and marks ambiguous wiring unresolved rather than allowing graph walks to
terminate silently at the framework boundary.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.schema.source_roles import is_test_source_path

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
    "target",
    "bin",
    "obj",
}
_JVM_EXTENSIONS = {".java", ".kt", ".kts"}
_DOTNET_EXTENSIONS = {".cs"}
_CLASS_RE = re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)")
_JVM_METHOD_RE = re.compile(
    r"(?m)^\s*(?:public|protected|private|static|final|synchronized|abstract|open|override|suspend|inline|internal|fun|\s)+\s*"
    r"(?:[A-Za-z_$][\w$<>,.?\[\] ]*\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^\{]+)?\{"
)
_CSHARP_METHOD_RE = re.compile(
    r"(?m)^\s*(?:public|protected|private|internal|static|virtual|override|async|sealed|partial|\s)+\s*"
    r"[A-Za-z_$][\w$<>,.?\[\] ]+\s+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{"
)
_SPRING_EVENT_LISTENER_RE = re.compile(r"@EventListener(?:\s*\(\s*([A-Za-z_$][\w$]*)\.class\s*\))?")
_SPRING_KAFKA_RE = re.compile(r"@KafkaListener\s*\([^)]*?topics\s*=\s*['\"]([^'\"]+)['\"]", re.DOTALL)
_SPRING_RABBIT_RE = re.compile(r"@RabbitListener\s*\([^)]*?queues\s*=\s*['\"]([^'\"]+)['\"]", re.DOTALL)
_SPRING_MAPPING_RE = re.compile(r"@(Get|Post|Put|Patch|Delete)Mapping\s*(?:\(\s*['\"]([^'\"]*)['\"])?", re.IGNORECASE)
_SPRING_PUBLISH_EVENT_RE = re.compile(r"\b[A-Za-z_$][\w$]*\.publishEvent\s*\(\s*new\s+([A-Za-z_$][\w$]*)")
_SPRING_KAFKA_SEND_RE = re.compile(r"\b[A-Za-z_$][\w$]*\.send\s*\(\s*['\"]([^'\"]+)['\"]")
_SPRING_RABBIT_SEND_RE = re.compile(r"\b[A-Za-z_$][\w$]*\.convertAndSend\s*\(\s*['\"]([^'\"]+)['\"]")
_AUTOWIRED_FIELD_RE = re.compile(
    r"@(?:Autowired|Inject)\s*(?:\r?\n\s*)?(?:private|protected|public)?\s*(?:final\s+)?([A-Za-z_$][\w$]*)\s+([A-Za-z_$][\w$]*)\s*;"
)
_JVM_CONSTRUCTOR_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{")
_PARAM_RE = re.compile(r"(?:@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s*)*(?:final\s+)?([A-Za-z_$][\w$<>,.?\[\]]*)\s+([A-Za-z_$][\w$]*)")
_FIELD_CALL_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(")
_DOTNET_DI_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.Add(?:Scoped|Singleton|Transient)\s*<\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*>\s*\("
)
_DOTNET_DI_SELF_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.Add(?:Scoped|Singleton|Transient)\s*<\s*([A-Za-z_$][\w$]*)\s*>\s*\("
)
_DOTNET_GET_SERVICE_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.GetRequiredService\s*<\s*([A-Za-z_$][\w$]*)\s*>\s*\("
)
_MEDIATR_SEND_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\.Send\s*\(\s*new\s+([A-Za-z_$][\w$]*)")
_MEDIATR_HANDLER_RE = re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)[^:{]*:\s*[^\{]*IRequestHandler\s*<\s*([A-Za-z_$][\w$]*)")
_MASSTRANSIT_HANDLER_RE = re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)[^:{]*:\s*[^\{]*IConsumer\s*<\s*([A-Za-z_$][\w$]*)")
_MASSTRANSIT_PUBLISH_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\.Publish\s*\(\s*new\s+([A-Za-z_$][\w$]*)")
_ASPNET_ROUTE_RE = re.compile(r"\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*['\"]([^'\"]*)['\"]\s*\))?\]", re.IGNORECASE)
_GENERIC_REGISTER_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.(?:register|Register|bind|Bind)\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*([A-Za-z_$][\w$]*)"
)
_GENERIC_DISPATCH_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.(?:dispatch|Dispatch|execute|Execute)\s*\(\s*['\"]([^'\"]+)['\"]"
)


@dataclass(frozen=True)
class _Source:
    rel: str
    text: str
    language: str


@dataclass(frozen=True)
class _Method:
    name: str
    key: str
    rel: str
    line: int
    offset: int


class ManagedArchitectureResolver:
    """Resolve Spring/JVM and .NET framework boundaries plus conservative registries."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        sources = self._sources()
        classes = self._classes(sources)
        methods = self._methods(sources)
        dotnet_bindings = self._dotnet_bindings(sources)
        generic_bindings = self._generic_bindings(sources)

        self._emit_dotnet_bindings(program, dotnet_bindings, classes)
        self._emit_generic_bindings(program, generic_bindings, classes, methods)

        for source in sources:
            if source.language == "JVM":
                self._spring(program, source, classes, methods)
            else:
                self._dotnet(program, source, classes, methods, dotnet_bindings)
            self._generic_dispatch(program, source, generic_bindings)
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
            if is_test_source_path(rel):
                continue
            suffix = path.suffix.lower()
            language = "JVM" if suffix in _JVM_EXTENSIONS else "DOTNET" if suffix in _DOTNET_EXTENSIONS else ""
            if not language:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            result.append(_Source(rel, text, language))
        return tuple(result)

    @staticmethod
    def _classes(sources: Iterable[_Source]) -> dict[str, list[tuple[str, str, int]]]:
        result: dict[str, list[tuple[str, str, int]]] = {}
        for source in sources:
            for match in _CLASS_RE.finditer(source.text):
                name = match.group(1)
                result.setdefault(name, []).append((f"symbol:{source.rel}:{name}", source.rel, _line(source.text, match.start())))
        return result

    @staticmethod
    def _methods(sources: Iterable[_Source]) -> dict[tuple[str, str], list[_Method]]:
        result: dict[tuple[str, str], list[_Method]] = {}
        for source in sources:
            regex = _JVM_METHOD_RE if source.language == "JVM" else _CSHARP_METHOD_RE
            class_spans = _class_spans(source.text)
            for match in regex.finditer(source.text):
                name = match.group(1)
                owner = _class_at_offset(class_spans, match.start()) or "Module"
                method = _Method(
                    name,
                    f"managed-method:{source.rel}:{owner}.{name}:{_line(source.text, match.start())}",
                    source.rel,
                    _line(source.text, match.start()),
                    match.start(),
                )
                result.setdefault((owner, name), []).append(method)
        return result

    @staticmethod
    def _dotnet_bindings(sources: Iterable[_Source]) -> dict[tuple[str, str], set[str]]:
        result: dict[tuple[str, str], set[str]] = {}
        for source in sources:
            if source.language != "DOTNET":
                continue
            for match in _DOTNET_DI_RE.finditer(source.text):
                result.setdefault((match.group(1), match.group(2)), set()).add(match.group(3))
            for match in _DOTNET_DI_SELF_RE.finditer(source.text):
                result.setdefault((match.group(1), match.group(2)), set()).add(match.group(2))
        return result

    @staticmethod
    def _generic_bindings(sources: Iterable[_Source]) -> dict[tuple[str, str], set[str]]:
        result: dict[tuple[str, str], set[str]] = {}
        for source in sources:
            for match in _GENERIC_REGISTER_RE.finditer(source.text):
                result.setdefault((match.group(1), match.group(2)), set()).add(match.group(3))
        return result

    @classmethod
    def _emit_dotnet_bindings(
        cls,
        program: SemanticProgram,
        bindings: dict[tuple[str, str], set[str]],
        classes: dict[str, list[tuple[str, str, int]]],
    ) -> None:
        for (namespace, identity), implementations in sorted(bindings.items()):
            key = cls._di_key(namespace, identity)
            program.add_node(SemanticNodeFact(key, "TYPE", identity, attributes={"frameworkBoundary": "DOTNET_DI", "bindingKey": identity, "namespace": namespace}))
            targets = [rows[0][0] for name in implementations if len((rows := classes.get(name, []))) == 1]
            if len(targets) == 1 and len(implementations) == 1:
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, targets[0]))
            else:
                _mark_unresolved(program, "DOTNET_DI", f"{namespace}:{identity}", key, "RESOLVES_TO")

    @classmethod
    def _emit_generic_bindings(
        cls,
        program: SemanticProgram,
        bindings: dict[tuple[str, str], set[str]],
        classes: dict[str, list[tuple[str, str, int]]],
        methods: dict[tuple[str, str], list[_Method]],
    ) -> None:
        del methods
        for (namespace, identity), targets in sorted(bindings.items()):
            key = cls._registry_key(namespace, identity)
            program.add_node(SemanticNodeFact(key, "TYPE", identity, attributes={"frameworkBoundary": "GENERIC_REGISTRY", "bindingKey": identity, "namespace": namespace}))
            resolved = [rows[0][0] for name in targets if len((rows := classes.get(name, []))) == 1]
            if len(resolved) == 1 and len(targets) == 1:
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, resolved[0]))
            else:
                _mark_unresolved(program, "GENERIC_REGISTRY", f"{namespace}:{identity}", key, "RESOLVES_TO")

    @classmethod
    def _spring(
        cls,
        program: SemanticProgram,
        source: _Source,
        classes: dict[str, list[tuple[str, str, int]]],
        methods: dict[tuple[str, str], list[_Method]],
    ) -> None:
        class_spans = _class_spans(source.text)
        source_methods = sorted(
            [method for rows in methods.values() for method in rows if method.rel == source.rel],
            key=lambda value: value.offset,
        )
        for method in source_methods:
            program.add_node(SemanticNodeFact(method.key, "METHOD", method.name, method.rel, method.line, method.line, method.name, attributes={"frameworkResolved": True, "ecosystem": "SPRING"}))
            prefix = source.text[max(0, method.offset - 1600) : method.offset]
            event_match = list(_SPRING_EVENT_LISTENER_RE.finditer(prefix))
            if event_match:
                event_type = event_match[-1].group(1) or f"{method.name}:parameter-event"
                ekey = f"event:spring:{event_type}"
                program.add_node(SemanticNodeFact(ekey, "EVENT", event_type, attributes={"frameworkBoundary": "SPRING_EVENT"}))
                if event_match[-1].group(1):
                    program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", ekey, method.key))
                else:
                    _mark_unresolved(program, "SPRING_EVENT", event_type, ekey, "CONSUMES_EVENT", source.rel, method.line)

            kafka = list(_SPRING_KAFKA_RE.finditer(prefix))
            if kafka:
                qkey = f"queue:kafka:{kafka[-1].group(1)}"
                program.add_node(SemanticNodeFact(qkey, "QUEUE", kafka[-1].group(1), attributes={"frameworkBoundary": "SPRING_KAFKA"}))
                program.add_edge(SemanticEdgeFact("CONSUMES_FROM_QUEUE", qkey, method.key))
            rabbit = list(_SPRING_RABBIT_RE.finditer(prefix))
            if rabbit:
                qkey = f"queue:rabbit:{rabbit[-1].group(1)}"
                program.add_node(SemanticNodeFact(qkey, "QUEUE", rabbit[-1].group(1), attributes={"frameworkBoundary": "SPRING_RABBIT"}))
                program.add_edge(SemanticEdgeFact("CONSUMES_FROM_QUEUE", qkey, method.key))
            route = list(_SPRING_MAPPING_RE.finditer(prefix))
            if route:
                verb = route[-1].group(1).upper()
                path = route[-1].group(2) or ""
                rkey = f"http-route:{verb}:{path or '/'}"
                program.add_node(SemanticNodeFact(rkey, "HTTP_ROUTE", f"{verb} {path or '/'}", attributes={"method": verb, "route": path or "/", "frameworkBoundary": "SPRING_WEB"}))
                program.add_edge(SemanticEdgeFact("HANDLED_BY", rkey, method.key))

        # Spring constructor/field DI. Exact type resolution is enough to continue a
        # later field method call; duplicate classes remain unresolved.
        alias_bindings: dict[str, str] = {}
        for match in _AUTOWIRED_FIELD_RE.finditer(source.text):
            type_name, alias = match.groups()
            alias_bindings[alias] = type_name
            cls._emit_type_resolution(program, "SPRING_DI", type_name, classes, source.rel, _line(source.text, match.start()))
        for class_name, start, end in class_spans:
            class_body = source.text[start:end]
            for ctor in _JVM_CONSTRUCTOR_RE.finditer(class_body):
                if ctor.group(1) != class_name:
                    continue
                for param in _PARAM_RE.finditer(ctor.group(2)):
                    type_name, alias = param.groups()
                    alias_bindings[alias] = _strip_generics(type_name)
                    cls._emit_type_resolution(program, "SPRING_DI", _strip_generics(type_name), classes, source.rel, _line(source.text, start + ctor.start()))

        for match in _FIELD_CALL_RE.finditer(source.text):
            alias, method_name = match.groups()
            type_name = alias_bindings.get(alias)
            if not type_name:
                continue
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:spring-di:{alias}.{method_name}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{alias}.{method_name}", source.rel, line, line, attributes={"frameworkBoundary": "SPRING_DI"}))
            targets = methods.get((type_name, method_name), [])
            if len(targets) == 1:
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", call_key, targets[0].key))
            else:
                _mark_unresolved(program, "SPRING_DI_CALL", f"{type_name}.{method_name}", call_key, "RESOLVES_TO", source.rel, line)

        for match in _SPRING_PUBLISH_EVENT_RE.finditer(source.text):
            identity = match.group(1)
            _event_producer(program, source, "SPRING_EVENT", identity, match.start(), f"event:spring:{identity}")
        for match in _SPRING_KAFKA_SEND_RE.finditer(source.text):
            _queue_producer(program, source, "SPRING_KAFKA", match.group(1), match.start(), f"queue:kafka:{match.group(1)}")
        for match in _SPRING_RABBIT_SEND_RE.finditer(source.text):
            _queue_producer(program, source, "SPRING_RABBIT", match.group(1), match.start(), f"queue:rabbit:{match.group(1)}")

    @classmethod
    def _dotnet(
        cls,
        program: SemanticProgram,
        source: _Source,
        classes: dict[str, list[tuple[str, str, int]]],
        methods: dict[tuple[str, str], list[_Method]],
        bindings: dict[tuple[str, str], set[str]],
    ) -> None:
        source_methods = sorted(
            [method for rows in methods.values() for method in rows if method.rel == source.rel],
            key=lambda value: value.offset,
        )
        for method in source_methods:
            program.add_node(SemanticNodeFact(method.key, "METHOD", method.name, method.rel, method.line, method.line, method.name, attributes={"frameworkResolved": True, "ecosystem": "DOTNET"}))
            prefix = source.text[max(0, method.offset - 1200) : method.offset]
            route = list(_ASPNET_ROUTE_RE.finditer(prefix))
            if route:
                verb = route[-1].group(1).upper()
                path = route[-1].group(2) or ""
                rkey = f"http-route:{verb}:{path or '/'}"
                program.add_node(SemanticNodeFact(rkey, "HTTP_ROUTE", f"{verb} {path or '/'}", attributes={"method": verb, "route": path or "/", "frameworkBoundary": "ASPNET"}))
                program.add_edge(SemanticEdgeFact("HANDLED_BY", rkey, method.key))

        for match in _MEDIATR_HANDLER_RE.finditer(source.text):
            handler_class, request = match.groups()
            targets = methods.get((handler_class, "Handle"), [])
            ckey = f"command:mediatr:{request}"
            program.add_node(SemanticNodeFact(ckey, "COMMAND", request, attributes={"frameworkBoundary": "MEDIATR"}))
            if len(targets) == 1:
                program.add_edge(SemanticEdgeFact("HANDLES_COMMAND", ckey, targets[0].key))
            else:
                _mark_unresolved(program, "MEDIATR", request, ckey, "HANDLES_COMMAND", source.rel, _line(source.text, match.start()))
        for match in _MEDIATR_SEND_RE.finditer(source.text):
            request = match.group(2)
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:mediatr:{request}"
            ckey = f"command:mediatr:{request}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", "mediator.Send", source.rel, line, line, attributes={"frameworkBoundary": "MEDIATR"}))
            program.add_node(SemanticNodeFact(ckey, "COMMAND", request, attributes={"frameworkBoundary": "MEDIATR"}))
            program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
            program.add_edge(SemanticEdgeFact("PUBLISHES_COMMAND", call_key, ckey))

        for match in _MASSTRANSIT_HANDLER_RE.finditer(source.text):
            handler_class, message = match.groups()
            targets = methods.get((handler_class, "Consume"), [])
            ekey = f"event:masstransit:{message}"
            program.add_node(SemanticNodeFact(ekey, "EVENT", message, attributes={"frameworkBoundary": "MASSTRANSIT"}))
            if len(targets) == 1:
                program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", ekey, targets[0].key))
            else:
                _mark_unresolved(program, "MASSTRANSIT", message, ekey, "CONSUMES_EVENT", source.rel, _line(source.text, match.start()))
        for match in _MASSTRANSIT_PUBLISH_RE.finditer(source.text):
            message = match.group(2)
            _event_producer(program, source, "MASSTRANSIT", message, match.start(), f"event:masstransit:{message}")

        for match in _DOTNET_GET_SERVICE_RE.finditer(source.text):
            namespace, identity = match.groups()
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:dotnet-di:{identity}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", "GetRequiredService", source.rel, line, line, attributes={"frameworkBoundary": "DOTNET_DI"}))
            program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
            matching = [(ns, name) for ns, name in bindings if name == identity]
            if len(matching) == 1:
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", call_key, cls._di_key(matching[0][0], identity)))
            else:
                _mark_unresolved(program, "DOTNET_DI", identity, call_key, "RESOLVES_TO", source.rel, line)

    @classmethod
    def _emit_type_resolution(
        cls,
        program: SemanticProgram,
        boundary: str,
        type_name: str,
        classes: dict[str, list[tuple[str, str, int]]],
        rel: str,
        line: int,
    ) -> None:
        key = f"managed-di:{_safe(type_name)}"
        program.add_node(SemanticNodeFact(key, "TYPE", type_name, rel, line, line, attributes={"frameworkBoundary": boundary, "bindingKey": type_name}))
        targets = classes.get(type_name, [])
        if len(targets) == 1:
            program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, targets[0][0]))
        else:
            _mark_unresolved(program, boundary, type_name, key, "RESOLVES_TO", rel, line)

    @classmethod
    def _generic_dispatch(
        cls,
        program: SemanticProgram,
        source: _Source,
        bindings: dict[tuple[str, str], set[str]],
    ) -> None:
        for match in _GENERIC_DISPATCH_RE.finditer(source.text):
            namespace, identity = match.groups()
            if (namespace, identity) not in bindings:
                continue
            line = _line(source.text, match.start())
            call_key = f"call:{source.rel}:{line}:managed-registry:{namespace}:{identity}"
            program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{namespace}.dispatch", source.rel, line, line, attributes={"frameworkBoundary": "GENERIC_REGISTRY"}))
            program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
            program.add_edge(SemanticEdgeFact("RESOLVES_TO", call_key, cls._registry_key(namespace, identity)))

    @staticmethod
    def _di_key(namespace: str, identity: str) -> str:
        return f"dotnet-di:{_safe(namespace)}:{_safe(identity)}"

    @staticmethod
    def _registry_key(namespace: str, identity: str) -> str:
        return f"managed-registry:{_safe(namespace)}:{_safe(identity)}"


def _event_producer(program: SemanticProgram, source: _Source, boundary: str, identity: str, offset: int, event_key: str) -> None:
    line = _line(source.text, offset)
    call_key = f"call:{source.rel}:{line}:{_safe(boundary)}:{_safe(identity)}"
    program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{boundary} publish", source.rel, line, line, attributes={"frameworkBoundary": boundary}))
    program.add_node(SemanticNodeFact(event_key, "EVENT", identity, attributes={"frameworkBoundary": boundary}))
    program.add_edge(SemanticEdgeFact("CALLS", f"module:{source.rel}", call_key))
    program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, event_key))


def _queue_producer(program: SemanticProgram, source: _Source, boundary: str, identity: str, offset: int, queue_key: str) -> None:
    line = _line(source.text, offset)
    call_key = f"call:{source.rel}:{line}:{_safe(boundary)}:{_safe(identity)}"
    program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{boundary} send", source.rel, line, line, attributes={"frameworkBoundary": boundary}))
    program.add_node(SemanticNodeFact(queue_key, "QUEUE", identity, attributes={"frameworkBoundary": boundary}))
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


def _class_spans(text: str) -> list[tuple[str, int, int]]:
    result: list[tuple[str, int, int]] = []
    for match in _CLASS_RE.finditer(text):
        open_brace = text.find("{", match.end())
        close_brace = _matching_brace(text, open_brace)
        if open_brace >= 0 and close_brace is not None:
            result.append((match.group(1), match.start(), close_brace + 1))
    return result


def _class_at_offset(spans: list[tuple[str, int, int]], offset: int) -> str | None:
    matches = [name for name, start, end in spans if start <= offset < end]
    return matches[-1] if matches else None


def _matching_brace(text: str, start: int) -> int | None:
    if start < 0 or start >= len(text) or text[start] != "{":
        return None
    depth = 0
    quote: str | None = None
    escaped = False
    index = start
    while index < len(text):
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char in {'"', "'"}:
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return None


def _strip_generics(value: str) -> str:
    return re.sub(r"<.*>", "", value).replace("?", "").replace("[]", "").strip()


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:/-]+", "_", value)[:160] or "unknown"


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, max(0, offset)) + 1
