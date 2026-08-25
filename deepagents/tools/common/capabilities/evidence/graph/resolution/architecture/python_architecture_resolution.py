"""Resolve common Python architecture boundaries without treating dynamic dispatch as absence.

The repository extractor intentionally stays framework-neutral. This pass handles Python
patterns whose runtime target is selected through a registry/container/framework rather
than a direct call: registry dispatch, FastAPI dependencies/routes, Celery tasks, Django
signals, singledispatch, and common DI container registrations. Exact static bindings are
resolved; ambiguous/dynamic bindings become explicit unresolved frontiers.
"""
from __future__ import annotations

import ast
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
}
_ROUTE_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}
_REGISTRATION_METHODS = {"register", "bind", "register_instance", "registerSingleton"}
_DISPATCH_METHODS = {"dispatch", "resolve"}
_TASK_CALLS = {"delay", "apply_async"}


@dataclass(frozen=True)
class _Binding:
    namespace: str
    identity: str
    target_name: str
    file_path: str
    line: int
    boundary: str


class PythonArchitectureResolver:
    """Resolve popular Python registry/DI/framework dispatch continuations."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        files = self._files()
        symbol_index = self._symbol_index(files)
        bindings = self._collect_bindings(files)
        binding_map: dict[tuple[str, str], list[_Binding]] = {}
        for binding in bindings:
            binding_map.setdefault((binding.namespace, binding.identity), []).append(binding)
            self._emit_binding(program, binding, symbol_index)

        for rel, tree in files:
            _PythonArchitectureVisitor(
                program=program,
                rel=rel,
                tree=tree,
                symbol_index=symbol_index,
                bindings=binding_map,
            ).run()
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
    def _symbol_index(
        files: Iterable[tuple[str, ast.Module]],
    ) -> dict[str, list[tuple[str, str, int]]]:
        index: dict[str, list[tuple[str, str, int]]] = {}
        for rel, tree in files:
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    index.setdefault(node.name, []).append(
                        (f"symbol:{rel}:{node.name}", rel, int(getattr(node, "lineno", 1)))
                    )
        return index

    @classmethod
    def _collect_bindings(
        cls, files: Iterable[tuple[str, ast.Module]]
    ) -> tuple[_Binding, ...]:
        result: list[_Binding] = []
        for rel, tree in files:
            for node in ast.walk(tree):
                # registry = {"kind": handler, ...}
                if isinstance(node, (ast.Assign, ast.AnnAssign)):
                    target = node.targets[0] if isinstance(node, ast.Assign) and node.targets else node.target
                    value = node.value
                    if isinstance(target, ast.Name) and isinstance(value, ast.Dict):
                        for key, item in zip(value.keys, value.values):
                            identity = _literal_identity(key)
                            target_name = _ast_name(item)
                            if identity and target_name:
                                result.append(
                                    _Binding(
                                        target.id,
                                        identity,
                                        target_name.split(".")[-1],
                                        rel,
                                        int(getattr(node, "lineno", 1)),
                                        "PYTHON_REGISTRY",
                                    )
                                )
                    # registry["kind"] = handler
                    if isinstance(target, ast.Subscript):
                        namespace = _ast_name(target.value)
                        identity = _literal_identity(target.slice)
                        target_name = _ast_name(value)
                        if namespace and identity and target_name:
                            result.append(
                                _Binding(
                                    namespace,
                                    identity,
                                    target_name.split(".")[-1],
                                    rel,
                                    int(getattr(node, "lineno", 1)),
                                    "PYTHON_REGISTRY",
                                )
                            )

                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    for decorator in node.decorator_list:
                        binding = cls._decorator_binding(rel, node, decorator)
                        if binding:
                            result.append(binding)

                if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                    continue
                method = node.func.attr
                namespace = _ast_name(node.func.value)
                if method not in _REGISTRATION_METHODS or not namespace:
                    continue

                # registry.register("kind", Handler), container.register(Interface, Handler),
                # injector.bind(Interface, to=Handler), punq.register(Interface, Handler).
                if not node.args:
                    continue
                identity = _literal_identity(node.args[0]) or _ast_name(node.args[0])
                target_name = _ast_name(node.args[1]) if len(node.args) > 1 else ""
                if not target_name:
                    for keyword in node.keywords:
                        if keyword.arg in {"to", "implementation", "factory"}:
                            target_name = _ast_name(keyword.value)
                            break
                if identity and target_name:
                    boundary = "PYTHON_DI" if method == "bind" or "container" in namespace.lower() or "inject" in namespace.lower() else "PYTHON_REGISTRY"
                    result.append(
                        _Binding(
                            namespace,
                            identity,
                            target_name.split(".")[-1],
                            rel,
                            int(getattr(node, "lineno", 1)),
                            boundary,
                        )
                    )
        return tuple(result)

    @staticmethod
    def _decorator_binding(
        rel: str,
        node: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef,
        decorator: ast.AST,
    ) -> _Binding | None:
        if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
            return None
        namespace = _ast_name(decorator.func.value)
        method = decorator.func.attr
        if method != "register" or not namespace or not decorator.args:
            return None
        identity = _literal_identity(decorator.args[0]) or _ast_name(decorator.args[0])
        if not identity:
            return None
        return _Binding(
            namespace,
            identity,
            node.name,
            rel,
            int(getattr(node, "lineno", 1)),
            "PYTHON_REGISTRY",
        )

    @classmethod
    def _emit_binding(
        cls,
        program: SemanticProgram,
        binding: _Binding,
        symbol_index: dict[str, list[tuple[str, str, int]]],
    ) -> None:
        binding_key = cls._binding_key(binding.namespace, binding.identity)
        program.add_node(
            SemanticNodeFact(
                binding_key,
                "TYPE",
                f"{binding.namespace}:{binding.identity}",
                binding.file_path,
                binding.line,
                binding.line,
                attributes={
                    "frameworkBoundary": binding.boundary,
                    "bindingKey": binding.identity,
                    "namespace": binding.namespace,
                },
            )
        )
        targets = symbol_index.get(binding.target_name, [])
        if len(targets) == 1:
            program.add_edge(SemanticEdgeFact("RESOLVES_TO", binding_key, targets[0][0]))
        else:
            _mark_unresolved(
                program,
                boundary=binding.boundary,
                identity=f"{binding.namespace}:{binding.identity}",
                source_key=binding_key,
                edge_type="RESOLVES_TO",
                file_path=binding.file_path,
                line=binding.line,
            )

    @staticmethod
    def _binding_key(namespace: str, identity: str) -> str:
        safe_ns = re.sub(r"[^A-Za-z0-9_.:-]+", "_", namespace)[:100] or "registry"
        safe_id = re.sub(r"[^A-Za-z0-9_.:/-]+", "_", identity)[:140] or "unknown"
        return f"python-binding:{safe_ns}:{safe_id}"


class _PythonArchitectureVisitor(ast.NodeVisitor):
    def __init__(
        self,
        *,
        program: SemanticProgram,
        rel: str,
        tree: ast.Module,
        symbol_index: dict[str, list[tuple[str, str, int]]],
        bindings: dict[tuple[str, str], list[_Binding]],
    ) -> None:
        self.program = program
        self.rel = rel
        self.tree = tree
        self.symbol_index = symbol_index
        self.bindings = bindings
        self.owner_stack = [f"module:{rel.replace('/', '.').removesuffix('.py')}"]
        self.singledispatch_functions: set[str] = set()
        self.singledispatch_handlers: dict[str, list[str]] = {}
        self.celery_tasks: dict[str, str] = {}

    @property
    def owner(self) -> str:
        return self.owner_stack[-1]

    def run(self) -> None:
        self._preindex_framework_decorators()
        self.visit(self.tree)

    def _preindex_framework_decorators(self) -> None:
        for node in ast.walk(self.tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            key = f"symbol:{self.rel}:{node.name}"
            for decorator in node.decorator_list:
                name = _ast_name(decorator.func if isinstance(decorator, ast.Call) else decorator)
                if name.endswith("singledispatch"):
                    self.singledispatch_functions.add(node.name)
                if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute) and decorator.func.attr == "register":
                    base = _ast_name(decorator.func.value)
                    if base:
                        self.singledispatch_handlers.setdefault(base.split(".")[-1], []).append(key)
                if name.endswith("shared_task") or name.endswith(".task"):
                    task_name = node.name
                    if isinstance(decorator, ast.Call):
                        for keyword in decorator.keywords:
                            if keyword.arg == "name":
                                task_name = _literal_identity(keyword.value) or task_name
                    self.celery_tasks[node.name] = task_name
                    qkey = f"queue:celery:{task_name}"
                    self.program.add_node(
                        SemanticNodeFact(qkey, "QUEUE", task_name, attributes={"frameworkBoundary": "CELERY"})
                    )
                    self.program.add_edge(SemanticEdgeFact("CONSUMES_FROM_QUEUE", qkey, key))

            for decorator in node.decorator_list:
                self._emit_route_or_signal(node, decorator)

    def _emit_route_or_signal(
        self,
        node: ast.FunctionDef | ast.AsyncFunctionDef,
        decorator: ast.AST,
    ) -> None:
        key = f"symbol:{self.rel}:{node.name}"
        if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
            method = decorator.func.attr.lower()
            if method in _ROUTE_METHODS and decorator.args:
                route = _literal_identity(decorator.args[0])
                if route:
                    rkey = f"http-route:{method.upper()}:{route}"
                    self.program.add_node(
                        SemanticNodeFact(
                            rkey,
                            "HTTP_ROUTE",
                            f"{method.upper()} {route}",
                            attributes={"method": method.upper(), "route": route, "frameworkBoundary": "PYTHON_WEB"},
                        )
                    )
                    self.program.add_edge(SemanticEdgeFact("HANDLED_BY", rkey, key))

        if isinstance(decorator, ast.Call):
            name = _ast_name(decorator.func)
            if name.endswith("receiver") and decorator.args:
                signal = _ast_name(decorator.args[0]) or _literal_identity(decorator.args[0])
                if signal:
                    ekey = f"event:django:{signal}"
                    self.program.add_node(
                        SemanticNodeFact(ekey, "EVENT", signal, attributes={"frameworkBoundary": "DJANGO_SIGNAL"})
                    )
                    self.program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", ekey, key))

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        key = f"symbol:{self.rel}:{node.name}"
        self._emit_fastapi_dependencies(node, key)
        self.owner_stack.append(key)
        for child in node.body:
            self.visit(child)
        self.owner_stack.pop()

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        key = f"symbol:{self.rel}:{node.name}"
        self.owner_stack.append(key)
        for child in node.body:
            self.visit(child)
        self.owner_stack.pop()

    def _emit_fastapi_dependencies(
        self,
        node: ast.FunctionDef | ast.AsyncFunctionDef,
        owner_key: str,
    ) -> None:
        defaults = [*node.args.defaults, *node.args.kw_defaults]
        for default in defaults:
            if not isinstance(default, ast.Call):
                continue
            if _ast_name(default.func).split(".")[-1] != "Depends" or not default.args:
                continue
            dependency = _ast_name(default.args[0])
            if not dependency:
                _mark_unresolved(
                    self.program,
                    boundary="FASTAPI_DEPENDS",
                    identity=f"{node.name}:dynamic",
                    source_key=owner_key,
                    edge_type="RESOLVES_TO",
                    file_path=self.rel,
                    line=int(getattr(node, "lineno", 1)),
                )
                continue
            targets = self.symbol_index.get(dependency.split(".")[-1], [])
            if len(targets) == 1:
                # FastAPI executes dependency providers as part of the handler path.
                self.program.add_edge(SemanticEdgeFact("CALLS", owner_key, targets[0][0], attributes={"frameworkBoundary": "FASTAPI_DEPENDS"}))
            else:
                _mark_unresolved(
                    self.program,
                    boundary="FASTAPI_DEPENDS",
                    identity=f"{node.name}:{dependency}",
                    source_key=owner_key,
                    edge_type="RESOLVES_TO",
                    file_path=self.rel,
                    line=int(getattr(node, "lineno", 1)),
                )

    def visit_Call(self, node: ast.Call) -> None:
        self._registry_dispatch(node)
        self._di_resolve(node)
        self._celery_dispatch(node)
        self._django_signal_send(node)
        self._singledispatch_call(node)
        self.generic_visit(node)

    def _registry_dispatch(self, node: ast.Call) -> None:
        namespace = ""
        identity = ""
        dynamic_identity = False

        # registry["kind"](...)
        if isinstance(node.func, ast.Subscript):
            namespace = _ast_name(node.func.value)
            identity = _literal_identity(node.func.slice)
            dynamic_identity = bool(namespace and not identity)
        # registry.get("kind")(...)
        elif isinstance(node.func, ast.Call) and isinstance(node.func.func, ast.Attribute):
            if node.func.func.attr == "get":
                namespace = _ast_name(node.func.func.value)
                if node.func.args:
                    identity = _literal_identity(node.func.args[0])
                    dynamic_identity = bool(namespace and not identity)
        # dispatcher.dispatch("kind", ...)
        elif isinstance(node.func, ast.Attribute) and node.func.attr in _DISPATCH_METHODS:
            namespace = _ast_name(node.func.value)
            if node.args:
                identity = _literal_identity(node.args[0]) or _ast_name(node.args[0])
                dynamic_identity = bool(namespace and not identity)

        if not namespace:
            return
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:registry-dispatch:{namespace}"
        self.program.add_node(
            SemanticNodeFact(call_key, "CALL_SITE", f"{namespace} dispatch", self.rel, line, line, attributes={"frameworkBoundary": "PYTHON_REGISTRY"})
        )
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))

        if dynamic_identity:
            _mark_unresolved(
                self.program,
                boundary="PYTHON_REGISTRY",
                identity=f"{namespace}:dynamic-key",
                source_key=call_key,
                edge_type="RESOLVES_TO",
                file_path=self.rel,
                line=line,
            )
            return
        rows = self.bindings.get((namespace, identity), [])
        if len(rows) != 1:
            if identity:
                _mark_unresolved(
                    self.program,
                    boundary="PYTHON_REGISTRY",
                    identity=f"{namespace}:{identity}",
                    source_key=call_key,
                    edge_type="RESOLVES_TO",
                    file_path=self.rel,
                    line=line,
                )
            return
        binding_key = PythonArchitectureResolver._binding_key(namespace, identity)
        self.program.add_edge(SemanticEdgeFact("RESOLVES_TO", call_key, binding_key))

    def _di_resolve(self, node: ast.Call) -> None:
        if not isinstance(node.func, ast.Attribute) or node.func.attr not in {"resolve", "get"} or not node.args:
            return
        namespace = _ast_name(node.func.value)
        if not namespace or not any(hint in namespace.lower() for hint in ("container", "injector", "provider", "dependency")):
            return
        identity = _literal_identity(node.args[0]) or _ast_name(node.args[0])
        if not identity:
            return
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:di-resolve:{namespace}"
        self.program.add_node(
            SemanticNodeFact(call_key, "CALL_SITE", f"{namespace}.{node.func.attr}", self.rel, line, line, attributes={"frameworkBoundary": "PYTHON_DI"})
        )
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))
        rows = self.bindings.get((namespace, identity), [])
        if len(rows) == 1:
            self.program.add_edge(
                SemanticEdgeFact("RESOLVES_TO", call_key, PythonArchitectureResolver._binding_key(namespace, identity))
            )
        else:
            _mark_unresolved(
                self.program,
                boundary="PYTHON_DI",
                identity=f"{namespace}:{identity}",
                source_key=call_key,
                edge_type="RESOLVES_TO",
                file_path=self.rel,
                line=line,
            )

    def _celery_dispatch(self, node: ast.Call) -> None:
        if not isinstance(node.func, ast.Attribute) or node.func.attr not in _TASK_CALLS:
            return
        task = _ast_name(node.func.value).split(".")[-1]
        task_name = self.celery_tasks.get(task)
        if not task_name:
            return
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:celery:{task}"
        qkey = f"queue:celery:{task_name}"
        self.program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{task}.{node.func.attr}", self.rel, line, line, attributes={"frameworkBoundary": "CELERY"}))
        self.program.add_node(SemanticNodeFact(qkey, "QUEUE", task_name, attributes={"frameworkBoundary": "CELERY"}))
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))
        self.program.add_edge(SemanticEdgeFact("PUBLISHES_TO_QUEUE", call_key, qkey))

    def _django_signal_send(self, node: ast.Call) -> None:
        if not isinstance(node.func, ast.Attribute) or node.func.attr not in {"send", "send_robust"}:
            return
        signal = _ast_name(node.func.value)
        if not signal:
            return
        # Avoid treating every object.send() as Django signal; require a matching receiver event.
        ekey = f"event:django:{signal}"
        if not any(item.key == ekey for item in self.program.nodes):
            return
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:django-signal:{signal}"
        self.program.add_node(SemanticNodeFact(call_key, "CALL_SITE", f"{signal}.send", self.rel, line, line, attributes={"frameworkBoundary": "DJANGO_SIGNAL"}))
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))
        self.program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, ekey))

    def _singledispatch_call(self, node: ast.Call) -> None:
        name = _ast_name(node.func).split(".")[-1]
        if name not in self.singledispatch_functions:
            return
        line = int(getattr(node, "lineno", 1))
        call_key = f"call:{self.rel}:{line}:singledispatch:{name}"
        self.program.add_node(SemanticNodeFact(call_key, "CALL_SITE", name, self.rel, line, line, attributes={"frameworkBoundary": "SINGLEDISPATCH"}))
        self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, call_key))
        handlers = self.singledispatch_handlers.get(name, [])
        if len(handlers) == 1:
            self.program.add_edge(SemanticEdgeFact("RESOLVES_TO", call_key, handlers[0]))
        else:
            _mark_unresolved(
                self.program,
                boundary="SINGLEDISPATCH",
                identity=name,
                source_key=call_key,
                edge_type="RESOLVES_TO",
                file_path=self.rel,
                line=line,
            )


def _mark_unresolved(
    program: SemanticProgram,
    *,
    boundary: str,
    identity: str,
    source_key: str,
    edge_type: str,
    file_path: str | None = None,
    line: int | None = None,
) -> None:
    safe_identity = re.sub(r"[^A-Za-z0-9_.:/-]+", "_", identity)[:160] or "unknown"
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


def _literal_identity(node: ast.AST | None) -> str:
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
        return _ast_name(node.value)
    return ""
