from __future__ import annotations

from lcsp_workers.scanner.program_graph.javascript_architecture_resolution import (
    JavaScriptArchitectureResolver,
)
from lcsp_workers.scanner.program_graph.semantic_ir import SemanticProgram


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {(edge.edge_type, edge.source_key, edge.target_key) for edge in program.edges}


def test_redux_slice_dispatch_and_async_thunk_continue_to_handlers(tmp_path) -> None:
    (tmp_path / "store.ts").write_text(
        '''
const todos = createSlice({
  name: "todos",
  reducers: {
    addTodo(state, action) { return state; },
  },
});

function fetchUsersWorker() { return true; }
const fetchUsers = createAsyncThunk("users/fetch", fetchUsersWorker);

function run() {
  dispatch(addTodo({ id: 1 }));
  dispatch(fetchUsers());
}
''',
        encoding="utf-8",
    )

    program = JavaScriptArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert any(
        edge[0] == "CONSUMES_EVENT"
        and edge[1] == "event:redux:todos/addTodo"
        for edge in edges
    )
    assert any(
        edge[0] == "PUBLISHES_EVENT"
        and edge[2] == "event:redux:todos/addTodo"
        for edge in edges
    )
    assert (
        "HANDLES_COMMAND",
        "command:redux-thunk:users/fetch",
        "symbol:store.ts:fetchUsersWorker",
    ) in edges
    assert any(
        edge[0] == "PUBLISHES_COMMAND"
        and edge[2] == "command:redux-thunk:users/fetch"
        for edge in edges
    )


def test_event_emitter_and_rxjs_subject_are_not_silent_boundaries(tmp_path) -> None:
    (tmp_path / "events.ts").write_text(
        '''
function handleDone(value) { return value; }
function handleTick(value) { return value; }

bus.on("done", handleDone);
bus.emit("done", { ok: true });

updates.subscribe(handleTick);
updates.next({ id: 1 });
''',
        encoding="utf-8",
    )

    program = JavaScriptArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert (
        "CONSUMES_EVENT",
        "event:emitter:bus:done",
        "symbol:events.ts:handleDone",
    ) in edges
    assert any(
        edge[0] == "PUBLISHES_EVENT"
        and edge[2] == "event:emitter:bus:done"
        for edge in edges
    )
    assert (
        "CONSUMES_EVENT",
        "event:rxjs:updates",
        "symbol:events.ts:handleTick",
    ) in edges
    assert any(
        edge[0] == "PUBLISHES_EVENT"
        and edge[2] == "event:rxjs:updates"
        for edge in edges
    )


def test_js_container_bind_resolve_and_generic_registry_dispatch(tmp_path) -> None:
    (tmp_path / "container.ts").write_text(
        '''
class PaymentPort {}
class StripePayment {}
function handleApprove() { return true; }

container.bind(PaymentPort).to(StripePayment);
const payment = container.get(PaymentPort);

registry.register("approve", handleApprove);
registry.dispatch("approve", {});
''',
        encoding="utf-8",
    )

    program = JavaScriptArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert (
        "RESOLVES_TO",
        "js-di:container:PaymentPort",
        "symbol:container.ts:StripePayment",
    ) in edges
    assert any(
        edge[0] == "RESOLVES_TO" and edge[2] == "js-di:container:PaymentPort"
        for edge in edges
    )
    assert (
        "RESOLVES_TO",
        "js-registry:registry:approve",
        "symbol:container.ts:handleApprove",
    ) in edges
    assert any(
        edge[0] == "RESOLVES_TO" and edge[2] == "js-registry:registry:approve"
        for edge in edges
    )


def test_bullmq_rabbit_and_kafkajs_connect_producer_to_consumer(tmp_path) -> None:
    (tmp_path / "broker.ts").write_text(
        '''
function processJob(job) { return job; }
function onRabbit(message) { return message; }
function onKafka(message) { return message; }

const jobs = new Queue("jobs");
new Worker("jobs", processJob);
jobs.add("run", {});

channel.consume("audit", onRabbit);
channel.sendToQueue("audit", Buffer.from("x"));

consumer.subscribe({ topic: "events" });
consumer.run({ eachMessage: onKafka });
producer.send({ topic: "events", messages: [] });
''',
        encoding="utf-8",
    )

    program = JavaScriptArchitectureResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert (
        "CONSUMES_FROM_QUEUE",
        "queue:bullmq:jobs",
        "symbol:broker.ts:processJob",
    ) in edges
    assert any(edge[0] == "PUBLISHES_TO_QUEUE" and edge[2] == "queue:bullmq:jobs" for edge in edges)
    assert (
        "CONSUMES_FROM_QUEUE",
        "queue:rabbitmq:audit",
        "symbol:broker.ts:onRabbit",
    ) in edges
    assert any(edge[0] == "PUBLISHES_TO_QUEUE" and edge[2] == "queue:rabbitmq:audit" for edge in edges)
    assert (
        "CONSUMES_FROM_QUEUE",
        "queue:kafkajs:events",
        "symbol:broker.ts:onKafka",
    ) in edges
    assert any(edge[0] == "PUBLISHES_TO_QUEUE" and edge[2] == "queue:kafkajs:events" for edge in edges)
