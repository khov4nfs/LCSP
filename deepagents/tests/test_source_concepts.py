"""Source graph joins and provenance tests; fake readings are not model acceptance."""
from copy import deepcopy
from uuid import uuid4

import pytest
from rule_set_preparation.source_concepts import concept_input, concept_schema, validate_concepts, definition_target
from rule_set_preparation.semantic_audit import audit_input, digest, receipt_passed, definition_projection
from structural_semantic_fixture import StructuralFixtureAuditor
from corrected_semantic_fixture import corrected_graph
from semantic_fidelity_harness import bridge


def material():
    _, source, graph, _, keys = corrected_graph()
    row = next(r for r in graph["relations"] if r["kind"] == "DEFINED_BY" and r["fromClaimId"] == keys["safeguards"]["claimId"] and r["toClaimId"] == keys["def.operator"]["claimId"])
    unit = keys["safeguards"]["sourceNodeIds"][0]
    value = audit_input(source, graph, unit, 1)
    ids = [keys[n]["claimId"] for n in ["safeguards", "def.operator", "def.copy"]]
    claims = {c["claimId"]: c for c in graph["claims"]}
    facts = [{"id": cid, "quote": claims[cid]["statement"], "sourceSupport": claims[cid]["sourceSupport"][0]} for cid in ids]
    question = {"facts": facts, "definitionFactIds": ids[1:]}
    concepts = {"definitions": [{"factId": ids[1], "definedConcepts": ["operator"]}, {"factId": ids[2], "definedConcepts": ["portable copy"]}],
        "factUses": [{"factId": cid, "uses": [{"definitionFactId": ids[1], "mode": "DEFINED_MEANING", "sourceExpression": "operator"}] if cid == ids[0] else []} for cid in ids]}
    relation = {**row, "fromAssertion": claims[ids[0]], "toAssertion": claims[ids[1]]}
    return source, graph, value, question, concepts, relation, claims[ids[2]]


def test_exact_source_binding_and_wrong_target_match_api_with_ambiguous_alignments_left_to_model():
    from jsonschema import Draft7Validator
    source, graph, value, question, concepts, relation, wrong = material()
    Draft7Validator(concept_schema()).validate(concepts)
    validate_concepts(question, concepts)
    for changed, expected in [(relation, True), ({**relation, "toAssertion": wrong}, False),
        ({**relation, "fromAssertion": {**relation["fromAssertion"], "statement": "A paraphrased proposition"}}, None)]:
        assert definition_target(changed, question, concepts) is expected
        assert bridge("CONCEPT_TARGET", source, graph, relation=changed, conceptSource=question, concepts=concepts) is expected
        fixed = definition_projection({"relationEvidence": [changed], "conceptSource": question, "sourceConceptAudit": concepts})
        assert (fixed is None) == (expected is None)
        if fixed is not None: assert (fixed["relations"][0]["checks"]["target"] == "SUPPORTED") == expected
    broad = deepcopy(question)
    broad["facts"].append({**broad["facts"][0], "id": "overlapping-other-meaning"})
    assert definition_target(relation, broad, concepts) is None
    compound = deepcopy(concepts)
    compound["definitions"][0]["definedConcepts"].append("other concept")
    assert definition_target(relation, question, compound) is None
    unrelated = deepcopy(concepts)
    unrelated["factUses"][0]["uses"][0]["mode"] = "CONTEXTUAL_ASSOCIATION"
    assert definition_target(relation, question, unrelated) is False


