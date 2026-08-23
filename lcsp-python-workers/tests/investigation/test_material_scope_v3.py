from __future__ import annotations

from lcsp_workers.investigation.material_scope import material_planning_packet
from lcsp_workers.investigation.models import InvestigationPacket
from lcsp_workers.legal.engineering_rules.models import EngineeringRule


def _rule(*, target_node_types=("SENSITIVE_DATA",), concept="biometric identity verification"):
    return EngineeringRule(
        engineering_rule_id="er:v3",
        legal_rule_id="lr:v3",
        legal_rule_catalog_version_id="catalog",
        legal_corpus_version_id="corpus",
        concept=concept,
        legal_intent={},
        investigation_goals=("verify biometric processing",),
        starting_node_types=("DATA_OBJECT",),
        target_node_types=target_node_types,
        edge_strategies=("FLOWS_TO",),
        graph_queries=(),
        required_evidence=("biometric processing evidence",),
    )


def _packet(node: dict, *, semantic_types=("SENSITIVE.BIOMETRIC",)):
    return InvestigationPacket(
        engineering_rule_id="er:v3",
        concept="biometric identity verification",
        investigation_goals=("verify biometric processing",),
        initial_results=(
            {
                "nodes": [node],
                "evidenceRefs": node.get("evidence_refs") or [],
            },
        ),
        graph_queries=(
            {
                "name": "biometric",
                "semanticTypes": list(semantic_types),
            },
        ),
        required_evidence=("biometric processing evidence",),
    )


def test_inferred_sensitive_taxonomy_does_not_make_rule_source_backed() -> None:
    node = {
        "node_id": "node:inferred",
        "node_type": "DATA_OBJECT",
        "label": "payload",
        "source": {"file_path": "src/identity.py"},
        "semantic_types": ["SENSITIVE.BIOMETRIC"],
        "origin": "DATA_LINEAGE",
        "resolution_state": "INFERRED",
        "support_refs": [],
        "evidence_refs": ["source-anchor:inferred"],
    }

    projected = material_planning_packet(_rule(), _packet(node))

    assert projected.initial_results[0]["rawHitCount"] == 1
    assert projected.initial_results[0]["materialHitCount"] == 0
    assert projected.initial_results[0]["nodes"] == []


def test_corroborated_sensitive_lineage_is_material() -> None:
    node = {
        "node_id": "node:corroborated",
        "node_type": "DATA_OBJECT",
        "label": "payload",
        "source": {"file_path": "src/identity.py"},
        "semantic_types": ["SENSITIVE.BIOMETRIC"],
        "origin": "DATA_LINEAGE",
        "resolution_state": "CORROBORATED",
        "support_refs": [],
        "evidence_refs": ["source-anchor:corroborated"],
    }

    projected = material_planning_packet(_rule(), _packet(node))

    assert projected.initial_results[0]["materialHitCount"] == 1
    assert projected.initial_results[0]["nodes"][0]["node_id"] == "node:corroborated"


def test_llm_semantic_node_requires_corroborated_support_refs() -> None:
    unsupported = {
        "node_id": "node:business-unsupported",
        "node_type": "BUSINESS_PROCESS",
        "label": "customer biometric identity verification",
        "source": None,
        "semantic_types": [],
        "origin": "LLM_SEMANTIC_ENRICHMENT",
        "resolution_state": "CORROBORATED",
        "support_refs": [],
        "evidence_refs": [],
    }
    supported = {
        **unsupported,
        "node_id": "node:business-supported",
        "support_refs": ["node:technical-support"],
    }
    rule = _rule(target_node_types=("BUSINESS_PROCESS",))

    weak = material_planning_packet(rule, _packet(unsupported, semantic_types=()))
    strong = material_planning_packet(rule, _packet(supported, semantic_types=()))

    assert weak.initial_results[0]["materialHitCount"] == 0
    assert strong.initial_results[0]["materialHitCount"] == 1
