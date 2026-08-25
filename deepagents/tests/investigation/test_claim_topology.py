from __future__ import annotations

import pytest

from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    EvidenceClaimValidationError,
    EvidenceClaimValidator,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import EvidenceClaim
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph


def _node(node_id: str, node_type: str, label: str) -> dict:
    return {
        "node_id": node_id,
        "node_type": node_type,
        "label": label,
        "source": {
            "file_path": "src/service.py",
            "symbol_ref": label,
            "start_line": 1,
            "end_line": 3,
        },
        "attributes": {},
        "semantic_types": [],
        "evidence_refs": [],
        "origin": "STATIC_ANALYSIS",
        "resolution_state": "CORROBORATED",
        "support_refs": [],
    }


def _edge(edge_id: str, edge_type: str, source: str, target: str) -> dict:
    return {
        "edge_id": edge_id,
        "edge_type": edge_type,
        "source_node_id": source,
        "target_node_id": target,
        "confidence": 1.0,
        "attributes": {},
        "evidence_refs": [],
        "coverage_state": "SUFFICIENT",
        "origin": "DATA_LINEAGE",
        "resolution_state": "CORROBORATED",
        "support_refs": [],
    }


def _graph(nodes: list[dict], edges: list[dict]) -> ProgramEvidenceGraph:
    return ProgramEvidenceGraph(
        graph_id="graph-topology",
        snapshot_id="snapshot-topology",
        commit_sha="abc123",
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
        source_anchors=[],
        evidence_refs=[],
        graph_hash="sha256:topology",
    )


def test_ai_output_path_requires_connecting_receives_from_ai_edge() -> None:
    invocation = _node("node:ai", "AI_MODEL_INVOCATION", "responses.create")
    output = _node("node:output", "AI_OUTPUT", "AI output")
    graph = _graph([invocation, output], [])

    with pytest.raises(EvidenceClaimValidationError, match="graph edge provenance"):
        EvidenceClaimValidator().validate(
            EvidenceClaim(
                claim_id="claim-ai-output-disconnected",
                engineering_rule_id="eng-1",
                claim_type="RULE_REQUIREMENT_MET",
                value=True,
                evidence_refs=(),
                graph_path_refs=("node:ai", "node:output"),
                confidence=0.9,
                criterion="AI output path",
            ),
            graph,
        )


def test_ai_output_path_closes_only_with_explicit_topology() -> None:
    invocation = _node("node:ai", "AI_MODEL_INVOCATION", "responses.create")
    output = _node("node:output", "AI_OUTPUT", "AI output")
    receives = _edge("edge:receives", "RECEIVES_FROM_AI", "node:ai", "node:output")
    graph = _graph([invocation, output], [receives])

    validated = EvidenceClaimValidator().validate(
        EvidenceClaim(
            claim_id="claim-ai-output",
            engineering_rule_id="eng-1",
            claim_type="RULE_REQUIREMENT_MET",
            value=True,
            evidence_refs=(),
            graph_path_refs=("node:ai", "edge:receives", "node:output"),
            confidence=0.9,
            criterion="AI output path",
        ),
        graph,
    )

    assert "edge:receives" in validated.graph_path_refs


def test_downstream_path_keeps_topology_refs_even_without_lexical_overlap() -> None:
    output = _node("node:output", "AI_OUTPUT", "result")
    decision = _node("node:decision", "BUSINESS_DECISION", "eligibility")
    effect = _node("node:effect", "REPOSITORY_ACCESS", "repository.save")
    influence = _edge(
        "edge:influence", "INFLUENCES_DECISION", "node:output", "node:decision"
    )
    write = _edge(
        "edge:write", "WRITES_BUSINESS_STATE", "node:decision", "node:effect"
    )
    graph = _graph([output, decision, effect], [influence, write])

    validated = EvidenceClaimValidator().validate(
        EvidenceClaim(
            claim_id="claim-downstream",
            engineering_rule_id="eng-1",
            claim_type="RULE_REQUIREMENT_MET",
            value=True,
            evidence_refs=(),
            graph_path_refs=(
                "node:output",
                "edge:influence",
                "node:decision",
                "edge:write",
                "node:effect",
            ),
            confidence=0.9,
            criterion="DOWNSTREAM_ACTION_PATH",
        ),
        graph,
    )

    assert "edge:influence" in validated.graph_path_refs
    assert "edge:write" in validated.graph_path_refs


def test_human_control_state_requires_review_edge_on_same_path() -> None:
    decision = _node("node:decision", "BUSINESS_DECISION", "eligibility decision")
    review = _node("node:review", "HUMAN_REVIEW", "manual review")
    unrelated = _edge("edge:flow", "FLOWS_TO", "node:decision", "node:review")
    graph = _graph([decision, review], [unrelated])

    with pytest.raises(EvidenceClaimValidationError, match="HUMAN_CONTROL_STATE"):
        EvidenceClaimValidator().validate(
            EvidenceClaim(
                claim_id="claim-human",
                engineering_rule_id="eng-1",
                claim_type="RULE_REQUIREMENT_MET",
                value=True,
                evidence_refs=(),
                graph_path_refs=("node:decision", "edge:flow", "node:review"),
                confidence=0.9,
                criterion="human control state",
            ),
            graph,
        )


def test_human_control_absence_requires_bounded_decision_effect_path() -> None:
    decision = _node("node:decision", "BUSINESS_DECISION", "eligibility")
    effect = _node("node:effect", "REPOSITORY_ACCESS", "repository.save")
    write = _edge(
        "edge:write", "WRITES_BUSINESS_STATE", "node:decision", "node:effect"
    )
    graph = _graph([decision, effect], [write])

    validated = EvidenceClaimValidator().validate(
        EvidenceClaim(
            claim_id="claim-human-absent",
            engineering_rule_id="eng-1",
            claim_type="RULE_REQUIREMENT_NOT_MET",
            value=False,
            evidence_refs=(),
            graph_path_refs=("node:decision", "edge:write", "node:effect"),
            confidence=0.9,
            criterion="HUMAN_CONTROL_STATE",
        ),
        graph,
    )

    assert "edge:write" in validated.graph_path_refs


def test_human_control_absence_rejects_attached_review() -> None:
    decision = _node("node:decision", "BUSINESS_DECISION", "eligibility")
    effect = _node("node:effect", "REPOSITORY_ACCESS", "repository.save")
    review = _node("node:review", "HUMAN_REVIEW", "manual review")
    write = _edge(
        "edge:write", "WRITES_BUSINESS_STATE", "node:decision", "node:effect"
    )
    reviewed = _edge("edge:review", "REVIEWED_BY", "node:decision", "node:review")
    graph = _graph([decision, effect, review], [write, reviewed])

    with pytest.raises(EvidenceClaimValidationError, match="conflicts"):
        EvidenceClaimValidator().validate(
            EvidenceClaim(
                claim_id="claim-human-conflict",
                engineering_rule_id="eng-1",
                claim_type="RULE_REQUIREMENT_NOT_MET",
                value=False,
                evidence_refs=(),
                graph_path_refs=(
                    "node:decision",
                    "edge:write",
                    "node:effect",
                    "edge:review",
                    "node:review",
                ),
                confidence=0.9,
                criterion="HUMAN_CONTROL_STATE",
            ),
            graph,
        )
