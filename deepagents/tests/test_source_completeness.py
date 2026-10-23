"""Coverage integrity tests; scripted source facts are not independent semantic acceptance."""
from copy import deepcopy
from uuid import uuid4

import pytest

from rule_set_preparation.source_completeness import (
    source_material_input, quote_support, validate_catalog, coverage_result,
    source_spans, resolve_catalog, catalog_schema, resolve_coverage, reading_schema, source_role_input, classify_reading,
)
from rule_set_preparation.semantic_audit import (
    RELATION_CONTRACTS, audit_input, digest, completeness_input, catalog_current,
    receipt_passed,
)
from structural_semantic_fixture import StructuralFixtureAuditor
from test_semantic_auditor import example


def material():
    source, graph, unit = example()
    value = audit_input(source, graph, unit, 1)
    quote = source.nodes[unit]["content"]
    fact = {"id": "duty", "dependency": "NONE", "modality": "DUTY", "semanticAuthority": "LEGAL_NORMATIVE",
            "quote": quote, "meaning": "Retain the export log", "sourceSupport": quote_support(source.nodes[unit], quote)}
    catalog = {"sourceInputFingerprint": digest(source_material_input(value, RELATION_CONTRACTS)), "verifierOperationId": str(uuid4()), "facts": [fact], "noMaterialReason": None, "nonMaterialSpans": []}
    raw = {"facts": [{k: v for k, v in fact.items() if k not in {"modality", "semanticAuthority", "dependency"}}], "noMaterialReason": None, "nonMaterialSpans": []}
    catalog["initialReading"] = {**deepcopy(raw), "verifierOperationId": str(uuid4())}
    catalog["reviewedReading"] = {**deepcopy(raw), "verifierOperationId": str(uuid4())}
    catalog["dependencyAudit"] = None
    catalog["classification"] = {"inputFingerprint": digest(source_role_input(source_material_input(value, RELATION_CONTRACTS), raw)), "verifierOperationId": catalog["verifierOperationId"],
        "readings": [{"id": "duty", "addressee": "operator", "sourceRole": "LEGAL_NORMATIVE", "modalOperator": "DUTY", "operatorPolarity": "AFFIRMED", "dependency": "NONE"}]}
    return value, catalog, {"coverage": [{"representation": "ASSERTION", "sourceId": "duty", "claimIds": ["claim-one"], "relationIds": [], "finding": None}]}


def test_source_classification_separates_fallible_paraphrase_from_owned_source_evidence():
    value, catalog, _ = material()
    material_input = source_material_input(value, RELATION_CONTRACTS)
    fact = catalog["reviewedReading"]["facts"][0]
    fact["meaning"] = "A fallible paraphrase can retell conduct from a different source provision."
    question = source_role_input(material_input, catalog["reviewedReading"])
    row = question["propositions"][0]
    assert row == {"id": fact["id"], "proposedMeaning": fact["meaning"],
        "ownedEvidence": {"quote": fact["quote"], "sourceSupport": fact["sourceSupport"]}}
    assert question["source"] == material_input["source"]
    assert question["referenceSources"] == material_input["referenceSources"]
    assert not {"modality", "semanticAuthority", "dependency", "claims", "relations"} & row.keys()


def test_dependency_effect_audit_is_source_only_and_keeps_legal_preservation_binding_required():
    from rule_set_preparation.source_completeness import dependency_effect_input, validate_dependency_effects, effective_classification
    value, catalog, coverage = material()
    catalog["classification"]["readings"][0]["dependency"] = "PRESERVATION"
    material_input = source_material_input(value, RELATION_CONTRACTS)
    raw = {k: catalog["reviewedReading"][k] for k in ["facts", "noMaterialReason", "nonMaterialSpans"]}
    question = dependency_effect_input(material_input, raw, catalog["classification"])
    assert "sourceSpans" not in question
    assert "sourceSpans" not in source_role_input(material_input, raw)
    # Locator IDs are legitimate during discovery, never selectable proposition identities.
    with pytest.raises(ValueError, match="each supplied"):
        validate_dependency_effects(question, {"readings": [{"id": material_input["sourceSpans"][0]["id"], "effect": "OTHER", "effectStatement": "Wrong namespace"}]})
    changed = {**value, "claims": [], "relations": [], "contextClaims": []}
    assert dependency_effect_input(source_material_input(changed, RELATION_CONTRACTS), raw, catalog["classification"]) == question
    for effect, expected in [("ACTUAL_PERFORMANCE_NOT_ESTABLISHED", "SUPPORTED"), ("LEGAL_POSITION_CONTINUES", "WRONG_RELATION")]:
        audit = {"readings": [{"id": "duty", "effect": effect, "effectStatement": "Synthetic source effect, not legal evidence"}],
                 "inputFingerprint": digest(question), "verifierOperationId": str(uuid4())}
        validate_dependency_effects(question, audit)
        classified = classify_reading(raw, effective_classification(catalog["classification"], audit))
        candidate = {**catalog, **classified, "dependencyAudit": audit}
        assert catalog_current(value, candidate)
        assert coverage_result(completeness_input(value, candidate), coverage)["verdict"] == expected
        for defect in [None, {**audit, "inputFingerprint": "0" * 64}, {**audit, "readings": []}, {**audit, "readings": audit["readings"] * 2}]:
            assert not catalog_current(value, {**candidate, "dependencyAudit": defect})
    # The coarse proposal is retained and must never be silently changed by projection.
    assert catalog["classification"]["readings"][0]["modalOperator"] == "DUTY"


