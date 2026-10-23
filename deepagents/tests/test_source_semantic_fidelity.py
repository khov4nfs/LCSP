"""Exact historical rejection and cross-runtime provenance/receipt/closure conformance."""
from copy import deepcopy

import pytest
from rule_set_preparation.semantic_audit import audit_input, audit_identity, canonical_support, FRAME_FIELDS, completeness_input, relation_batches, relation_input
from semantic_fidelity_harness import retained, bridge


def test_exact_historical_six_of_nineteen_artifact_cannot_reach_freeze():
    fixture, source, _ = retained()
    graph = fixture["frozenInventory"]["graph"]
    failures = bridge("GATE", source, graph)
    bad_id = next(c["claimId"] for c in graph["claims"] if c["claimId"].startswith("923f9380"))
    assert any(f["ref"] == "claim:" + bad_id and f["code"] == "SOURCE_SUPPORT_INVALID" for f in failures)
    assert any(f["code"] == "SEMANTIC_AUDIT_REQUIRED" for f in failures)
    assert any("FREE_FLOATING_MODIFIER" in f["detail"] for f in failures)


def test_python_and_api_build_identical_bounded_neighborhoods_and_audit_fingerprints():
    fixture, source, _ = retained()
    graph = fixture["frozenInventory"]["graph"]
    for review in graph["sourceAccounting"]:
        node_id = review["sourceNodeId"]
        value = audit_input(source, graph, node_id, 1)
        api = bridge("AUDIT_INPUT", source, graph, nodeId=node_id)
        assert api["input"] == value
        assert api["identity"] == audit_identity(value)
        assert api["completeness"] == completeness_input(value)
        assert api["relationInputs"] == [relation_input(value, batch) for batch in relation_batches(value)]
        assert len(value["sources"]) <= len(source.nodes)


def test_python_api_bind_identical_independent_source_readings_and_reject_stale_relation_receipts():
    from corrected_semantic_fixture import corrected_graph
    from structural_semantic_fixture import StructuralFixtureAuditor
    _, source, graph, _, _ = corrected_graph()
    unit = graph["sourceAccounting"][0]["sourceNodeId"]
    value = audit_input(source, graph, unit, 1)
    receipt = StructuralFixtureAuditor().audit(value)
    graph["semanticAudits"] = [receipt]
    api = bridge("AUDIT_INPUT", source, graph, nodeId=unit, relatedSourceCatalogs=receipt["relatedSourceCatalogs"])
    assert api["relationInputs"] == [relation_input(value, batch, receipt["relatedSourceCatalogs"]) for batch in relation_batches(value)]
