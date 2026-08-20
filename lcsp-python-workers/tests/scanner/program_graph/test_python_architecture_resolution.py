from __future__ import annotations

from lcsp_workers.scanner.program_graph.python_architecture_resolution import (
    PythonArchitectureResolver,
)
from lcsp_workers.scanner.program_graph.semantic_ir import SemanticProgram


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {(edge.edge_type, edge.source_key, edge.target_key) for edge in program.edges}


def test_python_registry_literal_dispatch_resolves_and_dynamic_key_is_unresolved(tmp_path) -> None:
    (tmp_path / "registry.py").write_text(
        '''
def approve(payload):
    return payload

handlers = {"approve": approve}

def run(payload):
    return handlers["approve"](payload)

def run_dynamic(kind, payload):
    return handlers[kind](payload)
''',
        encoding="utf-8",
    )

    program = PythonArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)
    binding = "python-binding:handlers:approve"

    assert ("RESOLVES_TO", binding, "symbol:registry.py:approve") in edges
    assert any(
        edge[0] == "RESOLVES_TO" and edge[2] == binding
        for edge in edges
    )
    assert any(
        node.node_type == "UNRESOLVED_DYNAMIC_TARGET"
        and node.attributes.get("frameworkBoundary") == "PYTHON_REGISTRY"
        and "dynamic-key" in node.label
        for node in program.nodes
    )


def test_fastapi_route_and_depends_continue_to_concrete_dependency(tmp_path) -> None:
    (tmp_path / "api.py").write_text(
        '''
from fastapi import Depends, FastAPI

app = FastAPI()

def current_user():
    return "user"

@app.get("/items")
def list_items(user = Depends(current_user)):
    return user
''',
        encoding="utf-8",
    )

    program = PythonArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert ("HANDLED_BY", "http-route:GET:/items", "symbol:api.py:list_items") in edges
    assert (
        "CALLS",
        "symbol:api.py:list_items",
        "symbol:api.py:current_user",
    ) in edges


def test_celery_task_and_django_signal_are_framework_continuations(tmp_path) -> None:
    (tmp_path / "jobs.py").write_text(
        '''
from celery import shared_task
from django.dispatch import receiver
from app.signals import completed

@shared_task(name="jobs.rebuild")
def rebuild():
    return True

@receiver(completed)
def on_completed(sender, **kwargs):
    return rebuild.delay()

def publish():
    completed.send(sender="system")
''',
        encoding="utf-8",
    )

    program = PythonArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert (
        "CONSUMES_FROM_QUEUE",
        "queue:celery:jobs.rebuild",
        "symbol:jobs.py:rebuild",
    ) in edges
    assert (
        "CONSUMES_EVENT",
        "event:django:completed",
        "symbol:jobs.py:on_completed",
    ) in edges
    assert any(
        edge[0] == "PUBLISHES_EVENT" and edge[2] == "event:django:completed"
        for edge in edges
    )


def test_python_container_binding_and_resolve_are_linked(tmp_path) -> None:
    (tmp_path / "container.py").write_text(
        '''
class PaymentPort:
    pass

class StripePayment:
    pass

container.bind(PaymentPort, to=StripePayment)

def build():
    return container.resolve(PaymentPort)
''',
        encoding="utf-8",
    )

    program = PythonArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)
    binding = "python-binding:container:PaymentPort"

    assert ("RESOLVES_TO", binding, "symbol:container.py:StripePayment") in edges
    assert any(edge[0] == "RESOLVES_TO" and edge[2] == binding for edge in edges)
