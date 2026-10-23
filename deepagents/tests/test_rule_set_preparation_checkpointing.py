"""The nested Preparation agent must not write checkpoints into the Agent Server run's saver.

Production: a silent deadlock in LangGraph's checkpoint put chain (all pool workers waiting on
queued predecessors) stalled a run for 10+ minutes right after the document fan-out.
"""

from __future__ import annotations

from test_rule_set_preparation_agent import _legacy_packet_unit_tools  # noqa: F401 - explicit legacy packet unit adapter

from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from middleware import usage_metering
from rule_set_preparation.runner import run_rule_set_preparation
from test_rule_set_preparation_agent import _call
from test_rule_set_preparation_parallelism import (
    RUN_ID,
    _Api,
    _bundle,
    _ParallelPreparationModel,
)
from typing_extensions import TypedDict


class _State(TypedDict, total=False):
    done: bool


@pytest.fixture(autouse=True)
def _allow_provider_free_model(monkeypatch: pytest.MonkeyPatch) -> None:
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity",
                        lambda model, response=None: None if isinstance(model, _ParallelPreparationModel)
                        else original(model, response))


def test_preparation_inside_an_agent_server_run_writes_no_nested_checkpoints(tmp_path: Path) -> None:
    packet = {"legalRequirements": [], "assessmentRules": [], "contextRelations": []}
    model = _ParallelPreparationModel(responses=[
        AIMessage(content="", tool_calls=[
            {"name": "task", "args": {"description": f"Read document {document} only at /legal-source/{document}.",
                                      "subagent_type": "legal-source-reader"}, "id": f"read-{document}"}
            for document in ("134-2025-QH15", "LAW-71-2025-QH15")]),
        _call("validate_compliance_rule_set", {"packet": packet}, "validate"),
        _call("submit_compliance_rule_set", {"packet": packet}, "submit"),
    ])

    class Api(_Api):
        def claim_rule_set_preparation(self, run_id: str) -> dict[str, Any]:
            return _bundle()

    api = Api()
    results: list[dict[str, Any]] = []

    def prepare(state: _State) -> _State:
        results.append(run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path))
        return {"done": True}

    saver = InMemorySaver()
    outer = StateGraph(_State)
    outer.add_node("prepare", prepare)
    outer.add_edge(START, "prepare")
    outer.add_edge("prepare", END)
    outer.compile(checkpointer=saver).invoke({}, {"configurable": {"thread_id": "agent-server-run"}})

    assert results[0]["state"] == "SUCCEEDED" and api.calls == ["validate", "submit"]
    namespaces = {checkpoint.config["configurable"].get("checkpoint_ns", "")
                  for checkpoint in saver.list({"configurable": {"thread_id": "agent-server-run"}})}
    assert namespaces == {""}, namespaces  # only the outer run's own checkpoints