def test_native_catalog_audits_preservation_effect_once_before_candidate_comparison_and_caches_it():
    from rule_set_preparation.semantic_audit import SemanticAuditor
    from rule_set_preparation.source_completeness import EFFECT_TITLE, ROLE_TITLE, CATALOG_TITLE
    value, catalog, _ = material()
    raw = {k: catalog["reviewedReading"][k] for k in ["facts", "noMaterialReason", "nonMaterialSpans"]}
    class Probe(SemanticAuditor):
        calls = []
        def _invoke(self, question, prompt, schema, validator):
            self.calls.append(schema["title"])
            if schema["title"] == CATALOG_TITLE: answer = deepcopy(raw)
            elif schema["title"] == ROLE_TITLE:
                answer = {"readings": [{**catalog["classification"]["readings"][0], "dependency": "PRESERVATION"}]}
            else:
                assert schema["title"] == EFFECT_TITLE
                assert not {"claims", "relations", "expected"} & question.keys()
                answer = {"readings": [{"id": "duty", "effect": "ACTUAL_PERFORMANCE_NOT_ESTABLISHED", "effectStatement": "Synthetic compliance context"}]}
            validator(question, answer)
            return answer, str(uuid4())
    probe = Probe()
    receipt = probe.source_catalog(value)
    assert probe.calls == [CATALOG_TITLE, CATALOG_TITLE, ROLE_TITLE, EFFECT_TITLE]
    assert catalog_current(value, receipt) and receipt["facts"][0]["semanticAuthority"] == "CONTEXT"
    assert probe.source_catalog({**value, "claims": [], "relations": []}) == receipt
    assert len(probe.calls) == 4


def test_dependency_receipt_protocol_matches_api_and_rejects_missing_stale_or_foreign_effects():
    from rule_set_preparation.source_completeness import dependency_effect_input, effective_classification
    from semantic_fidelity_harness import bridge
    from corrected_semantic_fixture import corrected_graph
    _, source, graph, _, keys = corrected_graph()
    unit = keys["safeguards"]["sourceNodeIds"][0]
    value = audit_input(source, graph, unit, 1)
    _, catalog, _ = material()
    fact = catalog["facts"][0]
    fact.update(quote=source.nodes[unit]["content"], sourceSupport=quote_support(source.nodes[unit], source.nodes[unit]["content"]))
    raw = {"facts": [{k: v for k, v in fact.items() if k not in {"dependency", "modality", "semanticAuthority"}}], "noMaterialReason": None, "nonMaterialSpans": []}
    for key in ["initialReading", "reviewedReading"]:
        catalog[key].update(deepcopy(raw))
    material_input = source_material_input(value, RELATION_CONTRACTS)
    catalog["sourceInputFingerprint"] = digest(material_input)
    catalog["classification"]["inputFingerprint"] = digest(source_role_input(material_input, raw))
    catalog["classification"]["readings"][0]["dependency"] = "PRESERVATION"
    question = dependency_effect_input(material_input, raw, catalog["classification"])
    catalog["dependencyAudit"] = {"inputFingerprint": digest(question), "verifierOperationId": str(uuid4()),
        "readings": [{"id": "duty", "effect": "ACTUAL_PERFORMANCE_NOT_ESTABLISHED", "effectStatement": "Synthetic protocol fixture, not legal acceptance"}]}
    catalog.update(classify_reading(raw, effective_classification(catalog["classification"], catalog["dependencyAudit"])))
    assert catalog_current(value, catalog)
    assert bridge("CATALOG_CURRENT", source, graph, nodeId=unit, catalog=catalog)
    for mutate in ["missing", "stale", "foreign", "duplicate", "invalid_operation"]:
        changed = deepcopy(catalog)
        effect = changed["dependencyAudit"]
        if mutate == "missing": changed["dependencyAudit"] = None
        elif mutate == "stale": effect["inputFingerprint"] = "0" * 64
        elif mutate == "foreign": effect["readings"][0]["id"] = "foreign"
        elif mutate == "duplicate": effect["readings"] *= 2
        else: effect["verifierOperationId"] = "not-a-uuid"
        assert not catalog_current(value, changed)
        assert not bridge("CATALOG_CURRENT", source, graph, nodeId=unit, catalog=changed)


def test_inventory_input_is_independent_of_producer_assertions_and_edges():
    value, _, _ = material()
    expected = source_material_input(value, RELATION_CONTRACTS)
    value.update(claims=[], contextClaims=[], relations=[], inventoryRevision=999)
    assert source_material_input(value, RELATION_CONTRACTS) == expected


def test_coverage_preserves_the_independent_denied_operator_and_assessment_addressee():
    from rule_set_preparation.semantic_audit import verifier_payload
    value, catalog, _ = material()
    role = catalog["classification"]["readings"][0]
    role.update(sourceRole="ASSESSMENT_GUIDANCE", addressee="assessor", modalOperator="DUTY", operatorPolarity="DENIED")
    raw = {k: catalog["reviewedReading"][k] for k in ["facts", "noMaterialReason", "nonMaterialSpans"]}
    catalog.update(classify_reading(raw, catalog["classification"]))
    fact = verifier_payload(completeness_input(value, catalog))["sourceCatalog"]["facts"][0]
    assert fact["modality"] == "NON_OPERATIVE"
    assert fact["sourceClassification"] == {"sourceRole": "ASSESSMENT_GUIDANCE", "addressee": "assessor", "modalOperator": "DUTY", "operatorPolarity": "DENIED"}


