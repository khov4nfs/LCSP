from __future__ import annotations

from tools.common.capabilities.evidence.graph.resolution.framework.framework_resolution import (
    FrameworkBoundaryResolver,
)
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticProgram


def _edge_set(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {
        (edge.edge_type, edge.source_key, edge.target_key)
        for edge in program.edges
    }


def test_command_dispatch_resolves_handler_and_injected_concrete_method(tmp_path) -> None:
    source = tmp_path / "feature.ts"
    source.write_text(
        """
        export class WorkerService {
          run() { return true; }
        }

        @CommandHandler(DoThingCommand)
        export class DoThingHandler {
          constructor(@Inject(WORKER_PORT) private readonly worker: WorkerPort) {}
          async execute() {
            return this.worker.run();
          }
        }

        @Module({
          providers: [
            { provide: WORKER_PORT, useClass: WorkerService },
            DoThingHandler,
          ],
        })
        export class FeatureModule {}

        export class Dispatcher {
          constructor(private readonly commandBus: CommandBus) {}
          async start() {
            return this.commandBus.execute(new DoThingCommand());
          }
        }
        """,
        encoding="utf-8",
    )

    program = FrameworkBoundaryResolver(tmp_path).enrich(SemanticProgram())
    edges = _edge_set(program)

    handler = "framework-method:feature.ts:DoThingHandler.execute"
    worker = "framework-method:feature.ts:WorkerService.run"
    worker_call = next(
        node.key
        for node in program.nodes
        if node.node_type == "CALL_SITE" and node.label == "this.worker.run"
    )

    assert ("HANDLES_COMMAND", "command:DoThingCommand", handler) in edges
    assert ("CALLS", handler, worker_call) in edges
    assert ("RESOLVES_TO", worker_call, worker) in edges
    assert not any(
        node.node_type == "UNRESOLVED_DYNAMIC_TARGET"
        and node.label == "COMMAND:DoThingCommand"
        for node in program.nodes
    )


def test_queue_consumer_continues_to_process_method_and_di_target(tmp_path) -> None:
    source = tmp_path / "boundary.ts"
    source.write_text(
        """
        export class WorkerService {
          run() { return true; }
        }

        @Processor("engineering")
        export class EngineeringConsumer {
          constructor(private readonly worker: WorkerService) {}

          @Process("run")
          async handle() {
            return this.worker.run();
          }
        }

        export class Producer {
          async enqueue() {
            return this.queue.add("engineering", {});
          }
        }
        """,
        encoding="utf-8",
    )

    program = FrameworkBoundaryResolver(tmp_path).enrich(SemanticProgram())
    edges = _edge_set(program)
    handler = "framework-method:boundary.ts:EngineeringConsumer.handle"
    worker = "framework-method:boundary.ts:WorkerService.run"
    worker_call = next(
        node.key
        for node in program.nodes
        if node.node_type == "CALL_SITE" and node.label == "this.worker.run"
    )

    assert ("CONSUMES_FROM_QUEUE", "queue:engineering", handler) in edges
    assert ("RESOLVES_TO", worker_call, worker) in edges
    assert not any(
        node.node_type == "UNRESOLVED_DYNAMIC_TARGET"
        and node.label == "QUEUE:engineering"
        for node in program.nodes
    )


def test_unhandled_dispatch_becomes_explicit_unresolved_frontier(tmp_path) -> None:
    source = tmp_path / "dispatcher.ts"
    source.write_text(
        """
        export class Dispatcher {
          constructor(private readonly commandBus: CommandBus) {}
          async start() {
            return this.commandBus.execute(new MissingCommand());
          }
        }
        """,
        encoding="utf-8",
    )

    program = FrameworkBoundaryResolver(tmp_path).enrich(SemanticProgram())
    unresolved = [
        node
        for node in program.nodes
        if node.node_type == "UNRESOLVED_DYNAMIC_TARGET"
        and node.label == "COMMAND:MissingCommand"
    ]

    assert len(unresolved) == 1
    assert unresolved[0].key in program.unresolved_frontiers
    assert (
        "HANDLES_COMMAND",
        "command:MissingCommand",
        unresolved[0].key,
    ) in _edge_set(program)


def test_event_consumer_is_bound_to_concrete_method(tmp_path) -> None:
    source = tmp_path / "event-boundary.ts"
    source.write_text(
        """
        export class AuditConsumer {
          @OnEvent("assessment.completed")
          async handleCompleted() {
            return true;
          }
        }

        export class Publisher {
          publishDone() {
            return this.events.emit("assessment.completed", {});
          }
        }
        """,
        encoding="utf-8",
    )

    program = FrameworkBoundaryResolver(tmp_path).enrich(SemanticProgram())
    assert (
        "CONSUMES_EVENT",
        "event:assessment.completed",
        "framework-method:event-boundary.ts:AuditConsumer.handleCompleted",
    ) in _edge_set(program)
