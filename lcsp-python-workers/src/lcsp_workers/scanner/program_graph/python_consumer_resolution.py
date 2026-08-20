"""Resolve LCSP Python ConsumerBase queue/routing boundaries to concrete handle methods."""
from __future__ import annotations

import ast
from pathlib import Path

from .semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from .source_roles import is_test_source_path

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


class PythonConsumerBoundaryResolver:
    """Connect RabbitMQ routing identities directly to subclass ``handle`` methods.

    ConsumerBase performs dynamic ``self.handle(...)`` dispatch after broker delivery.
    Static call graphs cannot safely resolve that polymorphic call by themselves, so
    repository graph construction records each concrete ConsumerBase subclass's
    queue/routing identity as an explicit continuation into its handle implementation.
    """

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
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
                tree = ast.parse(
                    path.read_text(encoding="utf-8", errors="replace"),
                    filename=rel,
                )
            except (OSError, SyntaxError):
                continue
            self._file(program, rel, tree)
        return program

    @classmethod
    def _file(cls, program: SemanticProgram, rel: str, tree: ast.Module) -> None:
        for item in tree.body:
            if not isinstance(item, ast.ClassDef):
                continue
            if not cls._is_consumer(item):
                continue

            queue_name = cls._string_class_attribute(item, "queue_name")
            routing_key = cls._string_class_attribute(item, "routing_key")
            handle = next(
                (
                    child
                    for child in item.body
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and child.name == "handle"
                ),
                None,
            )
            class_key = f"symbol:{rel}:{item.name}"
            program.add_node(
                SemanticNodeFact(
                    class_key,
                    "CLASS",
                    item.name,
                    rel,
                    item.lineno,
                    getattr(item, "end_lineno", item.lineno),
                    item.name,
                    attributes={
                        "frameworkBoundary": "PYTHON_CONSUMER",
                        "consumerBase": "ConsumerBase",
                    },
                )
            )

            if handle is None:
                cls._mark_unresolved(
                    program,
                    rel=rel,
                    line=item.lineno,
                    class_key=class_key,
                    identity=queue_name or routing_key or item.name,
                )
                continue

            # RepositorySemanticExtractor uses one file-level symbol key for Python
            # methods. Reuse it so downstream CALLS edges already owned by ``handle``
            # remain traversable instead of creating a parallel dead-end symbol.
            handle_key = f"symbol:{rel}:handle"
            program.add_node(
                SemanticNodeFact(
                    handle_key,
                    "METHOD",
                    "handle",
                    rel,
                    handle.lineno,
                    getattr(handle, "end_lineno", handle.lineno),
                    f"{item.name}.handle",
                    attributes={"frameworkResolved": True},
                )
            )
            program.add_edge(SemanticEdgeFact("DECLARES", class_key, handle_key))

            if queue_name:
                queue_key = f"queue:{queue_name}"
                program.add_node(
                    SemanticNodeFact(
                        queue_key,
                        "QUEUE",
                        queue_name,
                        attributes={"broker": "RABBITMQ", "declaredBy": item.name},
                    )
                )
                program.add_edge(
                    SemanticEdgeFact("CONSUMES_FROM_QUEUE", queue_key, handle_key)
                )
            if routing_key:
                event_key = f"event:{routing_key}"
                program.add_node(
                    SemanticNodeFact(
                        event_key,
                        "EVENT",
                        routing_key,
                        attributes={"broker": "RABBITMQ", "declaredBy": item.name},
                    )
                )
                program.add_edge(SemanticEdgeFact("CONSUMES_EVENT", event_key, handle_key))

            if not queue_name and not routing_key:
                cls._mark_unresolved(
                    program,
                    rel=rel,
                    line=item.lineno,
                    class_key=class_key,
                    identity=item.name,
                )

    @staticmethod
    def _is_consumer(item: ast.ClassDef) -> bool:
        bases = {_ast_name(base).split(".")[-1] for base in item.bases}
        if "ConsumerBase" in bases:
            return True
        # Keep a conservative compatibility path for locally aliased ConsumerBase
        # subclasses: they must still look like an LCSP consumer and implement handle.
        names = {
            child.name
            for child in item.body
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        attributes = {
            child.targets[0].id
            for child in item.body
            if isinstance(child, ast.Assign)
            and len(child.targets) == 1
            and isinstance(child.targets[0], ast.Name)
        }
        return (
            item.name.endswith("Consumer")
            and "handle" in names
            and bool({"queue_name", "routing_key"}.intersection(attributes))
        )

    @staticmethod
    def _string_class_attribute(item: ast.ClassDef, name: str) -> str | None:
        for child in item.body:
            if isinstance(child, ast.Assign):
                if not any(isinstance(target, ast.Name) and target.id == name for target in child.targets):
                    continue
                if isinstance(child.value, ast.Constant) and isinstance(child.value.value, str):
                    return child.value.value
            if isinstance(child, ast.AnnAssign):
                if not isinstance(child.target, ast.Name) or child.target.id != name:
                    continue
                if isinstance(child.value, ast.Constant) and isinstance(child.value.value, str):
                    return child.value.value
        return None

    @staticmethod
    def _mark_unresolved(
        program: SemanticProgram,
        *,
        rel: str,
        line: int,
        class_key: str,
        identity: str,
    ) -> None:
        key = f"framework-unresolved:PYTHON_CONSUMER:{rel}:{identity}"
        program.add_node(
            SemanticNodeFact(
                key,
                "UNRESOLVED_DYNAMIC_TARGET",
                f"PYTHON_CONSUMER:{identity}",
                rel,
                line,
                line,
                attributes={
                    "frameworkBoundary": "PYTHON_CONSUMER",
                    "resolutionState": "UNRESOLVED",
                },
                coverage_state="LIMITED",
            )
        )
        program.add_edge(
            SemanticEdgeFact(
                "RESOLVES_TO",
                class_key,
                key,
                attributes={"frameworkBoundary": "PYTHON_CONSUMER"},
                coverage_state="LIMITED",
            )
        )
        if key not in program.unresolved_frontiers:
            program.unresolved_frontiers.append(key)


def _ast_name(node: ast.AST | None) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _ast_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return ""