def test_quote_provenance_keeps_original_whitespace_and_utf16_coordinates():
    unit = {"nodeId": "a" * 64, "content": "😀  Alpha\n\t beta."}
    span = quote_support(unit, "Alpha beta.")
    from rule_set_preparation.semantic_audit import utf16_slice, text_sha
    assert span["startOffset"] == 4
    assert utf16_slice(unit["content"], span["startOffset"], span["endOffset"]) == "Alpha\n\t beta."
    assert span["contentSha256"] == text_sha("Alpha\n\t beta.")
    with pytest.raises(ValueError, match="uniquely"):
        quote_support(unit, "alpha beta.")
    with pytest.raises(ValueError, match="uniquely"):
        quote_support({**unit, "content": "Alpha beta. Alpha beta."}, "Alpha beta.")


def test_runtime_span_selection_disambiguates_repeated_text_without_model_quotes():
    from rule_set_preparation.semantic_audit import verifier_response_schema, utf16_slice
    unit = {"nodeId": "a" * 64, "content": "😀  Same sentence.\n Same sentence.\nĐiều kiện khác。"}
    spans = source_spans(unit)
    assert len(spans) == 3
    assert len({s["id"] for s in spans}) == 3
    assert all(utf16_slice(unit["content"], s["sourceSupport"]["startOffset"], s["sourceSupport"]["endOffset"]) == s["quote"] for s in spans)
    fact = {"id": "f", "dependency": "NONE", "modality": "NON_OPERATIVE", "semanticAuthority": "CONTEXT",
            "startSpanId": spans[1]["id"], "endSpanId": spans[1]["id"], "meaning": "Location integrity test"}
    material = {"source": unit, "sourceSpans": spans}
    catalog = resolve_catalog(material, {"facts": [fact], "noMaterialReason": None, "nonMaterialSpans": [{"spanId": s["id"], "reason": "Explicit mechanical exclusion for this location test"} for s in [spans[0], spans[2]]]})
    validate_catalog(material, catalog)
    assert catalog["facts"][0]["sourceSupport"] == spans[1]["sourceSupport"]
    assert catalog["facts"][0]["quote"] == "Same sentence."
    props = verifier_response_schema(catalog_schema(["CONTEXT"], []))["properties"]["facts"]["items"]["properties"]
    assert not {"id", "quote", "sourceSupport"} & props.keys()
    for first, last in [("invented", spans[1]["id"]), (spans[2]["id"], spans[0]["id"])]:
        with pytest.raises(ValueError, match="span identities"):
            resolve_catalog(material, {"facts": [{**fact, "startSpanId": first, "endSpanId": last}], "noMaterialReason": None, "nonMaterialSpans": []})
    catalog["nonMaterialSpans"] = []
    with pytest.raises(ValueError, match="Every immutable source span"):
        validate_catalog(material, catalog)


def test_comparison_keeps_reference_evidence_but_only_offers_owned_coverage_ids():
    from rule_set_preparation.semantic_audit import verifier_payload, verifier_identities, replace_verifier_identities
    value, catalog, _ = material()
    value["relations"] = [{"relationId": "owned", "fromClaimId": "claim-one", "toClaimId": "neighbor", "kind": "CROSS_REFERENCE"},
                          {"relationId": "inbound", "fromClaimId": "neighbor", "toClaimId": "claim-one", "kind": "PRESERVES"}]
    value["contextClaims"] = [{**value["claims"][0], "claimId": "neighbor"}]
    complete = completeness_input(value, catalog)
    payload = verifier_payload(complete)
    assert [r["relationId"] for r in payload["semanticUnits"][0]["outgoingRelations"]] == ["owned"]
    assert "contextRelations" not in payload
    assert payload["referenceSources"] == complete["referenceSources"]
    assert payload["references"] == complete["references"]
    assert set(payload["sourceCatalog"]["facts"][0]) == {"id", "meaning", "modality", "semanticAuthority", "quote", "sourceSupport", "sourceClassification", "requiredRelationKinds"}
    assert payload["sourceCatalog"]["facts"][0]["sourceClassification"] == {"addressee": "operator", "sourceRole": "LEGAL_NORMATIVE", "modalOperator": "DUTY", "operatorPolarity": "AFFIRMED"}
    from rule_set_preparation.semantic_audit import verifier_response_schema
    source_schema = verifier_response_schema(reading_schema())["properties"]["facts"]["items"]["properties"]
    assert not {"dependency", "modality", "semanticAuthority", "kind", "relationKind"} & source_schema.keys()
    aliases = verifier_identities(complete)
    assert replace_verifier_identities(payload, aliases)["semanticUnits"][0]["unitId"] == aliases["claim-one"]


def test_unit_selection_resolves_real_bindings_and_rejects_missing_or_foreign_neighborhood():
    value, catalog, _ = material()
    target = deepcopy(value["claims"][0])
    target["claimId"] = "norm"
    value["contextClaims"] = [target]
    value["claims"][0].update(claimType="CONTEXT", operative=None)
    value["relations"] = [{"relationId": "preserve", "kind": "PRESERVES", "fromClaimId": "claim-one", "toClaimId": "norm"},
                          {"relationId": "reference", "kind": "CROSS_REFERENCE", "fromClaimId": "claim-one", "toClaimId": "norm"}]
    complete = completeness_input(value, catalog)
    wire = {"coverage": [{"sourceId": "duty", "unitIds": ["claim-one"], "finding": None}]}
    resolved = resolve_coverage(complete, wire)
    assert resolved["coverage"][0]["relationIds"] == ["preserve", "reference"]
    assert coverage_result(complete, resolved)["verdict"] == "SUPPORTED"
    catalog["facts"][0].update(dependency="PRESERVATION", modality="NON_OPERATIVE")
    assert coverage_result(complete, resolved)["verdict"] == "SUPPORTED"
    value["relations"][0]["kind"] = "QUALIFIES"
    assert coverage_result(completeness_input(value, catalog), resolved)["verdict"] == "WRONG_RELATION"
    with pytest.raises(ValueError, match="complete owned outgoing"):
        coverage_result(complete, {"coverage": [{**resolved["coverage"][0], "relationIds": []}]})
    for ids in [["norm"], ["invented"], ["claim-one", "claim-one"], ["@source", "claim-one"]]:
        with pytest.raises(ValueError):
            resolve_coverage(complete, {"coverage": [{"sourceId": "duty", "unitIds": ids, "finding": None}]})


