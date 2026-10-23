"""Authoring in parts must not make the model's history grow with the size of the draft."""

from __future__ import annotations

from test_rule_set_preparation_agent import _legacy_packet_unit_tools  # noqa: F401 - explicit legacy packet unit adapter

import json
from pathlib import Path

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from rule_set_preparation.draft_history import compact_draft_history
from rule_set_preparation.runner import run_rule_set_preparation
from test_rule_set_preparation_agent import (  # noqa: F401 - the autouse fixture applies per module
    RUN_ID,
    FakeApi,
    _call,
    _fast_model_retry_backoff,
    _model,
    _packet,
)


def _round(index: int, tool: str = "add_to_packet_draft") -> list:
    args = (
        {"legalRequirements": [{"legalRequirementId": f"LR-{index}", "title": f"Duty {index}", "proposition": "x" * 2000}]}
        if tool == "add_to_packet_draft" else {}
    )
    return [
        AIMessage(content="", tool_calls=[{"name": tool, "args": args, "id": f"c{index}"}]),
        ToolMessage(content="{}", tool_call_id=f"c{index}"),
    ]


def test_old_draft_rounds_are_replaced_by_one_label_list_and_recent_rounds_stay_intact() -> None:
    read = [AIMessage(content="", tool_calls=[{"name": "read_file", "args": {"file_path": "/x"}, "id": "r"}]),
            ToolMessage(content="text", tool_call_id="r")]
    history = [HumanMessage(content="start"), *read]
    for index in range(8):
        history += _round(index)
        if index % 3 == 2:
            history += _round(100 + index, "validate_compliance_rule_set")
    compacted = compact_draft_history(history, keep_adds=2, keep_checks=1)

    summary = next(m for m in compacted if isinstance(m, HumanMessage) and "already added" in m.content)
    assert "LR-0 (Duty 0)" in summary.content and "LR-5 (Duty 5)" in summary.content
    assert "LR-7" not in summary.content  # the two newest rounds are still in the conversation itself
    kept_adds = [m.tool_calls[0]["args"]["legalRequirements"][0]["legalRequirementId"]
                 for m in compacted if isinstance(m, AIMessage) and m.tool_calls and m.tool_calls[0]["name"] == "add_to_packet_draft"]
    assert kept_adds == ["LR-6", "LR-7"]
    # every remaining tool result still follows its call, and other tools are untouched
    calls = {c["id"] for m in compacted if isinstance(m, AIMessage) for c in m.tool_calls}
    assert all(m.tool_call_id in calls for m in compacted if isinstance(m, ToolMessage))
    assert "r" in calls and len(json.dumps([m.content for m in compacted])) < 9000
    assert len(history) > 3 * len(compacted) // 2  # the input list is not modified in place


def test_short_histories_and_other_tool_calls_are_left_alone() -> None:
    history = [AIMessage(content="", tool_calls=[{"name": "read_file", "args": {}, "id": "r"}]), *_round(0)]
    assert compact_draft_history(history) is history


def test_request_size_stays_flat_while_the_draft_grows(tmp_path: Path) -> None:
    packet = _packet()
    adds = [
        _call("add_to_packet_draft", {"legalRequirements": [
            {**packet["legalRequirements"][0], "legalRequirementId": f"LR-{n}", "proposition": "p" * 3000}]}, f"add-{n}")
        for n in range(30)
    ]
    model = _model([
        *adds,
        _call("add_to_packet_draft", {"assessmentRules": packet["assessmentRules"],
                                      "contextRelations": packet["contextRelations"]}, "rules"),
        _call("validate_compliance_rule_set", {}, "validate"),
        _call("submit_compliance_rule_set", {}, "submit"),
        AIMessage(content="DONE"),
    ])
    api = FakeApi()
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)

    sizes = [len(prompt) for prompt in model.prompts]
    assert result["state"] == "SUCCEEDED"
    assert max(sizes) <= 12, sizes  # messages sent per call stay bounded however many parts were added
    last_validation = [call for call in api.calls if call[0] == "validate"][-1]
    assert len(last_validation[1][1]["legalRequirements"]) == 30  # the draft itself is complete


def test_incremental_history_remains_bounded_and_keeps_phase_transitions():
    history = [HumanMessage(content="discover")]
    history += _round(1000, "finalize_semantic_claim_inventory")
    for i in range(1000):
        history += _round(i, "register_semantic_claim")
    history += _round(1001, "start_rule_authoring")
    for i in range(20):
        history += _round(2000 + i, "validate_compliance_rule_set")
    compacted = compact_draft_history(history)
    names = [c["name"] for m in compacted if isinstance(m, AIMessage) for c in m.tool_calls]
    assert names.count("register_semantic_claim") == 3
    assert names.count("validate_compliance_rule_set") == 2
    assert "finalize_semantic_claim_inventory" in names and "start_rule_authoring" in names
    assert any("get_claim_inventory" in m.content for m in compacted if isinstance(m, HumanMessage))
    assert len(compacted) < 20
