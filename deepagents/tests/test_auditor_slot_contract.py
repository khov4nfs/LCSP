"""INV-S1/INV-S2 wire contract: one-row-per-item auditor answers are runtime-keyed slots, never model-echoed identities.

Scripted answers test the runtime wire adapter and its fail-closed policy, not legal entailment quality. Canonical
schemas, receipts, fingerprints and validators are unchanged, so every positive control here compares the slot answer's
canonical projection with what the previous row-array answer produced.
"""
import json
import re
from copy import deepcopy
from pathlib import Path

import pytest
from jsonschema import Draft7Validator
from jsonschema.exceptions import ValidationError
from langchain_core.messages import AIMessage

from middleware import usage_metering
from middleware.failure_policy import StructuredOutputRejected
from rule_set_preparation import semantic_audit as sa
from rule_set_preparation import source_completeness as sc
from rule_set_preparation.semantic_audit import (
    ASSERTION_CHECKS, RELATION_CONTRACTS, SLOT_KEY_PATTERN, SemanticAuditor, _InvocationReceipt, audit_input, completeness_input, completeness_schema,
    coverage_result, digest, relation_input, relation_schema, restore_verifier_identities, validate_verdict, verdict_schema,
    verifier_response_schema, wire_instruction,
)
from rule_set_preparation.source_completeness import (
    catalog_schema, classify_reading, dependency_effect_input, dependency_effect_schema, reading_schema, resolve_catalog, role_schema, source_material_input,
    source_role_input, validate_catalog, validate_dependency_effects,
)
from semantic_verifier_fixture import model_response
from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
from test_semantic_auditor import example
from test_source_completeness import material

RETAINED = Path(__file__).resolve().parents[2] / "reports/lcsp360-semantic-convergence/local-runtime-20261020-mirai-01/MIRAI_COMPLETENESS52.json"
HEX = lambda seed: (seed * 64)[:64]


def unit_value(text, references=(), extra_sources=()):
    unit = {"nodeId": HEX("a"), "parentNodeId": None, "structuralPath": "/document/unit", "nodeType": "ARTICLE", "content": text,
            "legalEffectStatus": "EFFECTIVE", "label": None, "title": None}
    return {"schemaRevision": sa.SCHEMA_REVISION, "sourceRevision": HEX("b"), "sourceNodeId": unit["nodeId"], "sources": [unit, *extra_sources], "references": list(references)}


def facts_reading(count):
    """A source reading with `count` distinct propositions, one per sentence span."""
    value = unit_value(" ".join(f"Sentence {i} states one distinct proposition." for i in range(count)))
    source = source_material_input(value, RELATION_CONTRACTS)
    facts = [{"meaning": f"Proposition {i}", "startSpanId": span["id"], "endSpanId": span["id"]} for i, span in enumerate(source["sourceSpans"])]
    reading = resolve_catalog(source, {"facts": facts, "noMaterialReason": None, "nonMaterialSpans": []})
    validate_catalog(source, reading)
    return source, reading


def role_row(**fields):
    return {"addressee": "operator", "sourceRole": "LEGAL_NORMATIVE", "modalOperator": "DUTY", "operatorPolarity": "AFFIRMED", "dependency": "NONE", **fields}