def test_source_reading_is_reviewed_once_without_producer_and_both_results_survive_restore():
    from rule_set_preparation.semantic_audit import SemanticAuditor
    value, catalog, _ = material()
    initial = {k: catalog["initialReading"][k] for k in ["facts", "noMaterialReason", "nonMaterialSpans"]}
    final = deepcopy(initial)
    initial["facts"][0]["meaning"] = "Fallible initial paraphrase"

    class Reader(SemanticAuditor):
        def __init__(self):
            super().__init__()
            self.questions = []

        def _invoke(self, question, prompt, schema, validator):
            self.questions.append(deepcopy(question))
            assert not {"claims", "relations", "contextClaims"} & question.keys()
            if "propositions" in question:
                assert not {"modality", "semanticAuthority", "dependency"} & question["propositions"][0].keys()
                return {"readings": catalog["classification"]["readings"]}, str(uuid4())
            return deepcopy(final if "proposedReading" in question else initial), str(uuid4())

    reader = Reader()
    result = reader.source_catalog(value)
    assert len(reader.questions) == 3
    assert result["initialReading"]["facts"][0]["meaning"] == "Fallible initial paraphrase"
    assert result["facts"][0]["modality"] == "DUTY"
    assert result["initialReading"]["verifierOperationId"] != result["verifierOperationId"]
    assert reader.source_catalog(value) == result and len(reader.questions) == 3
    restored = Reader()
    restored.restore_receipt({"schemaRevision": value["schemaRevision"], "sourceCatalog": result})
    assert restored.source_catalog(value) == result and not restored.questions


def test_reference_binding_is_resolved_beside_both_comparison_and_relation_targets():
    from corrected_semantic_fixture import corrected_graph
    from rule_set_preparation.semantic_audit import verifier_payload, relation_input
    _, source, graph, _, _ = corrected_graph()
    count = 0
    for review in graph["sourceAccounting"]:
        value = audit_input(source, graph, review["sourceNodeId"], 1)
        projected = verifier_payload(completeness_input(value))
        edges = {r["relationId"]: r for u in projected["semanticUnits"] for r in u.get("outgoingRelations", [])}
        for relation in value["relations"]:
            if relation["fromClaimId"] not in {c["claimId"] for c in value["claims"]} or relation.get("referenceId") is None:
                continue
            reference = next(r for r in value["references"] if r["referenceId"] == relation["referenceId"])
            assert edges[relation["relationId"]]["sourceReference"] == reference
            question = relation_input(value, [relation])
            assert verifier_payload(question)["relations"][0]["sourceReference"] == reference
            broken = deepcopy(value)
            broken["references"] = []
            with pytest.raises(ValueError, match="absent from its bounded source context"):
                relation_input(broken, [relation])
            count += 1
    assert count > 0


def test_source_spans_and_reference_context_match_api_for_every_retained_unit():
    from corrected_semantic_fixture import corrected_graph
    from semantic_fidelity_harness import bridge
    _, source, graph, _, _ = corrected_graph()
    for row in graph["sourceAccounting"]:
        value = audit_input(source, graph, row["sourceNodeId"], 1)
        actual = bridge("AUDIT_INPUT", source, graph, nodeId=row["sourceNodeId"])
        assert actual["sourceMaterial"] == source_material_input(value, RELATION_CONTRACTS)
        assert actual["completeness"] == completeness_input(value)


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "kind", "quote", "source", "unaccounted", "exclusion"])
def test_stale_forged_or_inconsistent_catalog_cannot_pass(mutation):
    value, catalog, _ = material()
    assert catalog_current(value, catalog)
    if mutation == "missing": catalog.pop("facts")
    elif mutation == "duplicate": catalog["facts"].append(deepcopy(catalog["facts"][0]))
    elif mutation == "kind": catalog["facts"][0]["dependency"] = "INVALID"
    elif mutation == "quote": catalog["facts"][0]["sourceSupport"]["contentSha256"] = "0" * 64
    elif mutation == "source": value["sources"][0]["content"] += " Amended."
    elif mutation == "unaccounted":
        value["sources"][0]["content"] += " Material context."
        catalog["sourceInputFingerprint"] = digest(source_material_input(value, RELATION_CONTRACTS))
    else:
        catalog["nonMaterialSpans"] = [{"spanId": source_material_input(value, RELATION_CONTRACTS)["sourceSpans"][0]["id"], "reason": "Cannot exclude a fact-covered span"}]
    assert not catalog_current(value, catalog)


@pytest.mark.parametrize("claim_type", ["PERMISSION", "CONDITION", "CONTEXT"])
def test_separate_source_duty_cannot_be_accounted_for_by_permission_or_trigger(claim_type):
    value, catalog, result = material()
    value["claims"][0]["claimType"] = claim_type
    value["claims"][0]["operative"] = {"modality": claim_type} if claim_type == "PERMISSION" else None
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "MISSING_ASSERTION"


