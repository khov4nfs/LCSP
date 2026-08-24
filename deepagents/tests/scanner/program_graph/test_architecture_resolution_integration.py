from __future__ import annotations

from tools.graph.scanner.program_graph.assembler import ProgramGraphAssembler


def test_architecture_resolvers_build_privacy_safe_graph_with_di_and_redux(tmp_path) -> None:
    (tmp_path / "feature.ts").write_text(
        '''
export class WorkerService {
  run() { return true; }
}

@CommandHandler(DoThingCommand)
export class DoThingHandler {
  constructor(@Inject(WORKER_PORT) private readonly worker: WorkerPort) {}
  execute() { return this.worker.run(); }
}

@Module({ providers: [{ provide: WORKER_PORT, useClass: WorkerService }] })
export class FeatureModule {}

function onDone(value) { return value; }
const done = createAction("assessment/done");
bus.on("completed", onDone);

dispatch(done({ ok: true }));
bus.emit("completed", {});
''',
        encoding="utf-8",
    )

    graph = ProgramGraphAssembler().assemble(
        scan_job_id="scan-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        workspace_path=tmp_path,
    )

    assert graph.node_count > 0
    assert any(
        (node.get("attributes") or {}).get("bindingKey") == "WORKER_PORT"
        for node in graph.nodes
    )
    assert not any("token" in (node.get("attributes") or {}) for node in graph.nodes)
    assert any(
        edge.get("edge_type") == "HANDLES_COMMAND"
        for edge in graph.edges
    )
    assert any(
        node.get("node_type") == "EVENT" and node.get("label") == "assessment/done"
        for node in graph.nodes
    )