def test_anaphoric_cross_sentence_definition_preservation_and_negative_controls():
    _, source, graph, _, keys = corrected_graph()
    # Positive control: Article 8 cessation obligation inherits actor "operator" from preceding sentence
    row = next(r for r in graph["relations"] if r["kind"] == "DEFINED_BY" and r["fromClaimId"] == keys["access.end"]["claimId"] and r["toClaimId"] == keys["def.operator"]["claimId"])
    claims = {c["claimId"]: c for c in graph["claims"]}
    unit = keys["access.end"]["sourceNodeIds"][0]
    value = audit_input(source, graph, unit, 1)

    # Siblings in Article 8: permission sentence has "operator", cessation sentence has "The restriction must end..."
    perm_id = next(c["claimId"] for c in graph["claims"] if c["sourceNodeIds"] == [unit] and "operator may restrict" in c["statement"])
    cess_id = keys["access.end"]["claimId"]
    def_id = keys["def.operator"]["claimId"]
    def_copy_id = keys["def.copy"]["claimId"]

    facts = [
        {"id": unit + ":" + perm_id, "quote": claims[perm_id]["statement"], "sourceSupport": claims[perm_id]["sourceSupport"][0]},
        {"id": unit + ":" + cess_id, "quote": claims[cess_id]["statement"], "sourceSupport": claims[cess_id]["sourceSupport"][0]},
        {"id": "def-node:" + def_id, "quote": claims[def_id]["statement"], "sourceSupport": claims[def_id]["sourceSupport"][0]},
        {"id": "def-node:" + def_copy_id, "quote": claims[def_copy_id]["statement"], "sourceSupport": claims[def_copy_id]["sourceSupport"][0]},
    ]
    question = {"facts": facts, "definitionFactIds": ["def-node:" + def_id, "def-node:" + def_copy_id]}

    # Concept reading where sibling has DEFINED_MEANING for operator, but cessation sentence has empty uses (anaphora)
    anaphora_concepts = {
        "definitions": [
            {"factId": "def-node:" + def_id, "definedConcepts": ["operator"]},
            {"factId": "def-node:" + def_copy_id, "definedConcepts": ["portable copy"]},
        ],
        "factUses": [
            {"factId": unit + ":" + perm_id, "uses": [{"definitionFactId": "def-node:" + def_id, "mode": "DEFINED_MEANING", "sourceExpression": "operator"}]},
            {"factId": unit + ":" + cess_id, "uses": []},
            {"factId": "def-node:" + def_id, "uses": []},
            {"factId": "def-node:" + def_copy_id, "uses": []},
        ],
    }
    relation = {**row, "fromAssertion": claims[cess_id], "toAssertion": claims[def_id]}

    # Positive control: anaphora preserves actor definition usage
    assert definition_target(relation, question, anaphora_concepts) is True
    assert bridge("CONCEPT_TARGET", source, graph, relation=relation, conceptSource=question, concepts=anaphora_concepts) is True

    # Negative control 1: wrong target definition (portable copy instead of operator)
    wrong_target_rel = {**relation, "toAssertion": claims[def_copy_id]}
    assert definition_target(wrong_target_rel, question, anaphora_concepts) is False
    assert bridge("CONCEPT_TARGET", source, graph, relation=wrong_target_rel, conceptSource=question, concepts=anaphora_concepts) is False

    # Negative control 2: sibling does not use definition
    no_sibling_concepts = deepcopy(anaphora_concepts)
    no_sibling_concepts["factUses"][0]["uses"] = []
    assert definition_target(relation, question, no_sibling_concepts) is False
    assert bridge("CONCEPT_TARGET", source, graph, relation=relation, conceptSource=question, concepts=no_sibling_concepts) is False

    # Negative control 3: explicit CONTEXTUAL_ASSOCIATION on cessation proposition
    assoc_concepts = deepcopy(anaphora_concepts)
    assoc_concepts["factUses"][1]["uses"] = [{"definitionFactId": "def-node:" + def_id, "mode": "CONTEXTUAL_ASSOCIATION", "sourceExpression": "incident"}]
    assert definition_target(relation, question, assoc_concepts) is False
    assert bridge("CONCEPT_TARGET", source, graph, relation=relation, conceptSource=question, concepts=assoc_concepts) is False


@pytest.mark.parametrize("mutation", ["missing", "foreign", "duplicate", "stale", "source_change"])
def test_source_concept_receipt_is_bound_to_source_and_catalogs_in_both_runtimes(mutation):
    source, graph, value, _, _, _, _ = material()
    receipt = StructuralFixtureAuditor().audit(value)
    graph["semanticAudits"] = [receipt]
    assert receipt_passed(value, receipt)
    assert bridge("RECEIPT_GATE", source, graph, nodeId=value["sourceNodeId"]) == []
    concepts = receipt["sourceConceptAudit"]
    if mutation == "missing": receipt["sourceConceptAudit"] = None
    elif mutation == "foreign": concepts["factUses"] = [{"factId": "foreign", "uses": []}]
    elif mutation == "duplicate": concepts["definitions"] = [{"factId": "foreign", "definedConcepts": []}] * 2
    elif mutation == "stale": concepts["inputFingerprint"] = "0" * 64
    else: concepts["inputFingerprint"] = digest({**concept_input(value, receipt["relatedSourceCatalogs"]), "sourceRevision": "changed"})
    assert not receipt_passed(value, receipt)
    assert bridge("RECEIPT_GATE", source, graph, nodeId=value["sourceNodeId"]) == ["RELATION_AUDIT_REQUIRED"]


def test_concept_input_is_candidate_independent_and_identical_across_runtimes():
    source, graph, value, _, _, _, _ = material()
    receipt = StructuralFixtureAuditor().audit(value)
    catalogs = receipt["relatedSourceCatalogs"]
    expected = concept_input(value, catalogs)
    changed = deepcopy(value)
    changed["claims"] = []; changed["relations"] = []; changed["contextClaims"] = []
    assert concept_input(changed, catalogs) == expected
    actual = bridge("AUDIT_INPUT", source, graph, nodeId=value["sourceNodeId"], relatedSourceCatalogs=catalogs, sourceConceptAudit=receipt["sourceConceptAudit"])
    assert actual["conceptSource"] == expected
    from rule_set_preparation.semantic_audit import relation_input, relation_batches
    assert actual["relationInputs"] == [relation_input(value, batch, catalogs, receipt["sourceConceptAudit"]) for batch in relation_batches(value)]