def effect_question():
    """One preservation fact beside two resolved references, as in the retained candidate-52 failure."""
    targets = [{"nodeId": HEX("c"), "parentNodeId": None, "structuralPath": "/document/target-one", "nodeType": "ARTICLE", "content": "Target one text.", "legalEffectStatus": "EFFECTIVE", "label": None, "title": None},
               {"nodeId": HEX("d"), "parentNodeId": None, "structuralPath": "/document/target-two", "nodeType": "ARTICLE", "content": "Target two text.", "legalEffectStatus": "EFFECTIVE", "label": None, "title": None}]
    references = [{"referenceId": HEX(seed), "fromNodeId": HEX("a"), "toNodeId": target["nodeId"], "text": "reference " + seed, "charStart": 0, "charEnd": 3,
                   "resolutionState": "RESOLVED", "candidateNodeIds": [target["nodeId"]]} for seed, target in zip("12", targets)]
    value = unit_value("Delegation does not remove the operator's own duty.", references, targets)
    source = source_material_input(value, RELATION_CONTRACTS)
    span = source["sourceSpans"][-1]
    reading = resolve_catalog(source, {"facts": [{"meaning": "Delegation does not remove the operator's own duty", "startSpanId": span["id"], "endSpanId": span["id"]}], "noMaterialReason": None, "nonMaterialSpans": []})
    roles = {"readings": [role_row(dependency="PRESERVATION", id=reading["facts"][0]["id"])]}
    return dependency_effect_input(source, reading, roles), source, reading


def assertion_case():
    source, graph, unit = example()
    value = audit_input(source, graph, unit, 1)
    return value, verdict_schema(value), validate_verdict


def relation_case():
    source, graph, unit = example()
    graph["relations"] = [{"relationId": "edge-one", "fromClaimId": "claim-one", "toClaimId": "claim-one", "kind": "QUALIFIES", "referenceId": None}]
    value = audit_input(source, graph, unit, 1)
    batch = sa.relation_batches(value)[0]
    question = relation_input(value, batch)
    return question, relation_schema(batch), lambda v, r: validate_verdict({"claims": [], "relations": batch}, {**r, "assertions": []})


def coverage_case():
    value, catalog, _ = material()
    question = completeness_input(value, catalog)
    return question, completeness_schema(), coverage_result


def roles_case(count=3):
    source, reading = facts_reading(count)
    return source_role_input(source, reading), role_schema(), (lambda v, r: classify_reading(reading, r)), reading


def effects_case():
    question, _, _ = effect_question()
    return question, dependency_effect_schema(), validate_dependency_effects


def capture_for(case):
    question, canonical, validator = case[:3]
    return _InvocationReceipt(question, validator, canonical)


def all_cases():
    return {"roles": roles_case(), "effects": effects_case(), "coverage": coverage_case(), "assertions": assertion_case(), "relations": relation_case()}