def test_missing_preservation_requires_real_owned_binding_not_qualifier_or_other_kind():
    value, catalog, _ = material()
    catalog["facts"][0].update(dependency="PRESERVATION", modality="NON_OPERATIVE")
    value["claims"][0]["semanticFrame"]["qualifier"] = "This does not remove or delay another duty."
    row = {"representation": "RELATION", "sourceId": "duty", "claimIds": ["claim-one"], "relationIds": [], "finding": None}
    assert coverage_result(completeness_input(value, catalog), {"coverage": [row]})["verdict"] == "WRONG_RELATION"
    edge = {"relationId": "preservation", "kind": "EXCEPTION_TO", "fromClaimId": "claim-one", "toClaimId": "other"}
    value["relations"] = [edge]
    row.update(claimIds=[], relationIds=[edge["relationId"]])
    assert coverage_result(completeness_input(value, catalog), {"coverage": [row]})["verdict"] == "WRONG_RELATION"
    for kind in ["PRESERVES", "EVIDENCE_SLICE_OF"]:
        edge["kind"] = kind
        assert coverage_result(completeness_input(value, catalog), {"coverage": [row]})["verdict"] == "SUPPORTED"
    edge["fromClaimId"] = "other"
    with pytest.raises(ValueError, match="owned"):
        coverage_result(completeness_input(value, catalog), {"coverage": [row]})


def test_definition_needs_its_own_supported_span_and_valid_combined_duties_can_share_claim():
    value, catalog, result = material()
    catalog["facts"].append({**catalog["facts"][0], "id": "second"})
    result["coverage"].append({**result["coverage"][0], "sourceId": "second"})
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "SUPPORTED"
    catalog["facts"][0]["semanticAuthority"] = "DEFINITION"
    result["coverage"][0]["representation"] = "DEFINITION_BINDING"
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "MISSING_ASSERTION"
    value["claims"][0]["semanticAuthority"] = "DEFINITION"
    value["claims"][0]["sourceSupport"][0].update(startOffset=100, endOffset=110)
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "MISSING_ASSERTION"


def test_coverage_cannot_omit_repeat_or_invent_fact_and_candidate_ids():
    value, catalog, result = material()
    for rows in [[], [result["coverage"][0]] * 2, [{**result["coverage"][0], "sourceId": "invented"}], [{**result["coverage"][0], "claimIds": ["unknown"]}]]:
        with pytest.raises(ValueError):
            coverage_result(completeness_input(value, catalog), {"coverage": rows})
    result["coverage"][0]["finding"] = "Claims are missing"
    with pytest.raises(ValueError, match="cannot also"):
        coverage_result(completeness_input(value, catalog), result)


def test_supporting_annotations_do_not_replace_required_proposition_or_edge():
    value, catalog, result = material()
    value["relations"] = [{"relationId": "edge", "kind": "PRESERVES", "fromClaimId": "claim-one", "toClaimId": "other"}]
    result["coverage"][0]["relationIds"] = ["edge"]
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "SUPPORTED"
    catalog["facts"][0].update(dependency="PRESERVATION", modality="NON_OPERATIVE")
    result["coverage"][0]["representation"] = "RELATION"
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "SUPPORTED"
    result["coverage"][0]["relationIds"] = []
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "WRONG_RELATION"
    catalog["facts"][0]["dependency"] = "SUBSTANTIVE_ADOPTION"
    result["coverage"][0]["relationIds"] = ["edge"]
    value["relations"][0]["kind"] = "DEFINED_BY"
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "WRONG_RELATION"


def test_declared_equivalent_representations_do_not_require_synonymous_graph_edges():
    value, catalog, result = material()
    fact = catalog["facts"][0]
    fact.update(dependency="EXPLANATION", modality="NON_OPERATIVE", semanticAuthority="CONTEXT")
    value["relations"] = [{"relationId": "slice", "kind": "EVIDENCE_SLICE_OF", "fromClaimId": "claim-one", "toClaimId": "norm"}]
    row = result["coverage"][0]
    row.update(representation="RELATION", claimIds=[], relationIds=["slice"])
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "SUPPORTED"
    fact.update(semanticAuthority="LEGAL_NORMATIVE", dependency="QUALIFICATION")
    row.update(representation="QUALIFIED_ASSERTION", claimIds=["claim-one"], relationIds=[])
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "SUPPORTED"
    row.update(representation="MISSING", claimIds=[], finding="No equivalent owned meaning remains")
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "WRONG_RELATION"


def test_declared_preserved_duty_can_use_its_binding_without_inventing_a_duplicate_duty():
    value, catalog, result = material()
    target = deepcopy(value["claims"][0])
    target["claimId"] = "norm"
    value["contextClaims"] = [target]
    value["claims"][0].update(claimType="CONTEXT", operative=None)
    value["relations"] = [{"relationId": "preservation", "kind": "PRESERVES", "fromClaimId": "claim-one", "toClaimId": "norm"}]
    row = result["coverage"][0]
    row.update(representation="RELATION", claimIds=[], relationIds=["preservation"])
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "SUPPORTED"
    row.update(representation="ASSERTION", claimIds=["claim-one"])
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "SUPPORTED"
    target.update(claimType="PERMISSION", operative={"modality": "PERMISSION"})
    assert coverage_result(completeness_input(value, catalog), result)["verdict"] == "MISSING_ASSERTION"


