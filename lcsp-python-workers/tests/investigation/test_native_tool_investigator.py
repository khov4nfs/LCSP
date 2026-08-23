from __future__ import annotations

import json
from dataclasses import dataclass, field
from unittest.mock import patch

from lcsp_workers.investigation.evidence_ledger import EvidenceLedger
from lcsp_workers.investigation.investigator import (
    FINISH_TOOL_NAME,
    GRAPH_TOOL_NAMES,
    MAX_INVESTIGATION_STEPS,
    MAX_PROMPT_CHARS,
    STATE_TOOL_NAMES,
    LawGuidedInvestigator,
)
from lcsp_workers.investigation.models import (
    ENGINEERING_LIMITATION_CODES,
    MODEL_SELECTABLE_LIMITATION_CODES,
    InvestigationPacket,
)
from lcsp_workers.llm import LLMToolCall, LLMToolResponse


@dataclass
class NativeToolClient:
    responses: list[LLMToolResponse]
    calls: list[dict] = field(default_factory=list)

    def complete(self, *args, **kwargs):
        raise AssertionError("LawGuidedInvestigator must not use text completion")

    def complete_with_tools(self, **kwargs):
        self.calls.append(kwargs)
        if not self.responses:
            raise AssertionError("unexpected native LLM call")
        return self.responses.pop(0)


def _response(*tool_calls: LLMToolCall, content: str = "") -> LLMToolResponse:
    return LLMToolResponse(
        content=content,
        input_tokens=10,
        output_tokens=5,
        model="gpt-4o-mini",
        provider="openai",
        request_id="req-1",
        tool_calls=tuple(tool_calls),
    )


