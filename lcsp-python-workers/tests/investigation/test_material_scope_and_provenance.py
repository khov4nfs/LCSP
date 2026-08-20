from __future__ import annotations

import pytest

from lcsp_workers.investigation.evidence_claim_validator import (
    EvidenceClaimValidationError,
    EvidenceClaimValidator,
)
from lcsp_workers.investigation.material_scope import material_planning_packet
from lcsp_workers.investigation.models import EvidenceClaim, InvestigationPacket
from lcsp_workers.legal.engineering_rules.models import EngineeringRule
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph
from lcsp_workers.scanner.program_graph.source_roles import (
    filter_program_evidence_graph,
    is_test_source_path,
)


def _rule(**overrides) -> EngineeringRule:
    payload = {
        "engineeringRuleId": "eng-health",
        "legalRuleId": "legal-health",
        "legalRuleCatalogVersionId": "catalog-v1",
        "legalCorpusVersionId": "corpus-v1",
        "concept": "HEALTH_AI_SAFETY_DATA_PROTECTION",
        "legalIntent": {},
        "investigationGoals": ["verify patient health data protection"],
        "startingNodeTypes": ["AI_MODEL_INVOCATION"],
        "targetNodeTypes": ["SENSITIVE_DATA"],
        "edgeStrategies": [],
        "graphQueries": [],
        "keywords": ["health", "medical", "patient"],
        "requiredEvidence": ["patient health data protection"],
    }
    payload.update(overrides)
    return EngineeringRule.from_dict(payload)


def _node(
    node_id: str,
    *,
    label: str,
    path: str,
    evidence_ref: str,
    node_type: str = "AI_MODEL_INVOCATION",
) -> dict:
    return {
        "node_id": node_id,
        "node_type": node_type,
        "label": label,
        "source": {
            "file_path": path,
            "symbol_ref": label,
            "start_line": 1,
            "end_line": 3,
        },
        "attributes": {},
        "semantic_types": [],
        "evidence_refs": [evidence_ref],
    }


def _graph(nodes: list[dict]) -> ProgramEvidenceGraph:
    anchors = [
        {
            "anchor_id": f"anchor:{index}",
            "snapshot_id": "snapshot-1",
            "commit_sha": "abc123",
            "file_path": node["source"]["file_path"],
            "symbol_ref": node["source"]["symbol_ref"],
            "start_line": 1,
            "end_line": 3,
            "source_hash": f"sha256:{index}",
            "graph_node_id": node["node_id"],
        }
        for index, node in enumerate(nodes, 1)
    ]
    evidence_refs = sorted(
        {ref for node in nodes for ref in node.get("evidence_refs") or []}
    )
    return ProgramEvidenceGraph(
        graph_id="graph-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        node_count=len(nodes),
        edge_count=0,
        nodes=nodes,
        edges=[],
        source_anchors=anchors,
        evidence_refs=evidence_refs,
        graph_hash="sha256:graph",
    )


def test_test_source_path_policy_covers_common_python_and_js_specs() -> None:
    assert is_test_source_path("tests/test_worker.py")
    assert is_test_source_path("apps/api/src/foo.handler.spec.ts")
    assert is_test_source_path("apps/web/__tests__/route.test.tsx")
    assert is_test_source_path("lcsp-python-workers/fixtures/sample.py")
    assert not is_test_source_path("apps/api/src/foo.handler.ts")
    assert not is_test_source_path("lcsp-python-workers/src/lcsp_workers/runtime.py")


def test_runtime_graph_filter_removes_test_nodes_anchors_and_refs() -> None:
    prod = _node(
        "node:prod",
        label="production handler",
        path="apps/api/src/handler.ts",
        evidence_ref="evidence:prod",
    )
    test = _node(
        "node:test",
        label="test handler",
        path="apps/api/src/handler.spec.ts",
        evidence_ref="evidence:test",
    )
    filtered = filter_program_evidence_graph(_graph([prod, test]))

    assert filtered.node_count == 1
    assert [node["node_id"] for node in filtered.nodes] == ["node:prod"]
    assert filtered.evidence_refs == ["evidence:prod"]
    assert [anchor["graph_node_id"] for anchor in filtered.source_anchors] == [
        "node:prod"
    ]
    assert filtered.provenance["test_source_policy"] == "EXCLUDED"