def test_canonical_heading_has_exact_selectable_span_without_body_or_punctuation_split():
    value, _, _ = material()
    unit = value["sources"][0]
    heading = "Article X. Retention 📁"
    body = "The operator must retain the export log."
    unit.update(label="X", title="Retention 📁", content=heading + "\n" + body)
    spans = source_spans(unit)
    assert [span["quote"] for span in spans] == [heading, body]
    assert spans[0]["sourceSupport"] == quote_support(unit, heading)
    assert spans[1]["sourceSupport"] == quote_support(unit, body)
    material_input = source_material_input(value, RELATION_CONTRACTS)
    reading = resolve_catalog(material_input, {"facts": [
        {"meaning": "Canonical title", "startSpanId": spans[0]["id"], "endSpanId": spans[0]["id"]},
        {"meaning": "The operator retains the log", "startSpanId": spans[1]["id"], "endSpanId": spans[1]["id"]}],
        "noMaterialReason": None, "nonMaterialSpans": []})
    validate_catalog(material_input, reading)
    assert reading["facts"][0]["quote"] == heading


def test_source_structure_accounts_only_for_canonical_heading_context_not_norms_or_body():
    value, catalog, result = material()
    unit = value["sources"][0]
    heading = "Article X. Retention"
    unit.update(label="X", title="Retention", content=heading + "\n" + unit["content"])
    fact = catalog["facts"][0]
    fact.update(modality="NON_OPERATIVE", semanticAuthority="CONTEXT", quote=heading, sourceSupport=quote_support(unit, heading))
    result["coverage"][0].update(representation="SOURCE_STRUCTURE", claimIds=[])
    complete = completeness_input(value, catalog)
    assert complete["sourceStructure"]["title"] == "Retention"
    from rule_set_preparation.semantic_audit import verifier_payload
    metadata = next(u for u in verifier_payload(complete)["semanticUnits"] if u["unitId"] == "@source")
    assert metadata["exactHeading"] == heading
    selected = resolve_coverage(complete, {"coverage": [{"sourceId": "duty", "unitIds": ["@source"], "finding": None}]})
    assert selected == result
    assert coverage_result(complete, result)["verdict"] == "SUPPORTED"
    fact["semanticAuthority"] = "LEGAL_NORMATIVE"
    assert coverage_result(complete, result)["verdict"] == "MISSING_ASSERTION"
    fact.update(semanticAuthority="CONTEXT", quote="The operator must retain the export log.", sourceSupport=quote_support(unit, "The operator must retain the export log."))
    assert coverage_result(complete, result)["verdict"] == "MISSING_ASSERTION"


def test_ast_numbering_is_structure_but_the_paragraph_body_and_decimal_are_not():
    from rule_set_preparation.source_completeness import source_structure
    value, catalog, result = material()
    unit = value["sources"][0]
    unit.update(label="2", title="", nodeType="PARAGRAPH", content="2. " + unit["content"])
    fact = catalog["facts"][0]
    fact.update(modality="NON_OPERATIVE", semanticAuthority="CONTEXT", quote="2.", sourceSupport=quote_support(unit, "2."))
    result["coverage"][0].update(representation="SOURCE_STRUCTURE", claimIds=[])
    complete = completeness_input(value, catalog)
    assert complete["sourceStructure"]["headingSupport"] == quote_support(unit, "2.")
    assert coverage_result(complete, result)["verdict"] == "SUPPORTED"
    fact["sourceSupport"] = quote_support(unit, "The operator must retain the export log.")
    assert coverage_result(complete, result)["verdict"] == "MISSING_ASSERTION"
    unit["content"] = "2.5 is a threshold, not the paragraph label."
    assert source_structure(unit)["headingSupport"] is None


@pytest.mark.parametrize("authority,dependency,required", [
    ("LEGAL_NORMATIVE", "PRESERVATION", ["EVIDENCE_SLICE_OF", "PRESERVES"]),
    ("LEGAL_NORMATIVE", "SUBSTANTIVE_ADOPTION", ["INCORPORATES"]),
    ("CONTEXT", "PRESERVATION", []),
    ("EVIDENCE_GUIDANCE", "EVIDENCE_LIMIT", []),
    ("EVIDENCE_GUIDANCE", "PRESERVATION", []),
])
def test_model_coverage_receives_the_same_binding_contract_that_the_runtime_enforces(authority, dependency, required):
    from rule_set_preparation.semantic_audit import verifier_payload
    value, catalog, result = material()
    catalog["facts"][0].update(semanticAuthority=authority, dependency=dependency, modality="NON_OPERATIVE")
    question = completeness_input(value, catalog)
    fact = verifier_payload(question)["sourceCatalog"]["facts"][0]
    assert fact["requiredRelationKinds"] == required
    result["coverage"][0]["representation"] = "SEMANTIC_UNIT"
    assert (coverage_result(question, result)["verdict"] == "SUPPORTED") == (not required)


def test_freeze_checks_catalog_and_coverage_even_with_structurally_supported_receipt():
    value, catalog, result = material()
    receipt = StructuralFixtureAuditor().audit(value)
    receipt["sourceCatalog"] = catalog
    receipt["completenessAudit"].update(inputFingerprint=digest(completeness_input(value, catalog)), **coverage_result(completeness_input(value, catalog), result))
    assert receipt_passed(value, receipt)
    receipt["completenessAudit"]["coverage"] = []
    assert not receipt_passed(value, receipt)
    receipt.pop("sourceCatalog")
    assert not receipt_passed(value, receipt)