def _graph() -> dict:
    return {
        "graph_id": "graph-1",
        "snapshot_id": "snapshot-1",
        "commit_sha": "abc123",
        "node_count": 1,
        "edge_count": 0,
        "nodes": [
            {
                "node_id": "node-1",
                "node_type": "HUMAN_REVIEW",
                "label": "human review",
                "source": {"file_path": "src/review.py", "symbol_ref": "review"},
                "attributes": {},
                "semantic_types": ["HUMAN_OVERSIGHT"],
                "evidence_refs": ["evidence:review-1"],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "indexes": {},
        "unresolved_frontiers": [],
        "coverage_state": "SUFFICIENT",
        "coverage_notes": [],
        "provenance": {"scan_job_id": "scan-1"},
        "evidence_refs": ["evidence:review-1"],
        "graph_hash": "sha256:graph",
        "schema_version": "2.0.0",
    }


def _packet(*, initial_results: tuple[dict, ...] = ()) -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="HUMAN_OVERSIGHT",
        investigation_goals=("Find human review controls",),
        initial_results=initial_results,
        required_evidence=("A bounded human review path",),
    )


def _seed_result() -> dict:
    return {
        "query": "human-review",
        "startNodeId": "node-1",
        "nodes": [_graph()["nodes"][0]],
        "edges": [],
        "paths": [["node-1"]],
        "truncated": False,
        "unresolvedFrontiers": [],
        "evidenceRefs": ["evidence:review-1"],
    }


def _finish_call(
    *,
    claim_type: str = "RULE_REQUIREMENT_MET",
    observation_refs: list[str] | None = None,
    limitations: list[str] | None = None,
) -> LLMToolCall:
    return LLMToolCall(
        name=FINISH_TOOL_NAME,
        call_id="call-finish",
        arguments={
            "claims": [
                {
                    "claimType": claim_type,
                    "observationRefs": observation_refs or [],
                    "confidence": 0.95,
                    "limitations": limitations or [],
                }
            ]
        },
    )


def _native_search_then_finish_client() -> NativeToolClient:
    return NativeToolClient(
        responses=[
            _response(
                LLMToolCall(
                    name="search_nodes",
                    arguments={"node_types": ["HUMAN_REVIEW"], "max_results": 5},
                    call_id="call-search",
                )
            ),
            _response(_finish_call(observation_refs=["obs:0001"])),
        ]
    )


def test_investigator_uses_lossless_observation_ref_for_native_finish() -> None:
    client = _native_search_then_finish_client()

    claims = LawGuidedInvestigator(client).investigate(
        packet=_packet(),
        graph=_graph(),
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
    )

    assert claims[0].claim_type == "RULE_REQUIREMENT_MET"
    assert claims[0].value is True
    assert claims[0].evidence_refs == ("evidence:review-1",)
    assert claims[0].graph_path_refs == ("node-1",)

    first_tool_names = {tool.name for tool in client.calls[0]["tools"]}
    assert first_tool_names == {
        *GRAPH_TOOL_NAMES,
        *STATE_TOOL_NAMES,
        FINISH_TOOL_NAME,
    }
    payload = json.loads(client.calls[1]["prompt"])
    assert payload["evidenceLedger"]["total"] == 1
    assert payload["evidenceLedger"]["observations"][0]["observationId"] == "obs:0001"


def test_tool_result_log_contains_terminal_safe_observation_summary() -> None:
    client = _native_search_then_finish_client()

    with patch("lcsp_workers.investigation.investigator.logger") as logger:
        LawGuidedInvestigator(client).investigate(
            packet=_packet(),
            graph=_graph(),
            workflow_run_id="workflow-1",
            correlation_id="corr-1",
        )

    tool_result = next(
        call
        for call in logger.info.call_args_list
        if call.args[0] == "ENGINEERING_INVESTIGATION_TOOL_RESULT"
        and call.kwargs["tool"] == "search_nodes"
    )
    assert tool_result.kwargs["result_summary"]["observationId"] == "obs:0001"
    assert "result" not in tool_result.kwargs


def test_evidence_ledger_keeps_full_seed_results_while_prompt_uses_index() -> None:
    huge_result = {
        "query": "large-query",
        "startNodeId": "node-1",
        "nodes": [
            {
                "node_id": f"node-{index}",
                "node_type": "SYMBOL",
                "label": "x" * 10_000,
                "evidence_refs": [f"evidence:{index}"],
            }
            for index in range(100)
        ],
        "edges": [],
        "paths": [],
        "truncated": False,
        "unresolvedFrontiers": [],
        "evidenceRefs": [f"evidence:{index}" for index in range(100)],
    }
    ledger = EvidenceLedger()
    for _ in range(100):
        ledger.add(source="engineering_rule_seed_query", result=huge_result)

    prompt = LawGuidedInvestigator._prompt(_packet(), ledger, [], 0)
    payload = json.loads(prompt)

    assert ledger.total == 100
    assert ledger.get("obs:0100").result["nodes"][99]["label"] == "x" * 10_000
    assert payload["evidenceLedger"]["total"] == 100
    assert payload["evidenceLedger"]["hasMore"] is True
    assert len(payload["evidenceLedger"]["observations"]) == 20
    assert len(prompt) <= MAX_PROMPT_CHARS


def test_model_can_page_and_inspect_observations_without_resending_full_history() -> None:
    client = NativeToolClient(
        responses=[
            _response(
                LLMToolCall(
                    name="list_observations",
                    arguments={"offset": 0, "limit": 10},
                    call_id="call-list",
                )
            ),
            _response(
                LLMToolCall(
                    name="inspect_observation",
                    arguments={
                        "observation_id": "obs:0001",
                        "section": "nodes",
                        "offset": 0,
                        "limit": 1,
                    },
                    call_id="call-inspect",
                )
            ),
            _response(_finish_call(observation_refs=["obs:0001"])),
        ]
    )

    claims = LawGuidedInvestigator(client).investigate(
        packet=_packet(initial_results=(_seed_result(),)),
        graph=_graph(),
        workflow_run_id="workflow-1",
    )

    assert claims[0].claim_type == "RULE_REQUIREMENT_MET"
    inspect_prompt = json.loads(client.calls[2]["prompt"])
    recent = inspect_prompt["recentToolResults"][-1]
    assert recent["tool"] == "inspect_observation"
    assert recent["result"]["observationId"] == "obs:0001"
    assert recent["result"]["items"][0]["node_id"] == "node-1"


def test_finish_schema_accepts_observation_refs_not_model_authored_graph_refs() -> None:
    finish = LawGuidedInvestigator._finish_tool_definition()
    claim_schema = finish.input_schema["properties"]["claims"]["items"]
    props = claim_schema["properties"]

    assert "observationRefs" in props
    assert "evidenceRefs" not in props
    assert "graphPathRefs" not in props
    assert "sourceAnchorRefs" not in props
    assert "value" not in props
    assert props["limitations"]["items"]["enum"] == sorted(
        MODEL_SELECTABLE_LIMITATION_CODES
    )


def test_unknown_observation_ref_fails_closed_without_invented_provenance() -> None:
    client = NativeToolClient(
        responses=[_response(_finish_call(observation_refs=["obs:9999"]))]
    )

    with patch("lcsp_workers.investigation.investigator.logger") as logger:
        claims = LawGuidedInvestigator(client).investigate(
            packet=_packet(),
            graph=_graph(),
            workflow_run_id="workflow-1",
        )

    assert claims[0].claim_type == "UNRESOLVED_ENGINEERING_FACT"
    assert claims[0].evidence_refs == ()
    assert ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"] in claims[0].limitations
    rejected = next(
        call
        for call in logger.warning.call_args_list
        if call.args[0] == "ENGINEERING_INVESTIGATION_CLAIM_REJECTED"
    )
    assert "unknown observation ref" in rejected.kwargs["error_message"]


def test_noncanonical_model_limitation_still_fails_closed() -> None:
    client = NativeToolClient(
        responses=[
            _response(
                _finish_call(
                    claim_type="UNRESOLVED_ENGINEERING_FACT",
                    limitations=["System appears compliant based on external evidence."],
                )
            )
        ]
    )

    claims = LawGuidedInvestigator(client).investigate(
        packet=_packet(),
        graph=_graph(),
        workflow_run_id="workflow-1",
    )

    assert claims[0].claim_type == "UNRESOLVED_ENGINEERING_FACT"
    assert claims[0].limitations == (
        ENGINEERING_LIMITATION_CODES["model_limitation_code_invalid"],
    )


def test_investigator_forces_finish_after_bounded_turns() -> None:
    client = NativeToolClient(
        responses=[
            *[_response(content="plain text is ignored") for _ in range(MAX_INVESTIGATION_STEPS)],
            _response(
                _finish_call(
                    claim_type="UNRESOLVED_ENGINEERING_FACT",
                    observation_refs=[],
                )
            ),
        ]
    )

    claims = LawGuidedInvestigator(client).investigate(
        packet=_packet(),
        graph=_graph(),
        workflow_run_id="workflow-1",
    )

    assert claims[0].claim_type == "UNRESOLVED_ENGINEERING_FACT"
    assert len(client.calls) == MAX_INVESTIGATION_STEPS + 1
    assert [tool.name for tool in client.calls[-1]["tools"]] == [FINISH_TOOL_NAME]
    assert client.calls[-1]["node_name"] == "investigate_engineering_rule_finish"
