from __future__ import annotations

from tools.common.capabilities.evidence.graph.resolution.architecture.redux_extended_resolution import (
    ReduxExtendedResolver,
)
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticProgram


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {(edge.edge_type, edge.source_key, edge.target_key) for edge in program.edges}


def test_rtk_listener_middleware_consumes_static_action_creator(tmp_path) -> None:
    (tmp_path / "listener.ts").write_text(
        '''
const saved = createAction("profile/saved");
function auditEffect(action, api) { return action; }

listenerMiddleware.startListening({
  actionCreator: saved,
  effect: auditEffect,
});

dispatch(saved({ id: 1 }));
''',
        encoding="utf-8",
    )

    program = ReduxExtendedResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)
    event = "event:redux:profile/saved"

    assert ("CONSUMES_EVENT", event, "symbol:listener.ts:auditEffect") in edges
    assert any(edge[0] == "PUBLISHES_EVENT" and edge[2] == event for edge in edges)


def test_redux_observable_epic_consumes_oftype_action(tmp_path) -> None:
    (tmp_path / "epic.ts").write_text(
        '''
const requested = createAction("profile/requested");
const loadProfileEpic = (action$) => action$.pipe(
  ofType(requested),
  mergeMap(() => api.load()),
);
''',
        encoding="utf-8",
    )

    program = ReduxExtendedResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)

    assert (
        "CONSUMES_EVENT",
        "event:redux:profile/requested",
        "symbol:epic.ts:loadProfileEpic",
    ) in edges