def test_expanded_question_remains_bounded_before_provider_dispatch():
    from rule_set_preparation.semantic_audit import SemanticAuditor, completeness_schema, COVERAGE_PROMPT
    value, catalog, _ = material()
    value["claims"][0]["statement"] = "x" * 120001
    with pytest.raises(ValueError, match="Resolved semantic question exceeds"):
        SemanticAuditor()._invoke(completeness_input(value, catalog), COVERAGE_PROMPT, completeness_schema(), coverage_result)


def test_metadata_unit_must_be_supplied_by_canonical_heading_structure():
    from rule_set_preparation.semantic_audit import verifier_payload
    value, catalog, _ = material()
    complete = completeness_input(value, catalog)
    assert "@source" not in {u["unitId"] for u in verifier_payload(complete)["semanticUnits"]}
    with pytest.raises(ValueError, match="supplied owned semantic units"):
        resolve_coverage(complete, {"coverage": [{"sourceId": "duty", "unitIds": ["@source"], "finding": None}]})


def test_source_roles_keep_representation_guidance_distinct_from_real_duty_continuity():
    value, catalog, _ = material()
    reading = {k: catalog["reviewedReading"][k] for k in ["facts", "noMaterialReason", "nonMaterialSpans"]}
    rows = [{"id": "duty", "addressee": "combined assertion representation", "sourceRole": "REPRESENTATION_GUIDANCE", "modalOperator": "NON_OPERATIVE", "operatorPolarity": "AFFIRMED", "dependency": "PRESERVATION"}]
    assert classify_reading(reading, {"readings": rows})["facts"][0]["semanticAuthority"] == "CONTEXT"
    rows[0].update(addressee="operator's existing duty", sourceRole="LEGAL_NORMATIVE", dependency="PRESERVATION")
    result = classify_reading(reading, {"readings": rows})["facts"][0]
    assert (result["semanticAuthority"], result["dependency"]) == ("LEGAL_NORMATIVE", "PRESERVATION")
    for mutation in [{"sourceRole": "LEGAL_NORMATIVE", "modalOperator": "DUTY", "operatorPolarity": "AFFIRMED", "addressee": None}]:
        with pytest.raises(ValueError):
            classify_reading(reading, {"readings": [{**rows[0], **mutation}]})
    for ids in [[], rows * 2, [{**rows[0], "id": "unknown"}]]:
        with pytest.raises(ValueError, match="every discovered fact"):
            classify_reading(reading, {"readings": ids})
    catalog["classification"]["inputFingerprint"] = "0" * 64
    assert not catalog_current(value, catalog)


def test_expressed_force_does_not_promote_evidence_or_representation_to_law():
    value, catalog, coverage = material()
    reading = {k: catalog["reviewedReading"][k] for k in ["facts", "noMaterialReason", "nonMaterialSpans"]}
    role = {"id": "duty", "addressee": "repository assessment", "sourceRole": "EVIDENCE_GUIDANCE", "modalOperator": "PERMISSION", "operatorPolarity": "AFFIRMED", "dependency": "EVIDENCE_LIMIT"}
    fact = classify_reading(reading, {"readings": [role]})["facts"][0]
    assert (fact["semanticAuthority"], fact["modality"]) == ("EVIDENCE_GUIDANCE", "PERMISSION")
    role.update(sourceRole="REPRESENTATION_GUIDANCE", modalOperator="NON_OPERATIVE", dependency="PRESERVATION")
    catalog["facts"] = classify_reading(reading, {"readings": [role]})["facts"]
    assert coverage_result(completeness_input(value, catalog), coverage)["verdict"] == "SUPPORTED"
    role["sourceRole"] = "LEGAL_NORMATIVE"
    catalog["facts"] = classify_reading(reading, {"readings": [role]})["facts"]
    assert coverage_result(completeness_input(value, catalog), coverage)["verdict"] == "WRONG_RELATION"


@pytest.mark.parametrize("operator", ["DUTY", "PROHIBITION", "PERMISSION"])
def test_denied_modal_operator_never_creates_its_opposite(operator):
    value, catalog, coverage = material()
    reading = {k: catalog["reviewedReading"][k] for k in ["facts", "noMaterialReason", "nonMaterialSpans"]}
    role = {"id": "duty", "addressee": "actor", "sourceRole": "LEGAL_NORMATIVE",
            "modalOperator": operator, "operatorPolarity": "DENIED", "dependency": "NONE"}
    catalog["facts"] = classify_reading(reading, {"readings": [role]})["facts"]
    assert catalog["facts"][0]["modality"] == "NON_OPERATIVE"
    value["claims"][0].update(claimType="CONTEXT", operative=None, semanticAuthority="CONTEXT")
    assert coverage_result(completeness_input(value, catalog), coverage)["verdict"] == "SUPPORTED"
    role["operatorPolarity"] = "AFFIRMED"
    catalog["facts"] = classify_reading(reading, {"readings": [role]})["facts"]
    assert catalog["facts"][0]["modality"] == operator
    assert coverage_result(completeness_input(value, catalog), coverage)["verdict"] == "MISSING_ASSERTION"
    catalog["classification"]["readings"] = [role]
    catalog["facts"][0]["modality"] = "NON_OPERATIVE"
    assert not catalog_current(value, catalog)
    role.update(modalOperator="NON_OPERATIVE", operatorPolarity="DENIED")
    with pytest.raises(ValueError, match="no modal operator"):
        classify_reading(reading, {"readings": [role]})


