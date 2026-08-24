from __future__ import annotations

import json

import pytest

from tools.planner.investigation.code_context_investigator import (
    CodeContextLawGuidedInvestigator,
)
from tools.planner.investigation.evidence_ledger import EvidenceLedger
from tools.planner.investigation.investigator import LawGuidedInvestigator
from tools.planner.investigation.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    InvestigationPacket,
)
from tools.graph.scanner.program_graph.vocabulary import EDGE_TYPES, NODE_TYPES


def _packet() -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="TRANSPARENCY",
        investigation_goals=("Trace AI output to the user-visible disclosure control",),
        initial_results=(),
        starting_node_types=("AI_OUTPUT",),
        target_node_types=("HTTP_RESPONSE", "NOTIFICATION"),
        edge_strategies=("CALLS", "RETURNS"),
        graph_queries=(
            {
                "name": "trace-output",
                "startNodeTypes": ["AI_OUTPUT"],
                "direction": "FORWARD",
                "followEdges": ["CALLS", "RETURNS"],
                "stopNodeTypes": ["HTTP_RESPONSE", "NOTIFICATION"],
                "semanticTypes": [],
            },
        ),
        keywords=("disclosure", "label", "watermark"),
        common_apis=("renderDisclosure",),
        common_libraries=("@lcsp/i18n",),
        patterns=("AI-generated",),
        required_evidence=("AI_OUTPUT_SURFACE",),
        supporting_evidence=("DISCLOSURE_OR_LABEL_CONTROL",),
        negative_evidence=("AI_OUTPUT_WITHOUT_EVIDENCED_TRANSPARENCY_CONTROL",),
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
                "node_type": "AI_OUTPUT",
                "label": "AI output",
                "source": {"file_path": "src/output.py", "symbol_ref": "render"},
                "attributes": {},
                "semantic_types": [],
                "evidence_refs": ["evidence:1"],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "indexes": {},
        "unresolved_frontiers": [],
        "coverage_state": "SUFFICIENT",
        "coverage_notes": [],
        "provenance": {"scan_job_id": "scan-1"},
        "evidence_refs": ["evidence:1"],
        "graph_hash": "sha256:graph",
        "schema_version": "2.0.0",
    }


def test_rule_contract_exposes_retrieval_hints_separately_from_evidence_labels() -> None:
    payload = json.loads(
        LawGuidedInvestigator._prompt(_packet(), EvidenceLedger(), [], 0)
    )
    rule = payload["engineeringRule"]

    assert rule["startingNodeTypes"] == ["AI_OUTPUT"]
    assert rule["targetNodeTypes"] == ["HTTP_RESPONSE", "NOTIFICATION"]
    assert rule["edgeStrategies"] == ["CALLS", "RETURNS"]
    assert rule["graphQueries"][0]["startNodeTypes"] == ["AI_OUTPUT"]
    assert rule["retrievalHints"]["keywords"] == ["disclosure", "label", "watermark"]
    assert rule["requiredEvidence"] == ["AI_OUTPUT_SURFACE"]
    assert any("NOT Program Evidence Graph node types" in row for row in payload["claimRules"])


def test_graph_tool_schema_only_allows_canonical_node_and_edge_vocabulary() -> None:
    tools = {tool.name: tool for tool in LawGuidedInvestigator._tool_definitions()}
    search_items = tools["search_nodes"].input_schema["properties"]["node_types"]["items"]
    trace = tools["trace_static_flow"].input_schema["properties"]

    assert set(search_items["enum"]) == set(NODE_TYPES)
    assert set(trace["edge_types"]["items"]["enum"]) == set(EDGE_TYPES)
    assert set(trace["stop_node_types"]["items"]["enum"]) == set(NODE_TYPES)

    with pytest.raises(ValueError, match="non-canonical"):
        LawGuidedInvestigator._normalize_tool_arguments(
            "search_nodes",
            {"node_types": ["AI_OUTPUT_SURFACE"]},
        )


def test_code_prompt_drives_targeted_search_then_source_expansion() -> None:
    payload = json.loads(
        CodeContextLawGuidedInvestigator._code_prompt(
            _packet(), EvidenceLedger(), [], 0
        )
    )

    assert payload["codeInvestigationFlow"][0].startswith(
        "SEARCH: LCSP deterministically seeds code search from EngineeringRule retrievalHints"
    )
    assert any("get_code" in row and "implementation behavior" in row for row in payload["codeContextRules"])
    assert any("Tests, specs, mocks" in row for row in payload["codeContextRules"])


def test_finish_schema_requires_exact_required_evidence_criterion_scope() -> None:
    finish = LawGuidedInvestigator._finish_tool_definition()
    claim_schema = finish.input_schema["properties"]["claims"]["items"]

    assert "criterion" in claim_schema["properties"]
    assert "criterion" in claim_schema["required"]
    assert "observationRefs" in claim_schema["properties"]
    assert "evidenceRefs" not in claim_schema["properties"]


def test_invalid_finish_criterion_fails_closed_to_unresolved() -> None:
    ledger = EvidenceLedger()
    observation = ledger.add(
        source="graph_tool",
        result={
            "nodes": [_graph()["nodes"][0]],
            "evidenceRefs": ["evidence:1"],
            "truncated": False,
        },
    )
    investigator = LawGuidedInvestigator(llm_client=object())

    claims = investigator._claims_from_payload(
        {
            "claims": [
                {
                    "criterion": "DISCLOSURE_OR_LABEL_CONTROL",
                    "claimType": ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
                    "observationRefs": [observation.observation_id],
                    "confidence": 0.9,
                    "limitations": [],
                }
            ]
        },
        _packet(),
        _graph(),
        ledger,
    )

    assert claims[0].criterion is None
    assert claims[0].claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
    assert ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"] in claims[0].limitations