def valid_answer(name, capture):
    """A schema-valid slot answer for every supplied item (content is irrelevant to the wire tests)."""
    def keyed(section):
        return {key: None for key, _, _ in capture.slots[section]}
    if name == "roles":
        return {"readings": {key: {k: v for k, v in role_row().items()} for key in keyed("readings")}}
    if name == "effects":
        return {"readings": {key: {"effect": "LEGAL_POSITION_CONTINUES", "effectStatement": "The legal position continues"} for key in keyed("readings")}}
    if name == "coverage":
        return {"coverage": {key: {"unitIds": ["@claim[1]"], "finding": ""} for key in keyed("coverage")}}
    if name == "assertions":
        return {"assertions": {key: model_response({"assertions": [{"id": "x", "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}}]})["assertions"]["claim_1"] for key in keyed("assertions")}, "relations": []}
    return {"relations": {key: {"targetScopeReading": "EXACT_SOURCE_TARGET", "checks": {"kind": "SUPPORTED", "direction": "SUPPORTED"}} for key in keyed("relations")}}


def section_of(name):
    return {"roles": "readings", "effects": "readings", "coverage": "coverage", "assertions": "assertions", "relations": "relations"}[name]


def walk(schema):
    """Every sub-schema, depth first."""
    if isinstance(schema, dict):
        yield schema
        for value in schema.values():
            yield from walk(value)
    elif isinstance(schema, list):
        for value in schema:
            yield from walk(value)


# ---------------------------------------------------------------------------------------------------------------------
# S1 positive controls
# ---------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["roles", "effects", "coverage", "assertions", "relations"])
def test_native_schema_enumerates_exactly_the_supplied_items_as_closed_pattern_safe_slots(name):
    case = all_cases()[name]
    capture = capture_for(case)
    section = capture.model_schema["properties"][section_of(name)]
    slots = capture.slots[section_of(name)]
    assert slots, "the control must supply at least one item"
    assert section["type"] == "object" and section["additionalProperties"] is False
    assert list(section["properties"]) == section["required"] == [key for key, _, _ in slots]
    assert all(re.fullmatch(SLOT_KEY_PATTERN, key) for key in section["properties"])
    for key, alias, _ in slots:
        assert key == alias.removeprefix("@").replace("[", "_").removesuffix("]")
        body = section["properties"][key]
        assert body["type"] == "object" and body["additionalProperties"] is False and body["required"] == list(body["properties"])
        # Identity is runtime-owned: the row body carries neither the item's id nor any other identity field.
        assert not {"id", "sourceId", "claimId", "relationId", "factId", "referenceId", "nodeId"} & body["properties"].keys()
    # No provider-hostile constructs on identities: no enum/minItems/maxItems on the slot object, and no null alternative on the wire.
    assert not {"enum", "minItems", "maxItems"} & section.keys()
    assert not any(node.get("type") == "null" for node in walk(capture.model_schema))
    Draft7Validator.check_schema(capture.model_schema)


def test_slot_keys_never_collide_in_text_and_follow_alias_order_beyond_nine_items():
    source, reading = facts_reading(12)
    question = source_role_input(source, reading)
    capture = _InvocationReceipt(question, lambda v, r: classify_reading(reading, r), role_schema())
    keys = [key for key, _, _ in capture.slots["readings"]]
    assert keys == [f"fact_{i}" for i in range(1, 13)] and len(set(keys)) == 12
    # The payload keeps the bracketed aliases, which cannot prefix one another (@fact[1] is not inside @fact[10]).
    aliases = [alias for _, alias, _ in capture.slots["readings"]]
    assert not any(a != b and a in b for a in aliases for b in aliases)
    answer = {"readings": {key: role_row(addressee=f"addressee for {key}") for key in keys}}
    canonical = capture.canonical(answer)
    by_alias = {cid: alias for cid, alias in capture.identities.items()}
    assert [row["id"] for row in canonical["readings"]] == [cid for _, _, cid in capture.slots["readings"]]
    for row in canonical["readings"]:
        assert row["addressee"] == "addressee for fact_" + by_alias[row["id"]].removeprefix("@fact[").removesuffix("]")


@pytest.mark.parametrize("name", ["roles", "effects", "coverage", "assertions", "relations"])
def test_valid_slot_answer_canonicalizes_through_the_unchanged_canonical_schema_and_validator(name):
    case = all_cases()[name]
    capture = capture_for(case)
    answer = valid_answer(name, capture)
    Draft7Validator(capture.model_schema).validate(answer)
    canonical = capture.canonical(answer)
    Draft7Validator(case[1]).validate(canonical)
    section = section_of(name)
    ids = [cid for _, _, cid in capture.slots[section]]
    if name == "coverage":
        assert [row["sourceId"] for row in canonical["coverage"]] == ids
    else:
        assert [row["id"] for row in canonical[section]] == ids
    # Receipts never contain a slot key or alias: identity is restored to the canonical value.
    text = json.dumps(canonical)
    assert not any(alias in text for alias in capture.identities.values())


def test_slot_answer_projection_equals_the_previous_row_answer_for_the_same_reading():
    question, source, reading = effect_question()
    capture = _InvocationReceipt(question, validate_dependency_effects, dependency_effect_schema())
    row = {"effect": "LEGAL_POSITION_CONTINUES", "effectStatement": "Delegation does not remove the operator's own duty."}
    old = restore_verifier_identities({"readings": [{"id": "@fact[1]", **row}]}, capture.identities)
    assert capture.canonical({"readings": {"fact_1": row}}) == old
    assert old["readings"][0]["id"] == question["facts"][0]["id"]


@pytest.mark.skipif(not RETAINED.exists(), reason="retained candidate-52 evidence is not present in this checkout")
def test_retained_candidate52_failure_cannot_be_expressed_and_its_correct_reading_canonicalizes_exactly():
    """Replays the retained SourceDependencyEffects question (0 model calls): raw[10..13] echoed reference IDs, truncated them and invented names."""
    retained = json.loads(RETAINED.read_text())
    value, raw = retained["cases"][0]["auditInput"], retained["rawNativeStructuredResponses"]
    source = source_material_input(value, RELATION_CONTRACTS)
    reading = resolve_catalog(source, restore_verifier_identities(raw[8]["answer"], _InvocationReceipt(source, validate_catalog, reading_schema()).identities))
    roles_question = source_role_input(source, reading)
    assert digest(roles_question) == raw[9]["inputFingerprint"]
    roles = restore_verifier_identities(raw[9]["answer"], _InvocationReceipt(roles_question, None, role_schema()).identities)
    question = dependency_effect_input(source, reading, roles)
    assert digest(question) == raw[10]["inputFingerprint"] and len(question["facts"]) == 1
    assert {r["referenceId"] for r in question["references"]}, "the retained payload carries raw reference identities"
    capture = _InvocationReceipt(question, validate_dependency_effects, dependency_effect_schema())
    assert capture.model_schema["properties"]["readings"]["required"] == ["fact_1"]
    for index in range(10, 14):
        with pytest.raises(ValidationError):
            capture.canonical(raw[index]["answer"])
    correct = next(r for r in raw[13]["answer"]["readings"] if r["id"] == "@fact[1]")
    previous = restore_verifier_identities({"readings": [correct]}, capture.identities)
    assert capture.canonical({"readings": {"fact_1": {"effect": correct["effect"], "effectStatement": correct["effectStatement"]}}}) == previous
    # The echoed reference identities the model actually chose are not representable as slots either.
    echoed = {"readings": {r["referenceId"]: {"effect": "OTHER", "effectStatement": "echoed"} for r in question["references"]}}
    with pytest.raises(ValidationError):
        capture.canonical(echoed)


# ---------------------------------------------------------------------------------------------------------------------
# S1 negative controls
# ---------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["roles", "effects", "coverage", "assertions", "relations"])
def test_missing_extra_or_identity_keyed_slots_are_native_rejections_and_never_coerced(name):
    case = all_cases()[name]
    capture = capture_for(case)
    section, valid = section_of(name), valid_answer(name, capture)
    first_key = capture.slots[section][0][0]
    body = valid[section][first_key]

    missing = deepcopy(valid)
    del missing[section][first_key]
    extra_reference = deepcopy(valid)
    extra_reference[section][HEX("1")] = body                                  # a raw referenceId / nodeId-shaped key
    extra_key = deepcopy(valid)
    extra_key[section][first_key.replace("_1", "_99")] = body                  # a slot the runtime never offered
    renamed = deepcopy(valid)
    renamed[section] = {capture.slots[section][0][2] if i == 0 else key: row for i, (key, row) in enumerate(valid[section].items())}   # canonical id instead of slot
    embedded = deepcopy(valid)
    embedded[section][first_key] = {"id": "@fact[1]" if name != "assertions" else "@claim[1]", **body}   # identity inside the row body
    array_rows = deepcopy(valid)
    array_rows[section] = [{**row, "id": key} for key, row in valid[section].items()]   # the previous row-array form
    for invalid in [missing, extra_reference, extra_key, renamed, embedded, array_rows]:
        with pytest.raises(ValidationError):
            capture.canonical(invalid)
    assert capture.canonical(valid)


def test_second_native_fault_fails_closed_after_exactly_one_managed_correction(monkeypatch):
    """Existing OneNativeSchemaRepair policy: invalid slots get one metered correction, never a silent repair or a PASS."""
    question, canonical, validator = effects_case()
    invalid = {"readings": {HEX("1"): {"effect": "OTHER", "effectStatement": "echoed reference"}}}
    valid = {"readings": {"fact_1": {"effect": "LEGAL_POSITION_CONTINUES", "effectStatement": "The legal position continues"}}}
    for script, outcome in [([invalid, valid], "corrected"), ([invalid, invalid, valid], "failed-closed")]:
        model = RuleSetPreparationScriptedModel(responses=[AIMessage(content="", tool_calls=[{"name": "SourceDependencyEffects", "args": answer, "id": f"effects-{i}"}]) for i, answer in enumerate(script)])
        original = usage_metering.assert_model_identity
        monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None, _model=model: None if m is _model else original(m, response))
        metered = []
        record = usage_metering.UsageMeteringMiddleware._record
        monkeypatch.setattr(usage_metering.UsageMeteringMiddleware, "_record", lambda self, response, current_model, invocation_id, _record=record: (metered.append(invocation_id), _record(self, response, current_model, invocation_id))[1])
        auditor = SemanticAuditor(model)
        if outcome == "corrected":
            result, operation = auditor._invoke(question, sc.EFFECT_PROMPT, canonical, validator)
            assert result == {"readings": [{"id": question["facts"][0]["id"], **valid["readings"]["fact_1"]}]}
            assert len(metered) == len(model.prompts) == 2
            assert auditor.rejected_verdicts[0]["verdict"] == invalid and auditor.rejected_verdicts[0]["resolvedByOperationId"] == operation
            assert any("fact_1" in str(m.content) and "required" in str(m.content) for m in model.prompts[1])
            assert HEX("1") not in " ".join(str(m.content) for m in model.prompts[1] if getattr(m, "type", "") == "tool"), "the correction never echoes the model's own identity"
        else:
            with pytest.raises(StructuredOutputRejected):
                auditor._invoke(question, "", canonical, validator)
            assert len(metered) == len(model.prompts) == 2 and len(auditor.rejected_verdicts) == 2
            assert all("resolvedByOperationId" not in r for r in auditor.rejected_verdicts)
        monkeypatch.undo()


def test_valid_semantic_negative_verdict_stays_negative_through_the_slot_adapter():
    value, canonical, validator = assertion_case()
    capture = _InvocationReceipt(value, validator, canonical)
    rejected = model_response({"verdict": "WRONG_ACTOR", "gaps": [], "assertions": [{"id": "claim-one", "verdict": "WRONG_ACTOR", "gapCodes": ["WRONG_ACTOR"],
                               "checks": {**{k: "SUPPORTED" for k in ASSERTION_CHECKS}, "actor": "WRONG_ACTOR"}}], "relations": []})
    assert rejected["assertions"]["claim_1"]["checks"]["actor"] == {"code": "WRONG_ACTOR", "finding": "Scripted factual repair target"}
    result = capture.canonical(rejected)
    assert result["verdict"] == "WRONG_ACTOR" and result["assertions"][0]["id"] == "claim-one" and result["assertions"][0]["gapCodes"] == ["WRONG_ACTOR"]
    assert result["gaps"] and all(g["code"] == "WRONG_ACTOR" for g in result["gaps"])


def test_zero_item_sections_keep_the_empty_array_that_every_provider_accepts():
    value, canonical, validator = assertion_case()
    capture = _InvocationReceipt(value, validator, canonical)
    relations = capture.model_schema["properties"]["relations"]
    assert relations["type"] == "array" and relations["maxItems"] == 0
    answer = valid_answer("assertions", capture)
    answer["relations"] = [{"targetScopeReading": "EXACT_SOURCE_TARGET", "checks": {"kind": "SUPPORTED", "direction": "SUPPORTED"}}]
    with pytest.raises(ValidationError):
        capture.canonical(answer)
    source, reading = facts_reading(1)
    empty_roles = _InvocationReceipt({**source_role_input(source, reading), "propositions": []}, lambda v, r: None, role_schema())
    assert empty_roles.model_schema["properties"]["readings"] == {"type": "array", "maxItems": 0, "items": empty_roles.model_schema["properties"]["readings"]["items"]}
    assert empty_roles.canonical({"readings": []}) == {"readings": []}


def test_value_independent_contract_description_is_deterministic_and_describes_the_slot_wire():
    for canonical in [role_schema(), dependency_effect_schema(), completeness_schema(), verdict_schema(), relation_schema([])]:
        template = verifier_response_schema(canonical)
        assert template == verifier_response_schema(deepcopy(canonical))
        sections = [s for s in template["properties"].values() if s.get("type") == "object"]
        assert sections and all(s["patternProperties"].keys() == {SLOT_KEY_PATTERN} and s["additionalProperties"] is False for s in sections)
        Draft7Validator.check_schema(template)
    assert digest(verifier_response_schema(role_schema())) != digest(role_schema())


@pytest.mark.parametrize("name", ["roles", "effects", "coverage", "assertions", "relations"])
def test_slot_schema_survives_the_gemini_provider_relaxation_without_losing_closure_of_required_keys(name):
    from middleware.provider_schema import gemini_null_types, relax_array_upper_bounds
    capture = capture_for(all_cases()[name])
    relaxed = relax_array_upper_bounds(capture.model_schema)
    # Gemini cannot take additionalProperties, but required slot membership and property names survive intact.
    section = relaxed["properties"][section_of(name)]
    assert section["required"] == [key for key, _, _ in capture.slots[section_of(name)]] and set(section["properties"]) == set(section["required"])
    assert gemini_null_types(relaxed) == relaxed, "no null union is left on the wire (INV-S2)"
    answer = valid_answer(name, capture)
    Draft7Validator(relaxed).validate(answer)
    # The runtime still closes the object canonically even when the provider copy cannot.
    answer[section_of(name)][HEX("1")] = next(iter(answer[section_of(name)].values()))
    Draft7Validator(relaxed).validate(answer)
    with pytest.raises(ValidationError):
        capture.canonical(answer)


# ---------------------------------------------------------------------------------------------------------------------
# S2: unambiguous wire encoding. "None" is the empty string on the wire and null canonically; nothing else is coerced.
# ---------------------------------------------------------------------------------------------------------------------

def test_catalog_no_material_reason_has_no_null_alternative_and_empty_string_projects_to_null():
    source, reading = facts_reading(2)
    capture = _InvocationReceipt(source, validate_catalog, reading_schema())
    wire = Draft7Validator(capture.model_schema)
    spans = source["sourceSpans"]
    facts = [{"meaning": "A proposition", "startSpanId": s["id"], "endSpanId": s["id"]} for s in spans]
    listed = {"facts": facts, "nonMaterialSpans": [], "noMaterialReason": ""}
    wire.validate(listed)
    with pytest.raises(ValidationError):
        wire.validate({**listed, "noMaterialReason": None})
    canonical = capture.canonical(listed)
    assert canonical["noMaterialReason"] is None and len(canonical["facts"]) == len(facts)
    # Facts and a literal non-empty reason together remain rejected: the string "null" is a reason, never coerced into none.
    for literal in ["null", "None", " ", "no material"]:
        with pytest.raises(ValueError, match="facts or a source-grounded no-material reason"):
            capture.canonical({**listed, "noMaterialReason": literal})
    # No facts and an empty reason remains rejected too (absent extraction is never inferred as "no material").
    with pytest.raises(ValueError, match="facts or a source-grounded no-material reason"):
        capture.canonical({"facts": [], "nonMaterialSpans": [{"spanId": s["id"], "reason": "Not a proposition"} for s in spans], "noMaterialReason": ""})
    explained = capture.canonical({"facts": [], "nonMaterialSpans": [{"spanId": s["id"], "reason": "Not a proposition"} for s in spans], "noMaterialReason": "Numbering only"})
    assert explained["noMaterialReason"] == "Numbering only"


def test_coverage_finding_empty_string_means_none_and_never_hides_a_missing_mapping():
    question, canonical, validator = coverage_case()
    capture = _InvocationReceipt(question, validator, canonical)
    wire = Draft7Validator(capture.model_schema)
    supported = {"coverage": {"fact_1": {"unitIds": ["@claim[1]"], "finding": ""}}}
    wire.validate(supported)
    with pytest.raises(ValidationError):
        wire.validate({"coverage": {"fact_1": {"unitIds": ["@claim[1]"], "finding": None}}})
    result = capture.canonical(supported)
    assert result["verdict"] == "SUPPORTED" and result["coverage"][0]["finding"] is None
    missing = capture.canonical({"coverage": {"fact_1": {"unitIds": [], "finding": "The separate source duty is absent"}}})
    assert missing["verdict"] != "SUPPORTED" and missing["coverage"][0]["finding"] == "The separate source duty is absent"
    for both_empty in [{"unitIds": [], "finding": ""}, {"unitIds": ["@claim[1]"], "finding": "Contradictory finding"}]:
        with pytest.raises(ValueError, match="selected units or an explicit missing-meaning finding"):
            capture.canonical({"coverage": {"fact_1": both_empty}})


def test_role_addressee_empty_string_means_none_and_an_operative_fact_still_requires_its_addressee():
    source, reading = facts_reading(1)
    question = source_role_input(source, reading)
    capture = _InvocationReceipt(question, lambda v, r: classify_reading(reading, r), role_schema())
    wire = Draft7Validator(capture.model_schema)
    context = role_row(addressee="", sourceRole="CONTEXT", modalOperator="NON_OPERATIVE")
    wire.validate({"readings": {"fact_1": context}})
    with pytest.raises(ValidationError):
        wire.validate({"readings": {"fact_1": {**context, "addressee": None}}})
    assert capture.canonical({"readings": {"fact_1": context}})["readings"][0]["addressee"] is None
    with pytest.raises(ValueError, match="requires its addressee"):
        capture.canonical({"readings": {"fact_1": role_row(addressee="")}})
    assert capture.canonical({"readings": {"fact_1": role_row(addressee="operator")}})["readings"][0]["addressee"] == "operator"


@pytest.mark.parametrize("name", ["roles", "effects", "coverage", "assertions", "relations"])
def test_wire_instruction_states_the_slot_and_empty_string_encodings(name):
    text = wire_instruction(all_cases()[name][1])
    assert "slot" in text and "identities are runtime-owned" in text
    if name in {"roles", "coverage"}:
        assert "empty" in text
    assert wire_instruction(reading_schema()).endswith("an empty string when facts are listed.")
    assert not re.search(r"\bnull\b", text), "no instruction asks the model for a JSON null"


def test_prompts_no_longer_ask_the_model_to_echo_identities_or_emit_null():
    for prompt in [sa.PROMPT, sa.RELATION_PROMPT, sc.ROLE_PROMPT, sc.EFFECT_PROMPT, sc.COVERAGE_PROMPT]:
        assert not re.search(r"(Return|return)[^.]*\b(row id|claimId|relationId|sourceId|fact id|every id)\b", prompt)
    assert "finding=null" not in sc.COVERAGE_PROMPT and "(null if none)" not in sc.ROLE_PROMPT and "otherwise it is null" not in sc.CATALOG_PROMPT


def test_canonical_identity_fields_remain_exactly_the_previous_contract():
    """Parity by construction: nothing the TypeScript runtime validates changed shape."""
    assert role_schema()["properties"]["readings"]["items"]["properties"]["addressee"]["anyOf"][0] == {"type": "null"}
    assert dependency_effect_schema()["properties"]["readings"]["type"] == "array"
    assert sc.coverage_selection_schema()["properties"]["coverage"]["items"]["properties"]["finding"]["anyOf"][0] == {"type": "null"}
    assert catalog_schema([], [])["properties"]["noMaterialReason"]["anyOf"][0] == {"type": "null"}
    assert completeness_schema()["properties"]["coverage"]["type"] == "array"
    assert verdict_schema()["properties"]["assertions"]["type"] == "array"