@pytest.mark.parametrize("source_role,polarity", [
    ("EVIDENCE_GUIDANCE", "AFFIRMED"), ("ASSESSMENT_GUIDANCE", "AFFIRMED"),
    ("REPRESENTATION_GUIDANCE", "AFFIRMED"), ("LEGAL_NORMATIVE", "DENIED"),
])
def test_impersonal_standards_and_excluded_duties_do_not_invent_a_legal_actor(source_role, polarity):
    _, catalog, _ = material()
    reading = {k: catalog["reviewedReading"][k] for k in ["facts", "noMaterialReason", "nonMaterialSpans"]}
    role = {"id": "duty", "addressee": None, "sourceRole": source_role,
            "modalOperator": "DUTY", "operatorPolarity": polarity, "dependency": "NONE"}
    fact = classify_reading(reading, {"readings": [role]})["facts"][0]
    assert fact["modality"] == ("DUTY" if polarity == "AFFIRMED" else "NON_OPERATIVE")
    role.update(sourceRole="LEGAL_NORMATIVE", operatorPolarity="AFFIRMED")
    with pytest.raises(ValueError, match="requires its addressee"):
        classify_reading(reading, {"readings": [role]})


@pytest.mark.parametrize("kind", ["CONDITION_OF", "QUALIFIES", "EXCEPTION_TO", "TEMPORALLY_APPLIES_TO"])
def test_normative_source_fact_can_qualify_its_actual_norm_through_an_owned_binding(kind):
    value, catalog, coverage = material()
    target = deepcopy(value["claims"][0])
    target["claimId"] = "norm"
    value["contextClaims"] = [target]
    value["claims"][0].update(claimType="CONDITION", operative=None)
    value["relations"] = [{"relationId": "binding", "kind": kind, "fromClaimId": "claim-one", "toClaimId": "norm"}]
    coverage["coverage"][0].update(representation="SEMANTIC_UNIT", relationIds=["binding"])
    assert coverage_result(completeness_input(value, catalog), coverage)["verdict"] == "SUPPORTED"
    value["relations"][0]["kind"] = "CROSS_REFERENCE"
    assert coverage_result(completeness_input(value, catalog), coverage)["verdict"] == "MISSING_ASSERTION"
    value["relations"][0]["kind"] = kind
    target.update(claimType="PERMISSION", operative={**target["operative"], "modality": "PERMISSION"})
    assert coverage_result(completeness_input(value, catalog), coverage)["verdict"] == "MISSING_ASSERTION"
    value["relations"][0]["fromClaimId"] = "norm"
    with pytest.raises(ValueError, match="owned outgoing"):
        coverage_result(completeness_input(value, catalog), coverage)


@pytest.mark.parametrize("dependency", ["CONDITION", "QUALIFICATION", "TEMPORAL_APPLICATION"])
def test_missing_duty_is_not_reclassified_as_a_missing_modifier_edge(dependency):
    value, catalog, coverage = material()
    fact = catalog["facts"][0]
    fact["dependency"] = dependency
    coverage["coverage"][0].update(representation="MISSING", claimIds=[], finding="The operative duty is absent")
    result = coverage_result(completeness_input(value, catalog), coverage)
    assert result["verdict"] == "MISSING_ASSERTION"
    fact.update(modality="NON_OPERATIVE", dependency="PRESERVATION")
    result = coverage_result(completeness_input(value, catalog), coverage)
    assert result["verdict"] == "WRONG_RELATION"


def test_fact_identity_is_runtime_owned_stable_under_reordering_and_changes_with_provenance():
    from jsonschema import Draft7Validator, ValidationError
    from rule_set_preparation.semantic_audit import verifier_response_schema, verifier_identities, replace_verifier_identities, restore_verifier_identities
    unit = {"nodeId": "a" * 64, "content": "Same passage. Same passage."}
    spans = source_spans(unit)
    material = {"source": unit, "sourceSpans": spans}
    facts = [{"meaning": "A source proposition", "startSpanId": s["id"], "endSpanId": s["id"]} for s in spans]
    response = {"facts": facts, "nonMaterialSpans": [], "noMaterialReason": None}
    wire = Draft7Validator(verifier_response_schema(reading_schema()))
    # The wire has no null alternative (INV-S2): "none" is the empty string, projected to null canonically.
    wire.validate({**response, "noMaterialReason": ""})
    with pytest.raises(ValidationError):
        wire.validate(response)
    forged = deepcopy({**response, "noMaterialReason": ""})
    forged["facts"][0]["id"] = "model_invented_identity"
    with pytest.raises(ValidationError):
        wire.validate(forged)
    reading = resolve_catalog(material, response)
    validate_catalog(material, reading)
    ids = [f["id"] for f in reading["facts"]]
    assert len(set(ids)) == 2 and all(len(i) == 32 for i in ids)
    reversed_reading = resolve_catalog(material, {**response, "facts": list(reversed(facts))})
    assert [f["id"] for f in reversed_reading["facts"]] == list(reversed(ids))
    changed = resolve_catalog(material, {**response, "facts": [{**facts[0], "meaning": "A changed proposition"}, facts[1]]})
    assert changed["facts"][0]["id"] != ids[0]
    aliases = verifier_identities({"propositions": reading["facts"]})
    payload = replace_verifier_identities({"propositions": reading["facts"]}, aliases)
    assert {f["id"] for f in payload["propositions"]} == {"@fact[1]", "@fact[2]"}
    selected = {"coverage": [{"sourceId": aliases[ids[0]], "unitIds": [], "finding": "Missing meaning"}]}
    assert restore_verifier_identities(selected, aliases)["coverage"][0]["sourceId"] == ids[0]
    duplicate = resolve_catalog(material, {**response, "facts": [facts[0], facts[0], facts[1]]})
    with pytest.raises(ValueError, match="identities must be unique"):
        validate_catalog(material, duplicate)
