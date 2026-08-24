from __future__ import annotations

from tools.graph.scanner.program_graph.python_framework_adapters import (
    PythonFrameworkAdapters,
)
from tools.graph.scanner.program_graph.semantic_ir import SemanticProgram


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {(edge.edge_type, edge.source_key, edge.target_key) for edge in program.edges}


def test_dependency_injector_provider_and_provide_alias_continue_to_method(tmp_path) -> None:
    (tmp_path / "container.py").write_text(
        '''
from dependency_injector import containers, providers
from dependency_injector.wiring import Provide, inject

class PaymentService:
    def charge(self):
        return True

class Container(containers.DeclarativeContainer):
    payment = providers.Factory(PaymentService)

@inject
def checkout(payment = Provide[Container.payment]):
    return payment.charge()
''',
        encoding="utf-8",
    )

    program = PythonFrameworkAdapters(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)
    provider = "python-provider:Container:payment"

    assert ("RESOLVES_TO", provider, "symbol:container.py:PaymentService") in edges
    assert (
        "RESOLVES_TO",
        "symbol:container.py:checkout",
        provider,
    ) in edges
    assert any(
        edge[0] == "RESOLVES_TO"
        and edge[2] == "symbol:container.py:charge"
        for edge in edges
    )


def test_generic_python_pubsub_literal_topic_connects_publish_to_subscriber(tmp_path) -> None:
    (tmp_path / "events.py").write_text(
        '''
def on_done(payload):
    return payload

bus.subscribe("done", on_done)

def publish(payload):
    bus.publish("done", payload)
''',
        encoding="utf-8",
    )

    program = PythonFrameworkAdapters(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)
    event = "event:python-pubsub:bus:done"

    assert ("CONSUMES_EVENT", event, "symbol:events.py:on_done") in edges
    assert any(edge[0] == "PUBLISHES_EVENT" and edge[2] == event for edge in edges)


def test_rq_and_dramatiq_dispatch_continue_to_concrete_handlers(tmp_path) -> None:
    (tmp_path / "tasks.py").write_text(
        '''
import dramatiq

@dramatiq.actor
def rebuild():
    return True

def export_report():
    return True

rebuild.send()
queue.enqueue(export_report)
''',
        encoding="utf-8",
    )

    program = PythonFrameworkAdapters(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert (
        "CONSUMES_FROM_QUEUE",
        "queue:dramatiq:rebuild",
        "symbol:tasks.py:rebuild",
    ) in edges
    assert any(edge[0] == "PUBLISHES_TO_QUEUE" and edge[2] == "queue:dramatiq:rebuild" for edge in edges)
    assert (
        "CONSUMES_FROM_QUEUE",
        "queue:rq:queue",
        "symbol:tasks.py:export_report",
    ) in edges
    assert any(edge[0] == "PUBLISHES_TO_QUEUE" and edge[2] == "queue:rq:queue" for edge in edges)