def test_material_scope_ignores_generic_ai_seed_and_test_health_seed() -> None:
    generic = _node(
        "node:generic",
        label="gateway complete",
        path="src/gateway.py",
        evidence_ref="evidence:generic",
    )
    health = _node(
        "node:health",
        label="patient health inference",
        path="src/health_service.py",
        evidence_ref="evidence:health",
    )
    test_health = _node(
        "node:test-health",
        label="patient health inference",
        path="tests/test_health_service.py",
        evidence_ref="evidence:test-health",
    )
    packet = InvestigationPacket(
        engineering_rule_id="eng-health",
        concept="HEALTH_AI_SAFETY_DATA_PROTECTION",
        investigation_goals=("verify patient health data protection",),
        initial_results=(
            {
                "query": "health-seed",
                "nodes": [generic, health, test_health],
                "evidenceRefs": [
                    "evidence:generic",
                    "evidence:health",
                    "evidence:test-health",
                ],
            },
        ),
        starting_node_types=("AI_MODEL_INVOCATION",),
        keywords=("health", "medical", "patient"),
        required_evidence=("patient health data protection",),
    )

    material = material_planning_packet(_rule(), packet)
    row = material.initial_results[0]
    assert [node["node_id"] for node in row["nodes"]] == ["node:health"]
    assert row["rawHitCount"] == 3
    assert row["materialHitCount"] == 1
    assert material.evidence_refs == ("evidence:health",)


def test_claim_validator_drops_test_evidence_and_minimizes_to_criterion() -> None:
    prod = _node(
        "node:prod",
        label="incident reporting notifier",
        path="src/incident_reporting.py",
        evidence_ref="evidence:prod",
        node_type="NOTIFICATION",
    )
    test = _node(
        "node:test",
        label="incident reporting notifier",
        path="tests/test_incident_reporting.py",
        evidence_ref="evidence:test",
        node_type="NOTIFICATION",
    )
    generic_nodes = [
        _node(
            f"node:generic:{index}",
            label=f"generic handler {index}",
            path=f"src/generic_{index}.py",
            evidence_ref=f"evidence:generic:{index}",
            node_type="FUNCTION",
        )
        for index in range(12)
    ]
    graph = _graph([prod, test, *generic_nodes])
    claim = EvidenceClaim(
        claim_id="claim-1",
        engineering_rule_id="eng-1",
        claim_type="RULE_REQUIREMENT_MET",
        value=True,
        evidence_refs=tuple(graph.evidence_refs),
        confidence=0.9,
        criterion="incident reporting notification",
    )

    validated = EvidenceClaimValidator().validate(claim, graph)
    all_refs = {
        *validated.evidence_refs,
        *validated.graph_path_refs,
        *validated.source_anchor_refs,
    }
    assert "evidence:test" not in all_refs
    assert "evidence:prod" in all_refs
    assert len(all_refs) <= 8


def test_specific_criterion_rejects_unrelated_production_refs() -> None:
    unrelated = _node(
        "node:unrelated",
        label="generic command handler",
        path="src/commands.py",
        evidence_ref="evidence:unrelated",
        node_type="FUNCTION",
    )
    graph = _graph([unrelated])

    with pytest.raises(EvidenceClaimValidationError):
        EvidenceClaimValidator().validate(
            EvidenceClaim(
                claim_id="claim-unrelated",
                engineering_rule_id="eng-1",
                claim_type="RULE_REQUIREMENT_MET",
                value=True,
                evidence_refs=("evidence:unrelated",),
                confidence=0.9,
                criterion="incident reporting notification",
            ),
            graph,
        )


def test_test_only_or_zero_confidence_closed_claim_fails_closed() -> None:
    test = _node(
        "node:test",
        label="incident reporting notifier",
        path="tests/test_incident_reporting.py",
        evidence_ref="evidence:test",
        node_type="NOTIFICATION",
    )
    graph = _graph([test])
    validator = EvidenceClaimValidator()

    with pytest.raises(EvidenceClaimValidationError):
        validator.validate(
            EvidenceClaim(
                claim_id="claim-test",
                engineering_rule_id="eng-1",
                claim_type="RULE_REQUIREMENT_NOT_MET",
                value=False,
                evidence_refs=("evidence:test",),
                confidence=0.8,
                criterion="incident reporting notification",
            ),
            graph,
        )

    prod = _node(
        "node:prod",
        label="incident reporting notifier",
        path="src/incident_reporting.py",
        evidence_ref="evidence:prod",
        node_type="NOTIFICATION",
    )
    prod_graph = _graph([prod])
    with pytest.raises(EvidenceClaimValidationError):
        validator.validate(
            EvidenceClaim(
                claim_id="claim-zero",
                engineering_rule_id="eng-1",
                claim_type="RULE_REQUIREMENT_NOT_MET",
                value=False,
                evidence_refs=("evidence:prod",),
                confidence=0.0,
                criterion="incident reporting notification",
            ),
            prod_graph,
        )
