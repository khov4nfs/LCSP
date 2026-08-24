from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from tools.planner.investigation.code_context import CodeContextSession
from tools.planner.investigation.code_context_investigator import (
    MAX_CODE_AWARE_GRAPH_TOOL_STEPS,
    CodeContextLawGuidedInvestigator,
)
from tools.planner.investigation.evidence_ledger import EvidenceLedger
from tools.planner.investigation.investigator import FINISH_TOOL_NAME, GRAPH_TOOL_NAMES
from tools.planner.investigation.models import InvestigationPacket
from tools.common.llm import LLMToolCall, LLMToolResponse


@dataclass
class NativeToolClient:
    responses: list[LLMToolResponse]
    calls: list[dict] = field(default_factory=list)

    def complete(self, *args, **kwargs):
        raise AssertionError("code-aware investigator must use native tools")

    def complete_with_tools(self, **kwargs):
        self.calls.append(kwargs)
        if not self.responses:
            raise AssertionError("unexpected native LLM call")
        return self.responses.pop(0)


def _response(*tool_calls: LLMToolCall) -> LLMToolResponse:
    return LLMToolResponse(
        content="",
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
                "node_id": "charge",
                "node_type": "METHOD",
                "label": "chargePayment",
                "source": {
                    "file_path": "src/payment.py",
                    "start_line": 1,
                    "end_line": 3,
                    "symbol_ref": "PaymentService.chargePayment",
                },
                "attributes": {},
                "semantic_types": ["PAYMENT"],
                "evidence_refs": ["evidence:charge"],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "indexes": {},
        "unresolved_frontiers": [],
        "coverage_state": "SUFFICIENT",
        "coverage_notes": [],
        "provenance": {"scan_job_id": "scan-1"},
        "evidence_refs": ["evidence:charge"],
        "graph_hash": "sha256:graph",
        "schema_version": "2.0.0",
    }


def _workspace(tmp_path: Path) -> Path:
    src = tmp_path / "src"
    src.mkdir()
    (src / "payment.py").write_text(
        "def chargePayment(invoice):\n"
        "    audit_log(invoice)\n"
        "    return invoice.status\n",
        encoding="utf-8",
    )
    return tmp_path


def _packet() -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="PAYMENT_CONTROL",
        investigation_goals=("Verify payment control behavior",),
        initial_results=(),
        keywords=("chargePayment", "audit_log"),
        required_evidence=("PAYMENT_CONTROL",),
    )


def test_seeded_code_candidate_is_source_probed_before_first_llm_turn(
    tmp_path: Path,
) -> None:
    session = CodeContextSession(_graph(), workspace_path=_workspace(tmp_path))
    client = NativeToolClient(
        responses=[
            _response(
                LLMToolCall(
                    name=FINISH_TOOL_NAME,
                    arguments={
                        "claims": [
                            {
                                "criterion": "PAYMENT_CONTROL",
                                "claimType": "UNRESOLVED_ENGINEERING_FACT",
                                "observationRefs": ["obs:0002"],
                                "confidence": 0.5,
                                "limitations": ["ENGINEERING_EVIDENCE_INSUFFICIENT"],
                            }
                        ]
                    },
                    call_id="call-finish",
                )
            )
        ]
    )

    claims = CodeContextLawGuidedInvestigator(client).investigate(
        packet=_packet(),
        graph=_graph(),
        workflow_run_id="workflow-1",
        code_context=session,
    )

    # The orchestrator owns seed ranking and now opens the best production source
    # candidate before asking the model what to do next. The model therefore starts
    # with the complete progress-capable tool set rather than the former
    # get_code+inspect_observation trap.
    first_tools = {tool.name for tool in client.calls[0]["tools"]}
    assert FINISH_TOOL_NAME in first_tools
    assert set(GRAPH_TOOL_NAMES).issubset(first_tools)
    assert "get_code" in first_tools
    assert "inspect_observation" in first_tools
    assert claims[0].claim_type == "UNRESOLVED_ENGINEERING_FACT"
    assert claims[0].evidence_refs == ("evidence:charge",)


def test_source_probe_gate_has_no_inspection_escape_hatch() -> None:
    all_tools = CodeContextLawGuidedInvestigator._code_aware_tool_definitions()
    active = CodeContextLawGuidedInvestigator._runtime_tool_definitions(
        all_tools,
        graph_tool_calls_used=0,
        code_tool_calls_used=0,
        source_probe_required=True,
    )
    assert [tool.name for tool in active] == ["get_code"]


def test_seed_source_candidate_prefers_production_code() -> None:
    candidate = CodeContextLawGuidedInvestigator._seed_source_candidate(
        {
            "results": [
                {
                    "symbolId": "sym:test",
                    "path": "apps/api/src/payment/payment.service.spec.ts",
                },
                {
                    "symbolId": "sym:runtime",
                    "path": "apps/api/src/payment/payment.service.ts",
                },
            ]
        }
    )
    assert candidate is not None
    assert candidate["symbolId"] == "sym:runtime"


def test_exhausted_graph_budget_removes_graph_tools_from_next_native_turn() -> None:
    all_tools = CodeContextLawGuidedInvestigator._code_aware_tool_definitions()
    active = CodeContextLawGuidedInvestigator._runtime_tool_definitions(
        all_tools,
        graph_tool_calls_used=MAX_CODE_AWARE_GRAPH_TOOL_STEPS,
        code_tool_calls_used=0,
        source_probe_required=False,
    )
    names = {tool.name for tool in active}

    assert not names.intersection(GRAPH_TOOL_NAMES)
    assert "search_code" in names
    assert FINISH_TOOL_NAME in names


def test_observation_ids_never_become_fake_unresolved_graph_frontiers() -> None:
    ledger = EvidenceLedger()
    ledger.add(
        source="seed",
        result={"nodes": [{"node_id": "node-1", "node_type": "FUNCTION"}]},
    )

    prepared, error = CodeContextLawGuidedInvestigator._resolve_graph_observation_ref(
        "trace_static_flow",
        {"start_ref": "obs:0001"},
        ledger,
    )
    assert error is None
    assert prepared["start_ref"] == "node-1"

    ledger.add(
        source="seed",
        result={
            "nodes": [
                {"node_id": "node-2", "node_type": "FUNCTION"},
                {"node_id": "node-3", "node_type": "FUNCTION"},
            ]
        },
    )
    _, error = CodeContextLawGuidedInvestigator._resolve_graph_observation_ref(
        "inspect_data_path",
        {"start_ref": "obs:0002"},
        ledger,
    )

    assert error is not None
    assert error["error"] == "OBSERVATION_REF_REQUIRES_GRAPH_NODE_ID"
    assert error["availableNodeRefs"] == ["node-2", "node-3"]
    assert "unresolvedFrontiers" not in error


def test_code_aware_search_nodes_hides_free_form_path_and_semantic_filters() -> None:
    tools = CodeContextLawGuidedInvestigator._code_aware_tool_definitions()
    search = next(tool for tool in tools if tool.name == "search_nodes")
    properties = search.input_schema["properties"]

    assert "path_prefixes" not in properties
    assert "semantic_types" not in properties
