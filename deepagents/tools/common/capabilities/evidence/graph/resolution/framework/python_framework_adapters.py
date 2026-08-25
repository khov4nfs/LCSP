"""Additional Python framework adapters for DI providers, pub/sub and task dispatch.

Covers dependency-injector's DeclarativeContainer/Provide wiring plus common task and
message patterns (RQ, Dramatiq, Faust and literal-key pub/sub). These adapters are
intentionally conservative: a target must be statically named and unique, otherwise an
UNRESOLVED_DYNAMIC_TARGET frontier is emitted.
"""
from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import Path

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
}
_PROVIDER_FACTORIES = {"Factory", "Singleton", "Resource", "Callable", "Coroutine", "Object"}
_PUBSUB_SUBSCRIBE = {"subscribe", "on", "listen"}
_PUBSUB_PUBLISH = {"publish", "emit", "send_event"}


@dataclass(frozen=True)
class _ProviderBinding:
    namespace: str
    identity: str
    target_name: str
    rel: str
    line: int


class PythonFrameworkAdapters:
    """Resolve dependency-injector and popular Python messaging/task abstractions."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        files = self._files()
        symbols = self._symbols(files)
        providers = self._provider_bindings(files)
        provider_map = {(item.namespace, item.identity): item for item in providers}
        for item in providers:
            self._emit_provider(program, item, symbols)

        pubsub_handlers = self._pubsub_handlers(files)
        for (namespace, identity), targets in pubsub_handlers.items():
            event_key = self._event_key(namespace, identity)
            program.add_node(
                SemanticNodeFact(
                    event_key,
                    "EVENT",
                    identity,
                    attributes={"frameworkBoundary": "PYTHON_PUBSUB", "namespace": namespace},
                )
            )
            if len(targets) == 1 and len(symbols.get(next(iter(targets)), [])) == 1:
                program.add_edge(
                    SemanticEdgeFact(
                        "CONSUMES_EVENT",
                        event_key,
                        symbols[next(iter(targets))][0][0],
                    )
                )
            else:
                _mark_unresolved(program, "PYTHON_PUBSUB", f"{namespace}:{identity}", event_key, "CONSUMES_EVENT")

        actors = self._background_handlers(files)
        for name, (framework, target_key, identity) in actors.items():
            queue_key = f"queue:{framework.lower()}:{identity}"
            program.add_node(
                SemanticNodeFact(queue_key, "QUEUE", identity, attributes={"frameworkBoundary": framework})
            )
            program.add_edge(SemanticEdgeFact("CONSUMES_FROM_QUEUE", queue_key, target_key))

        for rel, tree in files:
            _FrameworkVisitor(
                program=program,
                rel=rel,
                symbols=symbols,
                provider_map=provider_map,
                pubsub_handlers=pubsub_handlers,
                actors=actors,
            ).visit(tree)
        return program

    def _files(self) -> tuple[tuple[str, ast.Module], ...]:
        result: list[tuple[str, ast.Module]] = []
        for path in sorted(self.workspace.rglob("*.py")):
            if not path.is_file():
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
            try:
                tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=rel)
            except (OSError, SyntaxError):
                continue
            result.append((rel, tree))
        return tuple(result)

    @staticmethod
    def _symbols(files: tuple[tuple[str, ast.Module], ...]) -> dict[str, list[tuple[str, str, int]]]:
        result: dict[str, list[tuple[str, str, int]]] = {}
        for rel, tree in files:
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    result.setdefault(node.name, []).append(
                        (f"symbol:{rel}:{node.name}", rel, int(getattr(node, "lineno", 1)))
                    )
        return result

    @classmethod
    def _provider_bindings(cls, files: tuple[tuple[str, ast.Module], ...]) -> tuple[_ProviderBinding, ...]:
        result: list[_ProviderBinding] = []
        for rel, tree in files:
            for item in tree.body:
                if isinstance(item, ast.ClassDef):
                    result.extend(cls._provider_bindings_in_body(rel, item.name, item.body))
            result.extend(cls._provider_bindings_in_body(rel, "module", tree.body))
        return tuple(result)

    @staticmethod
    def _provider_bindings_in_body(
        rel: str,
        namespace: str,
        body: list[ast.stmt],
    ) -> list[_ProviderBinding]:
        result: list[_ProviderBinding] = []
        for node in body:
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if len(targets) != 1 or not isinstance(targets[0], ast.Name):
                continue
            value = node.value
            if not isinstance(value, ast.Call) or not isinstance(value.func, ast.Attribute):
                continue
            if value.func.attr not in _PROVIDER_FACTORIES or not value.args:
                continue
            if not _ast_name(value.func.value).endswith("providers"):
                continue
            target_name = _ast_name(value.args[0]).split(".")[-1]
            if not target_name:
                continue
            result.append(
                _ProviderBinding(
                    namespace,
                    targets[0].id,
                    target_name,
                    rel,
                    int(getattr(node, "lineno", 1)),
                )
            )
        return result

    @staticmethod
    def _pubsub_handlers(
        files: tuple[tuple[str, ast.Module], ...]
    ) -> dict[tuple[str, str], set[str]]:
        result: dict[tuple[str, str], set[str]] = {}
        for _, tree in files:
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                    continue
                if node.func.attr not in _PUBSUB_SUBSCRIBE or len(node.args) < 2:
                    continue
                namespace = _ast_name(node.func.value)
                identity = _literal(node.args[0])
                handler = _ast_name(node.args[1]).split(".")[-1]
                if namespace and identity and handler:
                    result.setdefault((namespace, identity), set()).add(handler)
        return result

    @staticmethod
    def _background_handlers(
        files: tuple[tuple[str, ast.Module], ...]
    ) -> dict[str, tuple[str, str, str]]:
        result: dict[str, tuple[str, str, str]] = {}
        for rel, tree in files:
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for decorator in node.decorator_list:
                    name = _ast_name(decorator.func if isinstance(decorator, ast.Call) else decorator)
                    if name.endswith("dramatiq.actor") or name == "actor":
                        identity = node.name
                        result[node.name] = ("DRAMATIQ", f"symbol:{rel}:{node.name}", identity)
                    elif isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute) and decorator.func.attr == "agent":
                        identity = _literal(decorator.args[0]) if decorator.args else ""
                        identity = identity or _ast_name(decorator.args[0]) if decorator.args else node.name
                        result[node.name] = ("FAUST", f"symbol:{rel}:{node.name}", str(identity))
        return result

    @classmethod
    def _emit_provider(
        cls,
        program: SemanticProgram,
        item: _ProviderBinding,
        symbols: dict[str, list[tuple[str, str, int]]],
    ) -> None:
        key = cls._provider_key(item.namespace, item.identity)
        program.add_node(
            SemanticNodeFact(
                key,
                "TYPE",
                f"{item.namespace}.{item.identity}",
                item.rel,
                item.line,
                item.line,
                attributes={
                    "frameworkBoundary": "DEPENDENCY_INJECTOR",
                    "bindingKey": item.identity,
                    "namespace": item.namespace,
                },
            )
        )
        targets = symbols.get(item.target_name, [])
        if len(targets) == 1:
            program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, targets[0][0]))
        else:
            _mark_unresolved(
                program,
                "DEPENDENCY_INJECTOR",
                f"{item.namespace}.{item.identity}",
                key,
                "RESOLVES_TO",
                item.rel,
                item.line,
            )

    @staticmethod
    def _provider_key(namespace: str, identity: str) -> str:
        return f"python-provider:{_safe(namespace)}:{_safe(identity)}"

    @staticmethod
    def _event_key(namespace: str, identity: str) -> str:
        return f"event:python-pubsub:{_safe(namespace)}:{identity}"


class _FrameworkVisitor(ast.NodeVisitor):
    def __init__(
        self,
        *,
        program: SemanticProgram,
        rel: str,
        symbols: dict[str, list[tuple[str, str, int]]],
        provider_map: dict[tuple[str, str], _ProviderBinding],
        pubsub_handlers: dict[tuple[str, str], set[str]],
        actors: dict[str, tuple[str, str, str]],
    ) -> None:
        self.program = program
        self.rel = rel
        self.symbols = symbols
        self.provider_map = provider_map
        self.pubsub_handlers = pubsub_handlers
        self.actors = actors
        self.owner_stack = [f"module:{rel.replace('/', '.').removesuffix('.py')}"]
        self.injected_alias_stack: list[dict[str, _ProviderBinding]] = [{}]

    @property
    def owner(self) -> str:
        return self.owner_stack[-1]

    @property
    def injected_aliases(self) -> dict[str, _ProviderBinding]:
        return self.injected_alias_stack[-1]

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        owner = f"symbol:{self.rel}:{node.name}"
        aliases = self._provide_aliases(node)
        for binding in aliases.values():
            self.program.add_edge(
                SemanticEdgeFact(
                    "RESOLVES_TO",
                    owner,
                    PythonFrameworkAdapters._provider_key(binding.namespace, binding.identity),
                    attributes={"frameworkBoundary": "DEPENDENCY_INJECTOR"},
                )
            )
        self.owner_stack.append(owner)
        self.injected_alias_stack.append(aliases)
        for child in node.body:
            self.visit(child)
        self.injected_alias_stack.pop()
        self.owner_stack.pop()

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.owner_stack.append(f"symbol:{self.rel}:{node.name}")
        self.injected_alias_stack.append({})
        for child in node.body:
            self.visit(child)
        self.injected_alias_stack.pop()
        self.owner_stack.pop()

    def visit_Call(self, node: ast.Call) -> None:
        self._injected_alias_call(node)
        self._background_dispatch(node)
        self._rq_enqueue(node)
        self._pubsub_publish(node)
        self.generic_visit(node)

    def _provide_aliases(
        self,
        node: ast.FunctionDef | ast.AsyncFunctionDef,
    ) -> dict[str, _ProviderBinding]:
        positional = list(node.args.args)
        defaults = list(node.args.defaults)
        padded = [None] * max(0, len(positional) - len(defaults)) + defaults
        pairs = list(zip(positional, padded))
        pairs.extend(zip(node.args.kwonlyargs, node.args.kw_defaults))
        result: dict[str, _ProviderBinding] = {}
        for arg, default in pairs:
            provider = _provide_reference(default)
            if provider and provider in self.provider_map:
                result[arg.arg] = self.provider_map[provider]
        return result

    def _injected_alias_call(self, node: ast.Call) -> None:
        if not isinstance(node.func, ast.Attribute):
            return
        alias = _ast_name(node.func.value)
        if alias not in self.injected_aliases:
            return
        binding = self.injected_aliases[alias]
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:dependency-injector:{alias}.{node.func.attr}"
        self.program.add_node(
            SemanticNodeFact(
                call_key,
                "CALL_SITE",
                f"{alias}.{node.func.attr}",
                self.rel,
                line,
                line,
                attributes={"frameworkBoundary": "DEPENDENCY_INJECTOR"},
            )
        )
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))
        targets = self.symbols.get(node.func.attr, [])
        # Python extractor method keys are name-based. Only resolve when the method name
        # is unique in the repository; otherwise preserve uncertainty.
        if len(targets) == 1:
            self.program.add_edge(SemanticEdgeFact("RESOLVES_TO", call_key, targets[0][0]))
        else:
            _mark_unresolved(
                self.program,
                "DEPENDENCY_INJECTOR_CALL",
                f"{binding.target_name}.{node.func.attr}",
                call_key,
                "RESOLVES_TO",
                self.rel,
                line,
            )

    def _background_dispatch(self, node: ast.Call) -> None:
        if not isinstance(node.func, ast.Attribute) or node.func.attr not in {"send", "delay", "apply_async"}:
            return
        name = _ast_name(node.func.value).split(".")[-1]
        if name not in self.actors:
            return
        framework, _, identity = self.actors[name]
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:{framework.lower()}:{identity}"
        queue_key = f"queue:{framework.lower()}:{identity}"
        self.program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{name}.{node.func.attr}", self.rel, line, line, attributes={"frameworkBoundary": framework}))
        self.program.add_node(SemanticNodeFact(queue_key, "QUEUE", identity, attributes={"frameworkBoundary": framework}))
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))
        self.program.add_edge(SemanticEdgeFact("PUBLISHES_TO_QUEUE", call_key, queue_key))

    def _rq_enqueue(self, node: ast.Call) -> None:
        if not isinstance(node.func, ast.Attribute) or node.func.attr not in {"enqueue", "enqueue_call"} or not node.args:
            return
        handler = _ast_name(node.args[0]).split(".")[-1]
        targets = self.symbols.get(handler, [])
        if not handler or not targets:
            return
        namespace = _ast_name(node.func.value) or "queue"
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:rq:{namespace}"
        queue_key = f"queue:rq:{_safe(namespace)}"
        self.program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{namespace}.enqueue", self.rel, line, line, attributes={"frameworkBoundary": "RQ"}))
        self.program.add_node(SemanticNodeFact(queue_key, "QUEUE", namespace, attributes={"frameworkBoundary": "RQ"}))
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))
        self.program.add_edge(SemanticEdgeFact("PUBLISHES_TO_QUEUE", call_key, queue_key))
        if len(targets) == 1:
            self.program.add_edge(SemanticEdgeFact("CONSUMES_FROM_QUEUE", queue_key, targets[0][0]))
        else:
            _mark_unresolved(self.program, "RQ", handler, queue_key, "CONSUMES_FROM_QUEUE", self.rel, line)

    def _pubsub_publish(self, node: ast.Call) -> None:
        if not isinstance(node.func, ast.Attribute) or node.func.attr not in _PUBSUB_PUBLISH or not node.args:
            return
        namespace = _ast_name(node.func.value)
        identity = _literal(node.args[0])
        if not namespace or not identity or (namespace, identity) not in self.pubsub_handlers:
            return
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:pubsub:{_safe(namespace)}:{_safe(identity)}"
        event_key = PythonFrameworkAdapters._event_key(namespace, identity)
        self.program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{namespace}.{node.func.attr}", self.rel, line, line, attributes={"frameworkBoundary": "PYTHON_PUBSUB"}))
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))
        self.program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, event_key))


def _provide_reference(node: ast.AST | None) -> tuple[str, str] | None:
    if not isinstance(node, ast.Subscript):
        return None
    if _ast_name(node.value).split(".")[-1] != "Provide":
        return None
    target = _ast_name(node.slice)
    if "." not in target:
        return None
    namespace, identity = target.rsplit(".", 1)
    return namespace.split(".")[-1], identity


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


def _literal(node: ast.AST | None) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int)):
        return str(node.value)
    return ""


def _ast_name(node: ast.AST | None) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _ast_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Subscript):
        base = _ast_name(node.value)
        inner = _ast_name(node.slice)
        return f"{base}.{inner}" if base and inner else base
    return ""


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:/-]+", "_", value)[:160] or "unknown"
