"""Verifier contract/governance tests. Scripted verdicts test the runtime, not model entailment quality."""
from copy import deepcopy
from types import SimpleNamespace
from uuid import UUID

import pytest
from langchain_core.messages import AIMessage
from middleware import usage_metering
from rule_set_preparation.semantic_audit import (
    SemanticAuditor, audit_input, audit_identity, canonical_support, receipt_current,
    receipt_passed, utf16_slice, digest, FRAME_FIELDS, ASSERTION_CHECKS,
)
from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
from semantic_verifier_fixture import model_response
from rule_set_preparation.source_completeness import source_spans


def example():
    node = {"nodeId": "a" * 64, "parentNodeId": None, "structuralPath": "/document/unit", "nodeType": "ARTICLE", "content": "The operator must retain the export log.", "legalEffectStatus": "EFFECTIVE"}
    source = SimpleNamespace(nodes={node["nodeId"]: node}, graph={"materializationId": "b" * 64, "references": []})
    claim = {"claimId": "claim-one", "sourceNodeIds": [node["nodeId"]], "claimType": "DUTY", "statement": node["content"], "operative": {"actor": "operator", "modality": "DUTY", "action": "retain the export log"}, "sourceSupport": canonical_support(source, [node["nodeId"]], [{"nodeId": node["nodeId"], "startOffset": 0, "endOffset": len(node["content"])}]), "semanticAuthority": "LEGAL_NORMATIVE", "assessability": "REPOSITORY_VERIFIABLE", "semanticFrame": {k: None for k in FRAME_FIELDS}, "state": "RELEVANT"}
    graph = {"claims": [claim], "relations": [], "sourceAccounting": [{"sourceNodeId": node["nodeId"], "claimIds": [claim["claimId"]]}]}
    return source, graph, node["nodeId"]


def relation_question(edge):
    """Minimal relation question: the relation row carries its resolved endpoints like model_evidence output."""
    row = {**edge, "fromAssertion": {"claimId": "origin"}, "toAssertion": {"claimId": "target"}}
    return {"claims": [], "relations": [edge], "relationEvidence": [row]}


def native_rows(value, canonical, validator, answer):
    """Validate a native keyed-slot answer against its wire schema and project it to restored canonical rows."""
    from jsonschema import Draft7Validator
    from rule_set_preparation.semantic_audit import _InvocationReceipt, restore_verifier_identities
    capture = _InvocationReceipt(value, validator, canonical)
    Draft7Validator(capture.model_schema).validate(answer)
    return restore_verifier_identities(capture.project_wire(answer), capture.identities), capture



@pytest.mark.parametrize("verdict", ["SUPPORTED", "CONTRADICTED", "INSUFFICIENT_SUPPORT", "WRONG_ACTOR", "WRONG_MODALITY", "WRONG_ACTION", "WRONG_SCOPE", "WRONG_SEMANTIC_AUTHORITY"])
def test_independent_verdict_runs_through_governed_agent_stack(monkeypatch, verdict):
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)
    checks = {k: "SUPPORTED" for k in ASSERTION_CHECKS}
    dimension = {"CONTRADICTED": "sourceSupport", "INSUFFICIENT_SUPPORT": "sourceSupport", "WRONG_ACTOR": "actor", "WRONG_MODALITY": "modality", "WRONG_ACTION": "action", "WRONG_SCOPE": "scope", "WRONG_SEMANTIC_AUTHORITY": "semanticAuthority"}.get(verdict)
    if dimension: checks[dimension] = verdict
    result = {"verdict": verdict, "gaps": [] if verdict == "SUPPORTED" else [{"code": verdict, "detail": "Bounded factual repair target"}], "assertions": [{"id": "claim-one", "checks": checks, "verdict": verdict, "gapCodes": [] if verdict == "SUPPORTED" else [verdict]}], "relations": []}
    assertion_messages = [AIMessage(content="", tool_calls=[{"name": "SourceSemanticAuditVerdict", "args": model_response(result), "id": f"audit-verdict-{i}"}]) for i in range(1 if verdict == "SUPPORTED" else 2)]
    model = RuleSetPreparationScriptedModel(responses=[*assertion_messages, AIMessage(content="", tool_calls=[{"name": "SourceMaterialCatalog", "args": {"facts": [{"id": "duty", "dependency": "NONE", "modality": "DUTY", "semanticAuthority": "LEGAL_NORMATIVE", "startSpanId": source_spans(source.nodes[node_id])[0]["id"], "endSpanId": source_spans(source.nodes[node_id])[-1]["id"], "meaning": "Retain the export log"}], "noMaterialReason": "", "nonMaterialSpans": []}, "id": "catalog"}]), AIMessage(content="", tool_calls=[{"name": "SourceCompletenessVerdict", "args": {"coverage": {"fact_1": {"unitIds": ["@claim[1]"], "finding": ""}}}, "id": "completeness"}])])
    model.responses.insert(len(assertion_messages) + 1, deepcopy(model.responses[len(assertion_messages)]))
    for message in model.responses:
        for call in message.tool_calls:
            if call["name"] == "SourceMaterialCatalog":
                for fact in call["args"]["facts"]:
                    for key in ["id", "dependency", "modality", "semanticAuthority"]: fact.pop(key)
    model.responses.insert(len(assertion_messages) + 2, AIMessage(content="", tool_calls=[{"name": "SourceSemanticRoles", "args": {"readings": {"fact_1": {"addressee": "operator", "sourceRole": "LEGAL_NORMATIVE", "modalOperator": "DUTY", "operatorPolarity": "AFFIRMED", "dependency": "NONE"}}}, "id": "source-roles"}]))
    count = len(assertion_messages)
    model.responses = model.responses[count:count + 3] + model.responses[:count] + model.responses[count + 3:]
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if m is model else original(m, response))
    receipt = SemanticAuditor(model).audit(value)
    UUID(receipt["verifierOperationId"])
    assert receipt["verifierRole"] == "legal-semantic-auditor"
    assert receipt["assertions"][0]["fingerprint"] == digest(graph["claims"][0])
    assert receipt_passed(value, receipt) == (verdict == "SUPPORTED")
    assert receipt_current(value, receipt)
    assert len(model.prompts) == (5 if verdict == "SUPPORTED" else 6)
    assert len(model.prompts[0]) == 2  # dedicated system context + bounded evidence, no Producer transcript
    assert "before any candidate claims" in model.prompts[0][0].content
    assert "claim-one" not in model.prompts[0][1].content
    assert model.bound_tool_names[:3] == [["SourceMaterialCatalog"], ["SourceMaterialCatalog"], ["SourceSemanticRoles"]]
    assert model.bound_tool_names[3] == ["SourceSemanticAuditVerdict"]
    assert model.bound_tool_names[-1] == ["SourceCompletenessVerdict"]
    assert receipt["completenessAudit"]["verifierOperationId"] != receipt["verifierOperationId"]


@pytest.mark.parametrize("start,end", [(-1, 1), (0, 0), (0, 9), (1, 2), (2, 3), (True, 2)])
def test_source_support_rejects_invalid_or_half_surrogate_offsets(start, end):
    with pytest.raises((ValueError, UnicodeError)):
        utf16_slice("a😀b", start, end)


def test_worker_attestation_rejects_forgery_wrong_run_and_stale_checkpoint(monkeypatch):
    from rule_set_preparation.semantic_audit import attest_receipt, verify_attestation
    from structural_semantic_fixture import StructuralFixtureAuditor
    source, graph, node_id = example()
    receipt = StructuralFixtureAuditor().audit(audit_input(source, graph, node_id, 1))
    run_id = "00000000-0000-4000-8000-000000000099"
    signed = attest_receipt(receipt, run_id)
    assert verify_attestation(signed, run_id)
    assert not verify_attestation(receipt, run_id)
    assert not verify_attestation(signed, "00000000-0000-4000-8000-000000000098")
    assert not verify_attestation({**signed, "verifierOperationId": "00000000-0000-4000-8000-000000000001"}, run_id)
    assert not verify_attestation({**signed, "sourceRevision": "0" * 64}, run_id)
    assert not verify_attestation({**signed, "inventoryRevision": 2}, run_id)
    assert not verify_attestation({**signed, "attestation": "hmac-sha256:" + "0" * 64}, run_id)
    monkeypatch.delenv("LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="key missing or invalid"):
        verify_attestation(signed, run_id)


def test_support_resolves_utf16_and_pins_hash_without_duplicating_text():
    source, _, node_id = example()
    source.nodes[node_id]["content"] = "a😀b"
    support = canonical_support(source, [node_id], [{"nodeId": node_id, "startOffset": 1, "endOffset": 3}])
    assert set(support[0]) == {"nodeId", "startOffset", "endOffset", "contentSha256"}
    assert utf16_slice(source.nodes[node_id]["content"], 1, 3) == "😀"
    with pytest.raises(ValueError, match="mismatch"):
        canonical_support(source, [node_id], [{**support[0], "contentSha256": "0" * 64}])


def test_audit_identity_is_local_and_any_assertion_or_context_mutation_invalidates_it():
    source, graph, node_id = example()
    original = audit_identity(audit_input(source, graph, node_id, 1))
    unrelated = deepcopy(source.nodes[node_id]); unrelated.update(nodeId="c" * 64, structuralPath="/unrelated", content="Unrelated material")
    source.nodes[unrelated["nodeId"]] = unrelated
    assert audit_identity(audit_input(source, graph, node_id, 1)) == original
    graph["claims"][0]["operative"]["modality"] = "PERMISSION"
    assert audit_identity(audit_input(source, graph, node_id, 1))["assertionFingerprint"] != original["assertionFingerprint"]


def test_large_rejected_receipt_survives_real_stream_sanitization_and_missing_fragments_fail_closed():
    from orchestration.agent_stream import AgentStreamSession, activate_agent_stream
    from structural_semantic_fixture import StructuralFixtureAuditor
    from rule_set_preparation.semantic_audit import publish_audit_receipt, reconstruct_audit_receipts
    source, graph, node_id = example()
    receipt = StructuralFixtureAuditor().audit(audit_input(source, graph, node_id, 1))
    # Transport regression: exercise the receipt schema's bounded large array without a large model invocation.
    receipt["assertions"] = [{**deepcopy(receipt["assertions"][0]), "id": f"{i:064x}"} for i in range(200)]
    receipt.update(verdict="MISSING_ASSERTION", gaps=[{"code": "MISSING_ASSERTION", "detail": "One independently identified assertion is absent"}])
    events, sequence = [], [0]
    def stamp():
        sequence[0] += 1
        return {"event_sequence": sequence[0]}
    session = AgentStreamSession(assessment_id=None, run_id="offline", correlation_id="offline", boundary_name="semantic-receipt", emit_payload=events.append)
    with activate_agent_stream(session):
        publish_audit_receipt(receipt, "CLAIM_DISCOVERY", stamp)
    assert len(events) > 2 and reconstruct_audit_receipts(events) == [receipt]
    assert len(reconstruct_audit_receipts(events)[0]["assertions"]) == 200
    with pytest.raises(ValueError, match="Incomplete"):
        reconstruct_audit_receipts(events[1:])


def test_restored_relation_receipt_reuses_only_unchanged_bounded_evidence():
    from uuid import uuid4
    from rule_set_preparation.semantic_audit import RELATION_CHECKS
    source, graph, node_id = example()
    other = {**source.nodes[node_id], "nodeId": "c" * 64, "structuralPath": "/definition", "content": "Export log means the record of an export."}
    source.nodes[other["nodeId"]] = other
    definition = {**deepcopy(graph["claims"][0]), "claimId": "definition", "sourceNodeIds": [other["nodeId"]], "claimType": "DEFINITION", "operative": None, "semanticAuthority": "DEFINITION", "statement": other["content"], "assessability": "NON_ASSESSABLE"}
    definition["sourceSupport"] = canonical_support(source, definition["sourceNodeIds"], [{"nodeId": other["nodeId"], "startOffset": 0, "endOffset": len(other["content"])}])
    graph["claims"].append(definition)
    graph["relations"] = [{"relationId": "relation-one", "fromClaimId": "claim-one", "toClaimId": "definition", "kind": "DEFINED_BY", "referenceId": None}]

    class ScriptedParts(SemanticAuditor):
        def __init__(self):
            super().__init__()
            self.operations = []

        def _invoke(self, value, prompt, schema, validator):
            self.operations.append(schema["title"])
            result = {"verdict": "SUPPORTED", "gaps": [], "coverage": []}
            if schema["title"] == "IndependentSourceConcepts":
                return {"definitions": [], "factUses": []}, str(uuid4())
            if schema["title"] == "SourceSemanticRoles":
                return {"readings": []}, str(uuid4())
            if schema["title"] == "SourceMaterialCatalog":
                return {"facts": [], "noMaterialReason": "Scripted mechanical test only", "nonMaterialSpans": [{"spanId": s["id"], "reason": "Mechanical fixture only"} for s in value["sourceSpans"]]}, str(uuid4())
            if schema["title"] == "SourceSemanticAuditVerdict":
                result.update(assertions=[{"id": c["claimId"], "verdict": "SUPPORTED", "gapCodes": [], "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}} for c in value["claims"]], relations=[])
            elif schema["title"] == "SemanticRelationVerdict":
                result["relations"] = [{"id": r["relationId"], "targetScopeReading": "EXACT_SOURCE_TARGET", "verdict": "SUPPORTED", "gapCodes": [], "checks": {k: "SUPPORTED" for k in RELATION_CHECKS}} for r in value["relationEvidence"]]
            return result, str(uuid4())

    original = ScriptedParts().audit(audit_input(source, graph, node_id, 1))
    obsolete = {**deepcopy(original), "schemaRevision": "SOURCE_SEMANTIC_AUDIT_V6"}
    old_runtime = ScriptedParts()
    old_runtime.restore_receipt(obsolete)
    assert not old_runtime.relation_cache
    assert not receipt_current(audit_input(source, graph, node_id, 1), obsolete)
    restarted = ScriptedParts()
    restarted.restore_receipt(original)
    replay = restarted.audit(audit_input(source, graph, node_id, 1))
    assert receipt_passed(audit_input(source, graph, node_id, 1), replay)
    assert restarted.operations == ["SourceSemanticAuditVerdict", "SourceCompletenessVerdict"]
    assert replay["relationAudits"] == original["relationAudits"]
    graph["claims"][1]["statement"] += " Amended definition."
    changed = audit_input(source, graph, node_id, 1)
    assert not receipt_current(changed, original)
    restarted.operations.clear()
    replacement = restarted.audit(changed)
    assert receipt_passed(changed, replacement)
    assert restarted.operations == ["SourceSemanticAuditVerdict", "SemanticRelationVerdict", "SourceCompletenessVerdict"]
    assert replacement["relationAudits"][0]["inputFingerprint"] != original["relationAudits"][0]["inputFingerprint"]


def test_malformed_verifier_identity_fails_closed_after_metering_without_source_rejection(monkeypatch):
    """Identity and cardinality are runtime-owned slots: a missing slot or an echoed identity is a native-schema rejection."""
    from middleware.failure_policy import StructuredOutputRejected
    from structural_semantic_fixture import StructuralFixtureAuditor
    source, graph, node_id = example()
    second = {**deepcopy(graph["claims"][0]), "claimId": "claim-two"}
    graph["claims"].append(second)
    graph["sourceAccounting"][0]["claimIds"].append(second["claimId"])
    value = audit_input(source, graph, node_id, 1)
    row = lambda cid: {"id": cid, "verdict": "SUPPORTED", "gapCodes": [], "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}}
    valid = model_response({"verdict": "SUPPORTED", "gaps": [], "assertions": [row("claim-one"), row("claim-two")], "relations": []})
    assert sorted(valid["assertions"]) == ["claim_1", "claim_2"]
    missing = {**valid, "assertions": {"claim_1": valid["assertions"]["claim_1"]}}
    echoed = {**valid, "assertions": {**valid["assertions"], "claim-one": valid["assertions"]["claim_1"]}}
    outputs = [("SourceSemanticAuditVerdict", missing), ("SourceSemanticAuditVerdict", echoed), ("SourceSemanticAuditVerdict", valid), ("SourceCompletenessVerdict", {"coverage": {}})]
    model = RuleSetPreparationScriptedModel(responses=[AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"verifier-{i}"}]) for i, (name, args) in enumerate(outputs)])
    original_identity = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if m is model else original_identity(m, response))
    metered = []
    original_record = usage_metering.UsageMeteringMiddleware._record
    def record(self, response, current_model, invocation_id):
        metered.append((response, invocation_id, usage_metering.active_agent_role()))
        return original_record(self, response, current_model, invocation_id)
    monkeypatch.setattr(usage_metering.UsageMeteringMiddleware, "_record", record)
    auditor = SemanticAuditor(model)
    auditor.restore_receipt(StructuralFixtureAuditor().audit(value))
    with pytest.raises(StructuredOutputRejected, match="schema validation failed"):
        auditor.audit(value)
    assert [r["verdict"] for r in auditor.rejected_verdicts] == [missing, echoed]
    assert all("resolvedByOperationId" not in r for r in auditor.rejected_verdicts)
    # Exactly one governed native correction, which names only the runtime-chosen missing key; a second fault fails closed.
    assert len(metered) == len(model.prompts) == 2
    assert any("claim_2" in str(m.content) and "required" in str(m.content) for m in model.prompts[1])
    assert all(role == "legal-semantic-auditor" for _, _, role in metered)
    assert all(UUID(invocation) for _, invocation, _ in metered)
    altered = StructuralFixtureAuditor().audit(value)
    altered["assertions"][0]["checks"]["actor"] = "WRONG_ACTOR"
    assert not receipt_passed(value, altered)



def test_wrong_modality_gap_with_supported_modality_is_rejected_not_scored_as_a_detection():
    """Retained real N8 failure: assessability CONTRADICTED, but model labels it WRONG_MODALITY."""
    from rule_set_preparation.semantic_audit import validate_verdict
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)
    bad = {"verdict": "WRONG_MODALITY", "gaps": [{"code": "WRONG_MODALITY", "detail": "Actually an assessability mismatch"}],
           "assertions": [{"id": "claim-one", "verdict": "WRONG_MODALITY", "gapCodes": ["WRONG_MODALITY", "CONTRADICTED"],
                           "checks": {**{k: "SUPPORTED" for k in ASSERTION_CHECKS}, "assessability": "CONTRADICTED"}}],
           "relations": []}
    with pytest.raises(ValueError, match="modality gap contradicts"):
        validate_verdict(value, bad)
    corrected = deepcopy(bad)
    corrected["verdict"] = "CONTRADICTED"
    corrected["gaps"][0]["code"] = "CONTRADICTED"
    corrected["assertions"][0]["verdict"] = "CONTRADICTED"
    corrected["assertions"][0]["gapCodes"] = ["CONTRADICTED"]
    validate_verdict(value, corrected)


def test_wrong_relation_cannot_hide_independent_missing_duty_or_relabel_failure_as_pass():
    """Runtime regression for retained cessation omission masked by false relation rejection.

    Scripted model outputs prove only execution ordering and faithful accumulation,
    not the verifier's actual source-entailment accuracy.
    """
    from uuid import uuid4
    from rule_set_preparation.semantic_audit import RELATION_CHECKS
    source, graph, node_id = example()
    graph["relations"] = [{"relationId": f"edge-{i}", "fromClaimId": "claim-one", "toClaimId": "claim-one", "kind": "QUALIFIES", "referenceId": None} for i in range(5)]
    value = audit_input(source, graph, node_id, 1)

    class FalseRelationThenOmission(SemanticAuditor):
        def __init__(self):
            super().__init__()
            self.stages = []

        def _invoke(self, material, prompt, schema, validator):
            stage = schema["title"]
            self.stages.append(stage)
            if stage == "SourceSemanticRoles":
                return {"readings": []}, str(uuid4())
            if stage == "SourceMaterialCatalog":
                return {"facts": [], "noMaterialReason": "Scripted mechanical test only", "nonMaterialSpans": [{"spanId": s["id"], "reason": "Mechanical fixture only"} for s in material["sourceSpans"]]}, str(uuid4())
            if stage == "SourceSemanticAuditVerdict":
                result = {"verdict": "SUPPORTED", "gaps": [], "assertions": [
                    {"id": c["claimId"], "verdict": "SUPPORTED", "gapCodes": [],
                     "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}}
                    for c in material["claims"]], "relations": []}
            elif stage == "SemanticRelationVerdict":
                result = {"verdict": "WRONG_RELATION", "gaps": [
                    {"code": "WRONG_RELATION", "detail": "Model incorrectly rejects " + material["relationEvidence"][0]["relationId"]}],
                    "relations": [{"id": r["relationId"], "verdict": "WRONG_RELATION", "gapCodes": ["WRONG_RELATION"],
                                   "checks": {k: "WRONG_RELATION" for k in RELATION_CHECKS}}
                                  for r in material["relationEvidence"]]}
            else:
                assert stage == "SourceCompletenessVerdict"
                result = {"verdict": "MISSING_ASSERTION", "gaps": [
                    {"code": "MISSING_ASSERTION", "detail": "Independent source review finds an omitted duty"}], "coverage": []}
            return result, str(uuid4())

    auditor = FalseRelationThenOmission()
    receipt = auditor.audit(value)
    assert auditor.stages == ["SourceMaterialCatalog", "SourceMaterialCatalog", "SourceSemanticRoles", "SourceSemanticAuditVerdict", *["SemanticRelationVerdict"] * 10, "SourceCompletenessVerdict", "SourceCompletenessVerdict"]
    assert [g["code"] for g in receipt["gaps"]] == [*["WRONG_RELATION"] * 5, "MISSING_ASSERTION"]
    assert len(receipt["relations"]) == 5
    assert len(receipt["relationAudits"]) == 5
    assert receipt["completenessAudit"]["verdict"] == "MISSING_ASSERTION"
    assert receipt["verdict"] == "WRONG_RELATION"
    assert not receipt_passed(value, receipt)


def test_invalid_verifier_schema_is_rejected_inside_governance_after_metering(monkeypatch):
    from middleware.failure_policy import StructuredOutputRejected
    from rule_set_preparation.semantic_audit import PROMPT, verdict_schema, validate_verdict
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)
    invalid = {"verdict": "SUPPORTED", "gaps": [], "assertions": [{"id": "claim-one", "verdict": "SUPPORTED", "gapCodes": [], "checks": {**{k: "SUPPORTED" for k in ASSERTION_CHECKS}, "actor": "WRONG_RELATION"}}], "relations": []}
    model = RuleSetPreparationScriptedModel(responses=[AIMessage(content="", tool_calls=[{"name": "SourceSemanticAuditVerdict", "args": model_response(invalid), "id": f"invalid-check-{i}"}]) for i in range(2)])
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if m is model else original(m, response))
    metered = []
    record = usage_metering.UsageMeteringMiddleware._record
    def tracked(self, response, current_model, invocation_id):
        metered.append(invocation_id)
        return record(self, response, current_model, invocation_id)
    monkeypatch.setattr(usage_metering.UsageMeteringMiddleware, "_record", tracked)
    auditor = SemanticAuditor(model)
    with pytest.raises(StructuredOutputRejected, match="schema"):
        auditor._invoke(value, PROMPT, verdict_schema(value), validate_verdict)
    assert [r["verdict"] for r in auditor.rejected_verdicts] == [model_response(invalid)] * 2
    assert all("resolvedByOperationId" not in r for r in auditor.rejected_verdicts)
    assert len(metered) == len(model.prompts) == 2


@pytest.mark.parametrize("supported", [True, False])
def test_native_schema_repair_is_bounded_metered_and_cannot_turn_a_semantic_rejection_into_pass(monkeypatch, supported):
    from test_source_completeness import material
    from rule_set_preparation.semantic_audit import completeness_input, completeness_schema, COVERAGE_PROMPT
    from rule_set_preparation.source_completeness import coverage_result
    value, catalog, _ = material()
    question = completeness_input(value, catalog)
    invalid = {"coverage": {"fact_1": {"unitIds": [], "finding": "x" * 506}}}
    corrected = {"coverage": {"fact_1": {"unitIds": ["@claim[1]"] if supported else [], "finding": "" if supported else "The separate source duty is absent"}}}
    model = RuleSetPreparationScriptedModel(responses=[AIMessage(content="", tool_calls=[{"name": "SourceCompletenessVerdict", "args": r, "id": f"native-{i}"}]) for i, r in enumerate([invalid, corrected])])
    identity = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if m is model else identity(m, response))
    metered = []
    record = usage_metering.UsageMeteringMiddleware._record
    def track(self, response, current_model, invocation_id):
        metered.append(invocation_id)
        return record(self, response, current_model, invocation_id)
    monkeypatch.setattr(usage_metering.UsageMeteringMiddleware, "_record", track)
    auditor = SemanticAuditor(model)
    result, operation = auditor._invoke(question, COVERAGE_PROMPT, completeness_schema(), coverage_result)
    assert (result["verdict"] == "SUPPORTED") is supported
    assert len(model.prompts) == len(metered) == 2
    assert len(auditor.rejected_verdicts) == 1
    rejected = auditor.rejected_verdicts[0]
    assert rejected["verdict"] == invalid and rejected["operationId"] == metered[0]
    assert rejected["resolvedByOperationId"] == operation == metered[-1]
    assert rejected["inputFingerprint"] == digest(question)
    assert any("maxLength" in str(m.content) for m in model.prompts[1])


def test_opaque_identity_membership_remains_strict_without_provider_enum():
    from rule_set_preparation.semantic_audit import verdict_schema, validate_verdict
    from jsonschema import Draft7Validator
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)
    schema = verdict_schema(value)
    items = schema["properties"]["assertions"]
    assert items["minItems"] == items["maxItems"] == 1
    assert "enum" not in items["items"]["properties"]["id"]
    row = {"id": "unknown-source-claim", "verdict": "SUPPORTED", "gapCodes": [], "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}}
    result = {"verdict": "SUPPORTED", "gaps": [], "assertions": [row], "relations": []}
    Draft7Validator(schema).validate(result)
    with pytest.raises(ValueError, match="every owned assertion"):
        validate_verdict(value, result)
    row["id"] = "claim-one"
    validate_verdict(value, result)


def test_assessability_finding_cannot_be_rendered_as_wrong_modality():
    from rule_set_preparation.semantic_audit import verdict_schema, reconcile_response, project_source_readings, validate_verdict
    source, graph, unit = example()
    value = audit_input(source, graph, unit, 1)
    schema = verdict_schema(value)
    answer = {"assertions": {"claim_1": {"checks": {k: "SUPPORTED" for k in ["sourceSupport", "actor", "action", "scope"]}, "sourceReading": {"modalOperator": "DUTY", "operatorPolarity": "AFFIRMED", "semanticAuthority": "LEGAL_NORMATIVE", "assessability": "EXTERNAL_FULFILLMENT"}}}, "relations": []}
    response, _ = native_rows(value, schema, validate_verdict, answer)
    project_source_readings(value, response)
    canonical = reconcile_response(response, schema)
    assert canonical["verdict"] == "CONTRADICTED"
    assert canonical["assertions"][0]["gapCodes"] == ["CONTRADICTED"]
    assert canonical["gaps"] == [{"code": "CONTRADICTED", "detail": "claim-one/assessability: Independent source classification is EXTERNAL_FULFILLMENT; candidate assessability is REPOSITORY_VERIFIABLE"}]


@pytest.mark.parametrize("section,dimension,code", [("assertions", "actor", "WRONG_ACTOR"), ("assertions", "action", "WRONG_ACTION"), ("relations", "direction", "INSUFFICIENT_SUPPORT")])
def test_negative_wire_judgment_requires_its_finding_without_parallel_maps(section, dimension, code):
    from jsonschema import Draft7Validator
    from jsonschema.exceptions import ValidationError
    from rule_set_preparation.semantic_audit import verdict_schema, relation_schema, reconcile_response, validate_verdict
    source, graph, unit = example()
    edge = {"relationId": "edge", "kind": "CROSS_REFERENCE"}
    value = audit_input(source, graph, unit, 1) if section == "assertions" else relation_question(edge)
    schema = verdict_schema(value) if section == "assertions" else relation_schema([edge])
    key = "claim_1" if section == "assertions" else "relation_1"
    response = model_response({"assertions": [{"id": "claim-one", "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}}], "relations": []}) if section == "assertions" else {"relations": {"relation_1": {"targetScopeReading": "EXACT_SOURCE_TARGET", "checks": {k: "SUPPORTED" for k in ["kind", "direction"]}}}}
    rows, capture = native_rows(value, schema, validate_verdict, response)
    wire = Draft7Validator(capture.model_schema)
    response[section][key]["checks"][dimension] = {"code": code, "finding": "The selected source does not support this dimension"}
    wire.validate(response)
    rows = native_rows(value, schema, validate_verdict, response)[0]
    if section == "assertions":
        from rule_set_preparation.semantic_audit import project_source_readings
        project_source_readings(value, rows)
    assert reconcile_response(rows, schema)[section][0]["checks"][dimension] == code
    for invalid in [code, {"code": code}, {"code": code, "finding": None}, {"code": "SUPPORTED", "finding": "Contradictory finding"}]:
        response[section][key]["checks"][dimension] = invalid
        with pytest.raises(ValidationError):
            wire.validate(response)


def test_assertion_question_cannot_substitute_uncited_source_body_for_the_support():
    from rule_set_preparation.semantic_audit import verifier_payload
    import json
    source, graph, unit = example()
    source.nodes[unit]["content"] += " An uncited unrelated obligation follows."
    payload = verifier_payload(audit_input(source, graph, unit, 1))
    assert payload["assertions"][0]["resolvedSupport"][0]["text"] == "The operator must retain the export log."
    assert "uncited unrelated obligation" not in json.dumps(payload["assertions"])
    assert payload["sourceContext"] == [{"structuralPath": source.nodes[unit]["structuralPath"], "content": source.nodes[unit]["content"]}]


def test_assertion_question_retains_its_independent_source_reading_and_binds_review_identity():
    from rule_set_preparation.semantic_audit import assertion_input, verifier_payload
    from structural_semantic_fixture import mechanical_catalog
    source, graph, unit = example()
    value = audit_input(source, graph, unit, 1)
    catalog = mechanical_catalog(value)
    catalog["facts"] = [{"id": "source-fact", "meaning": "The operator must retain the export log."}]
    material = assertion_input(value, catalog)
    payload = verifier_payload(material)
    assert material["relations"] == []
    assert payload["independentSourceReading"]["facts"] == catalog["facts"]
    assert payload["independentSourceReading"]["classification"] == catalog["classification"]["readings"]
    changed = deepcopy(catalog)
    changed["verifierOperationId"] = "00000000-0000-4000-8000-000000000001"
    assert digest(assertion_input(value, changed)) != digest(material)


def test_completeness_question_keeps_all_meaning_and_the_entire_owned_source():
    from rule_set_preparation.semantic_audit import completeness_input, verifier_payload
    source, graph, unit = example()
    graph["claims"][0]["semanticFrame"]["scope"] = "export function"
    material = completeness_input(audit_input(source, graph, unit, 1))
    payload = verifier_payload(material)
    assert payload["source"]["content"] == source.nodes[unit]["content"]
    assert payload["semanticUnits"][0]["assertion"]["semanticFrame"]["scope"] == "export function"
    assert payload["semanticUnits"][0]["assertion"]["operative"] == graph["claims"][0]["operative"]
    assert payload["semanticUnits"][0]["outgoingRelations"] == material["relations"]
    assert "contextRelations" not in payload
    assert "sourceSupport" not in payload["semanticUnits"][0]["assertion"]


def test_provider_count_relaxation_keeps_canonical_exact_count_and_membership_validation():
    from jsonschema import Draft7Validator
    from jsonschema.exceptions import ValidationError
    from rule_set_preparation.semantic_audit import verifier_response_schema, verdict_schema, reconcile_response, validate_verdict
    source, graph, unit = example()
    value = audit_input(source, graph, unit, 1)
    canonical = verdict_schema(value)
    native = verifier_response_schema(canonical, value)
    # The native schema enumerates the supplied items as required keys, so it needs no provider-expanded count bounds at all.
    assert not {"minItems", "maxItems"} & native["properties"]["assertions"].keys()
    assert native["properties"]["assertions"]["required"] == ["claim_1"]
    assert canonical["properties"]["assertions"]["minItems"] == 1
    with pytest.raises(ValidationError) as missing:
        Draft7Validator(native).validate({"assertions": {}, "relations": []})
    assert missing.value.validator == "required"
    empty = {"assertions": [], "relations": []}
    result = reconcile_response(empty, canonical)
    with pytest.raises(ValidationError) as error:
        Draft7Validator(canonical).validate(result)
    assert error.value.validator == "minItems"
    with pytest.raises(ValueError, match="every owned assertion"):
        validate_verdict(value, result)


def test_completeness_distinguishes_owned_dependencies_from_inbound_context():
    from rule_set_preparation.semantic_audit import completeness_input, verifier_payload, RELATION_CONTRACTS
    source, graph, unit = example()
    material = completeness_input(audit_input(source, graph, unit, 1))
    material["relations"] = [
        {"relationId": "owned", "kind": "INCORPORATES", "fromClaimId": "claim-one", "toClaimId": "neighbor"},
        {"relationId": "inbound", "kind": "PRESERVES", "fromClaimId": "neighbor", "toClaimId": "claim-one"},
    ]
    material["relationContracts"] = {k: RELATION_CONTRACTS[k] for k in ["INCORPORATES", "PRESERVES"]}
    material["contextClaims"] = [{**material["claims"][0], "claimId": "neighbor"}]
    payload = verifier_payload(material)
    assert [r["relationId"] for r in payload["semanticUnits"][0]["outgoingRelations"]] == ["owned"]
    assert "contextRelations" not in payload
    assert payload["relationContracts"] == material["relationContracts"]


def test_matching_source_authority_cannot_be_reported_as_wrong_authority():
    from rule_set_preparation.semantic_audit import project_source_readings
    source, graph, unit = example()
    graph["claims"][0]["semanticAuthority"] = "ASSESSMENT_GUIDANCE"
    value = audit_input(source, graph, unit, 1)
    result = {"assertions": [{"id": "claim-one", "sourceReading": {"modalOperator": "DUTY", "operatorPolarity": "AFFIRMED", "semanticAuthority": "ASSESSMENT_GUIDANCE", "assessability": "REPOSITORY_VERIFIABLE"}, "checks": {**{k: "SUPPORTED" for k in ASSERTION_CHECKS}, "semanticAuthority": {"code": "WRONG_SEMANTIC_AUTHORITY", "finding": "Incorrect duplicate judgment"}}}]}
    # The model emits one source classification; categorical comparison labels
    # are derived from it rather than independently generated a second time.
    project_source_readings(value, result)
    assert result["assertions"][0]["checks"]["semanticAuthority"] == "SUPPORTED"
    graph["claims"][0]["operative"]["modality"] = "PERMISSION"
    value = audit_input(source, graph, unit, 1)
    project_source_readings(value, result)
    assert result["assertions"][0]["checks"]["modality"]["code"] == "WRONG_MODALITY"


@pytest.mark.parametrize("review_supported", [False, True])
def test_negative_critic_is_reviewed_once_with_bound_evidence_and_not_automatically_accepted(review_supported):
    from uuid import uuid4
    source, graph, unit = example()
    value = audit_input(source, graph, unit, 1)

    class Reviewed(SemanticAuditor):
        def __init__(self):
            super().__init__()
            self.questions = []

        def _invoke(self, material, prompt, schema, validator):
            self.questions.append(material)
            if schema["title"] == "IndependentSourceConcepts":
                return {"definitions": [], "factUses": []}, str(uuid4())
            if schema["title"] == "SourceSemanticRoles":
                return {"readings": []}, str(uuid4())
            if schema["title"] == "SourceMaterialCatalog":
                return {"facts": [], "noMaterialReason": "Scripted mechanical test only", "nonMaterialSpans": [{"spanId": s["id"], "reason": "Mechanical fixture only"} for s in material["sourceSpans"]]}, str(uuid4())
            if schema["title"] == "SourceCompletenessVerdict":
                return {"verdict": "SUPPORTED", "gaps": [], "coverage": []}, str(uuid4())
            supported = "criticVerdict" in material and review_supported
            code = "SUPPORTED" if supported else "WRONG_ACTOR"
            return {"verdict": code, "gaps": [] if supported else [{"code": code, "detail": "Bounded actor mismatch"}], "assertions": [{"id": "claim-one", "verdict": code, "gapCodes": [] if supported else [code], "checks": {**{k: "SUPPORTED" for k in ASSERTION_CHECKS}, "actor": code}}], "relations": []}, str(uuid4())

    auditor = Reviewed()
    receipt = auditor.audit(value)
    assert len(auditor.questions) == 6
    critic_questions = [q for q in auditor.questions if "criticVerdict" in q]
    assert len(critic_questions) == 1
    assert critic_questions[0]["criticVerdict"]["verdict"] == "WRONG_ACTOR"
    assert receipt_passed(value, receipt) == review_supported
    assert len(receipt["reviewHistory"]) == 1
    review = receipt["reviewHistory"][0]
    from rule_set_preparation.semantic_audit import assertion_input
    assert review["inputFingerprint"] == digest(assertion_input(value, receipt["sourceCatalog"]))
    assert review["initialVerdict"] == "WRONG_ACTOR"
    assert review["initialOperationId"] != review["reviewOperationId"] == receipt["verifierOperationId"]
    if review_supported:
        review["reviewOperationId"] = str(uuid4())
        assert not receipt_passed(value, receipt)


def test_verifier_aliases_round_trip_identity_without_rewriting_source_or_accepting_unknown_rows():
    from rule_set_preparation.semantic_audit import verifier_identities, replace_verifier_identities, restore_verifier_identities, verifier_payload, validate_verdict
    source, graph, unit = example()
    source.nodes[unit]["content"] += " claim-one"
    value = audit_input(source, graph, unit, 1)
    aliases = verifier_identities(value)
    payload = replace_verifier_identities(verifier_payload(value), aliases)
    assert payload["assertions"][0]["claimId"] == "@claim[1]"
    assert payload["assertions"][0]["statement"] == graph["claims"][0]["statement"]
    assert graph["claims"][0]["claimId"] == "claim-one"
    canonical = {"verdict": "SUPPORTED", "gaps": [], "assertions": [{"id": "@claim[1]", "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}, "verdict": "SUPPORTED", "gapCodes": []}], "relations": []}
    restored = restore_verifier_identities(canonical, aliases)
    validate_verdict(value, restored)
    canonical["assertions"][0]["id"] = "@context[999]"
    with pytest.raises(ValueError, match="every owned assertion"):
        validate_verdict(value, restore_verifier_identities(canonical, aliases))


def test_source_reading_failure_prevents_candidate_comparison():
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)
    phases = []
    class BrokenSourceReading(SemanticAuditor):
        def source_catalog(self, value):
            phases.append("source")
            raise ValueError("Independent source reading unavailable")
        def _audit_question(self, *args):
            phases.append("candidate")
            raise AssertionError("Candidate compared before independent source reading")
    with pytest.raises(ValueError, match="Independent source reading unavailable"):
        BrokenSourceReading().audit(value)
    assert phases == ["source"]


def test_relation_question_keeps_actual_role_neighborhood_without_adding_verdict_rows():
    from corrected_semantic_fixture import corrected_graph
    from rule_set_preparation.semantic_audit import relation_input, verifier_payload, verifier_identities, replace_verifier_identities
    _, source, graph, _, keys = corrected_graph()
    origin, target = keys["exception.transfer"], keys["transfer.permission"]
    focused = next(r for r in graph["relations"] if r["fromClaimId"] == origin["claimId"] and r["toClaimId"] == target["claimId"] and r["kind"] == "CONTEXT_FOR")
    value = audit_input(source, graph, origin["sourceNodeIds"][0], 1)
    question = relation_input(value, [focused])
    assert len(question["relationEvidence"]) == 1
    row = question["relationEvidence"][0]
    assert row["fromNeighborhoodComplete"] is True
    expected = {r["relationId"] for r in value["relations"] if r["fromClaimId"] == origin["claimId"] and r["relationId"] != focused["relationId"]}
    assert {r["relationId"] for r in row["fromOutgoingContext"]} == expected
    assert {"PRESERVES", "EXCEPTION_TO"} <= {r["kind"] for r in row["fromOutgoingContext"]}
    payload = replace_verifier_identities(verifier_payload(question), verifier_identities(question))
    assert len(payload["relations"]) == 1
    assert all(set(r) == {"kind", "sourceReference", "toAssertion"} for r in payload["relations"][0]["fromOutgoingContext"])
    assert all(r["toAssertion"]["claimId"].startswith("@context[") for r in payload["relations"][0]["fromOutgoingContext"])
    changed = deepcopy(value)
    removed = row["fromOutgoingContext"][0]["relationId"]
    changed["relations"] = [r for r in changed["relations"] if r["relationId"] != removed]
    assert digest(relation_input(changed, [focused])) != digest(question)
    changed["claims"] = [c for c in changed["claims"] if c["claimId"] != origin["claimId"]]
    changed["contextClaims"].append(origin)
    changed.pop("contextRelations")
    assert relation_input(changed, [focused])["relationEvidence"][0]["fromNeighborhoodComplete"] is False


def test_same_directed_relation_has_one_question_across_owning_and_receiving_views():
    from corrected_semantic_fixture import corrected_graph
    from rule_set_preparation.semantic_audit import relation_input
    from rule_set_preparation.source_completeness import source_material_input
    _, source, graph, _, keys = corrected_graph()
    origin, target = keys["export.software"], keys["def.copy"]
    focused = next(r for r in graph["relations"] if r["fromClaimId"] == origin["claimId"] and r["toClaimId"] == target["claimId"] and r["kind"] == "DEFINED_BY")
    owner = audit_input(source, graph, origin["sourceNodeIds"][0], 1)
    receiver = audit_input(source, graph, target["sourceNodeIds"][0], 1)
    assert focused in owner["relations"] and focused in receiver["relations"]
    assert focused["fromClaimId"] not in {c["claimId"] for c in receiver["claims"]}
    assert digest(relation_input(owner, [focused])) == digest(relation_input(receiver, [focused]))
    changed = deepcopy(receiver)
    assert changed["contextRelations"]
    changed["contextRelations"][0]["kind"] = "CONTEXT_FOR" if changed["contextRelations"][0]["kind"] != "CONTEXT_FOR" else "PRESERVES"
    assert audit_identity(changed)["contextFingerprint"] != audit_identity(receiver)["contextFingerprint"]
    # Candidate graph context never enters independent source discovery.
    assert source_material_input(changed, {}) == source_material_input(receiver, {})


@pytest.mark.parametrize("defect", ["missing", "foreign", "duplicate", "stale", "different_reading"])
def test_relation_receipt_requires_the_exact_independent_source_readings(defect):
    from corrected_semantic_fixture import corrected_graph
    from structural_semantic_fixture import StructuralFixtureAuditor
    from rule_set_preparation.semantic_audit import relation_input, relation_batches, verifier_payload
    _, source, graph, _, _ = corrected_graph()
    unit = graph["sourceAccounting"][0]["sourceNodeId"]
    value = audit_input(source, graph, unit, 1)
    receipt = StructuralFixtureAuditor().audit(value)
    from semantic_fidelity_harness import bridge
    graph["semanticAudits"] = [receipt]
    assert bridge("RECEIPT_GATE", source, graph, nodeId=unit) == []
    assert receipt_passed(value, receipt)
    batch = relation_batches(value)[0]
    payload = verifier_payload(relation_input(value, batch, receipt["relatedSourceCatalogs"]))
    assert payload["independentSourceReadings"]
    assert all("facts" in row and "classification" in row for row in payload["independentSourceReadings"])
    changed = deepcopy(receipt)
    rows = changed["relatedSourceCatalogs"]
    if defect == "missing": rows.pop()
    elif defect == "foreign": rows[0]["sourceNodeId"] = "f" * 64
    elif defect == "duplicate": rows.append(deepcopy(rows[0]))
    elif defect == "stale": rows[0]["catalog"]["sourceInputFingerprint"] = "0" * 64
    else:
        # Even a still-valid source reading must invalidate the comparison made against its predecessor.
        for row in rows: row["catalog"]["verifierOperationId"] = row["catalog"]["classification"]["verifierOperationId"] = "00000000-0000-4000-8000-000000000001"
    assert not receipt_passed(value, changed)
    graph["semanticAudits"] = [changed]
    assert bridge("RECEIPT_GATE", source, graph, nodeId=unit) == ["RELATION_AUDIT_REQUIRED"]


def test_missing_structured_verifier_answer_is_rejected_inside_governance_after_metering(monkeypatch):
    from middleware.failure_policy import StructuredOutputRejected
    from rule_set_preparation.semantic_audit import PROMPT, verdict_schema, validate_verdict
    source, graph, unit = example()
    value = audit_input(source, graph, unit, 1)
    model = RuleSetPreparationScriptedModel(responses=[AIMessage(content="No structured answer supplied")])
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if m is model else original(m, response))
    metered = []
    record = usage_metering.UsageMeteringMiddleware._record
    def tracked(self, response, current_model, invocation_id):
        metered.append(invocation_id)
        return record(self, response, current_model, invocation_id)
    monkeypatch.setattr(usage_metering.UsageMeteringMiddleware, "_record", tracked)
    auditor = SemanticAuditor(model)
    with pytest.raises(StructuredOutputRejected, match="no structured answer"):
        auditor._invoke(value, PROMPT, verdict_schema(value), validate_verdict)
    assert len(metered) == len(model.prompts) == 1
    assert auditor.rejected_verdicts == [{"expectedSchema": "SourceSemanticAuditVerdict", "rejection": "NO_STRUCTURED_RESPONSE", "operationId": metered[0]}]


@pytest.mark.parametrize("reading,expected", [("ADOPTED_PERFORMANCE", "SUPPORTED"), ("ADOPTED_NORMATIVE_LIMIT", "SUPPORTED"), ("REFERENCE_ONLY", "WRONG_RELATION"), ("NO_CONTENT_DEPENDENCY", "WRONG_RELATION"), ("UNDETERMINED", "INSUFFICIENT_SUPPORT")])
def test_incorporation_kind_is_derived_from_explicit_source_content_and_cannot_be_relabelled(reading, expected):
    from jsonschema import Draft7Validator
    from rule_set_preparation.semantic_audit import relation_schema, verifier_response_schema, project_relation_readings, reconcile_response, validate_verdict
    edge = {"relationId": "edge", "kind": "INCORPORATES"}
    canonical = relation_schema([edge])
    question = relation_question(edge)
    wire = verifier_response_schema(canonical, question)
    assert set(wire["properties"]["relations"]["properties"]["relation_1"]["properties"]["checks"]["properties"]) == {"direction"}
    answer = {"relations": {"relation_1": {"checks": {"direction": "SUPPORTED"}, "targetScopeReading": "EXACT_SOURCE_TARGET", "sourceReading": {"targetContentUse": reading}}}}
    result, _ = native_rows(question, canonical, validate_verdict, answer)
    project_relation_readings(result)
    verdict = reconcile_response(result, canonical)
    Draft7Validator(canonical).validate(verdict)
    validate_verdict({"claims": [], "relations": [edge]}, {**verdict, "assertions": []})
    assert verdict["relations"][0]["sourceContentReading"] == reading
    assert verdict["relations"][0]["checks"]["kind"] == expected
    if expected != "SUPPORTED":
        counterfeit = deepcopy(verdict)
        counterfeit["relations"][0]["checks"]["kind"] = "SUPPORTED"
        with pytest.raises(ValueError, match="source content reading"):
            validate_verdict({"claims": [], "relations": [edge]}, {**counterfeit, "assertions": []})


def test_worker_and_api_reject_forged_source_content_classification_without_changing_source():
    from corrected_semantic_fixture import corrected_graph
    from structural_semantic_fixture import StructuralFixtureAuditor
    from semantic_fidelity_harness import bridge
    _, source, graph, _, _ = corrected_graph()
    edge = next(r for r in graph["relations"] if r["kind"] == "INCORPORATES")
    unit = next(c["sourceNodeIds"][0] for c in graph["claims"] if c["claimId"] == edge["fromClaimId"])
    value = audit_input(source, graph, unit, 1)
    receipt = StructuralFixtureAuditor().audit(value)
    graph["semanticAudits"] = [receipt]
    assert receipt_passed(value, receipt)
    assert bridge("RECEIPT_GATE", source, graph, nodeId=unit) == []
    row = next(r for r in receipt["relations"] if r["id"] == edge["relationId"])
    row["sourceContentReading"] = "REFERENCE_ONLY"
    assert not receipt_passed(value, receipt)
    assert bridge("RECEIPT_GATE", source, graph, nodeId=unit) == ["RELATION_AUDIT_REQUIRED"]


@pytest.mark.parametrize("reading,expected", [("EXACT_SOURCE_TARGET", "SUPPORTED"), ("SUPPORTED_MEMBER_OF_SOURCE_TARGET_SET", "SUPPORTED"), ("OUTSIDE_SOURCE_TARGET_SCOPE", "WRONG_RELATION"), ("UNDETERMINED", "INSUFFICIENT_SUPPORT")])
def test_relation_source_scope_reading_is_atomic_and_cannot_override_missing_or_foreign_target(reading, expected):
    from jsonschema import Draft7Validator, ValidationError
    from rule_set_preparation.semantic_audit import relation_schema, verifier_response_schema, project_relation_readings, reconcile_response, validate_verdict
    edge = {"relationId": "edge", "kind": "CROSS_REFERENCE"}
    schema = relation_schema([edge])
    question = relation_question(edge)
    wire = verifier_response_schema(schema, question)
    answer = reading if expected == "SUPPORTED" else {"code": reading, "finding": "Selected target is unrelated to the source reference"}
    native = {"relations": {"relation_1": {"targetScopeReading": answer, "checks": {"kind": "SUPPORTED", "direction": "SUPPORTED"}}}}
    response, _ = native_rows(question, schema, validate_verdict, native)
    duplicate = deepcopy(native)
    duplicate["relations"]["relation_1"]["checks"]["target"] = "SUPPORTED"
    with pytest.raises(ValidationError):
        Draft7Validator(wire).validate(duplicate)
    project_relation_readings(response)
    verdict = reconcile_response(response, schema)
    Draft7Validator(schema).validate(verdict)
    validate_verdict({"claims": [], "relations": [edge]}, {**verdict, "assertions": []})
    assert verdict["relations"][0]["checks"]["target"] == expected
    counterfeit = deepcopy(verdict)
    counterfeit["relations"][0]["targetScopeReading"] = "OUTSIDE_SOURCE_TARGET_SCOPE" if expected == "SUPPORTED" else "EXACT_SOURCE_TARGET"
    with pytest.raises(ValueError, match="source scope reading"):
        validate_verdict({"claims": [], "relations": [edge]}, {**counterfeit, "assertions": []})


def test_worker_and_api_keep_supported_member_edges_separate_from_incomplete_source_coverage():
    from corrected_semantic_fixture import corrected_graph
    from structural_semantic_fixture import StructuralFixtureAuditor
    from semantic_fidelity_harness import bridge
    _, source, graph, _, _ = corrected_graph()
    edge = next(r for r in graph["relations"] if r["kind"] == "CROSS_REFERENCE")
    unit = next(c["sourceNodeIds"][0] for c in graph["claims"] if c["claimId"] == edge["fromClaimId"])
    value = audit_input(source, graph, unit, 1)
    receipt = StructuralFixtureAuditor().audit(value)
    graph["semanticAudits"] = [receipt]
    row = next(r for r in receipt["relations"] if r["id"] == edge["relationId"])
    row["targetScopeReading"] = "SUPPORTED_MEMBER_OF_SOURCE_TARGET_SET"
    assert receipt_passed(value, receipt)
    assert bridge("RECEIPT_GATE", source, graph, nodeId=unit) == []
    row["targetScopeReading"] = "OUTSIDE_SOURCE_TARGET_SCOPE"
    assert not receipt_passed(value, receipt)
    assert bridge("RECEIPT_GATE", source, graph, nodeId=unit) == ["RELATION_AUDIT_REQUIRED"]
    row["targetScopeReading"] = "SUPPORTED_MEMBER_OF_SOURCE_TARGET_SET"
    receipt["completenessAudit"]["verdict"] = "MISSING_ASSERTION"
    receipt["completenessAudit"]["gaps"] = [{"code": "MISSING_ASSERTION", "detail": "A separate source duty has no representation"}]
    assert not receipt_passed(value, receipt)
    assert bridge("RECEIPT_GATE", source, graph, nodeId=unit) == ["COMPLETENESS_AUDIT_REQUIRED"]


@pytest.mark.parametrize("authority,operator,polarity,candidate_authority,kind,supported", [
    ("EVIDENCE_GUIDANCE", "DUTY", "AFFIRMED", "ASSESSMENT_GUIDANCE", "CONTEXT", True),
    ("ASSESSMENT_GUIDANCE", "PERMISSION", "AFFIRMED", "EVIDENCE_GUIDANCE", "CONTEXT", True),
    ("LEGAL_NORMATIVE", "DUTY", "DENIED", "CONTEXT", "CONTEXT", True),
    ("CONTEXT", "DUTY", "DENIED", "LEGAL_NORMATIVE", "QUALIFIER", True),
    ("LEGAL_NORMATIVE", "DUTY", "AFFIRMED", "LEGAL_NORMATIVE", "DUTY", True),
    ("DEFINITION", "NON_OPERATIVE", "AFFIRMED", "DEFINITION", "DEFINITION", True),
    ("EVIDENCE_GUIDANCE", "DUTY", "AFFIRMED", "LEGAL_NORMATIVE", "DUTY", False),
    ("EVIDENCE_GUIDANCE", "DUTY", "AFFIRMED", "EVIDENCE_GUIDANCE", "DUTY", False),
    ("LEGAL_NORMATIVE", "DUTY", "AFFIRMED", "CONTEXT", "CONTEXT", False),
    ("LEGAL_NORMATIVE", "DUTY", "DENIED", "LEGAL_NORMATIVE", "PROHIBITION", False),
    ("LEGAL_NORMATIVE", "DUTY", "DENIED", "LEGAL_NORMATIVE", "DUTY", False),
    ("CONTEXT", "DUTY", "DENIED", "LEGAL_NORMATIVE", "DUTY", False),
    ("LEGAL_NORMATIVE", "NON_OPERATIVE", "AFFIRMED", "CONTEXT", "CONTEXT", False),
    ("CONTEXT", "NON_OPERATIVE", "AFFIRMED", "ASSESSMENT_GUIDANCE", "CONTEXT", False),
    ("DEFINITION", "NON_OPERATIVE", "AFFIRMED", "CONTEXT", "CONTEXT", False),
    ("EVIDENCE_GUIDANCE", "DUTY", "AFFIRMED", "LEGAL_NORMATIVE", "CONTEXT", False),
    ("LEGAL_NORMATIVE", "UNDETERMINED", "AFFIRMED", "CONTEXT", "CONTEXT", False),
])
def test_source_role_projection_preserves_legal_force_without_imposing_a_taxonomic_spelling(authority, operator, polarity, candidate_authority, kind, supported):
    """Typed mechanical controls; the supplied classifications are not legal entailment evidence."""
    from rule_set_preparation.semantic_audit import project_source_readings
    source, graph, unit = example()
    claim = graph["claims"][0]
    normative = kind in {"DUTY", "PROHIBITION", "PERMISSION"}
    claim.update(claimType=kind, semanticAuthority=candidate_authority,
        operative={"actor":"operator", "action":"test action", "modality":kind} if normative else None,
        assessability="REPOSITORY_VERIFIABLE" if normative else "NON_ASSESSABLE")
    result = {"assertions":[{"id":claim["claimId"], "checks":{k:"SUPPORTED" for k in ["sourceSupport","actor","action","scope"]},
        "sourceReading":{"modalOperator":operator,"operatorPolarity":polarity,"semanticAuthority":authority,"assessability":claim["assessability"]}}]}
    project_source_readings(audit_input(source, graph, unit, 1), result)
    assert all(v=="SUPPORTED" for v in result["assertions"][0]["checks"].values()) == supported


def test_source_role_projection_requires_polarity_and_rejects_denied_non_operator():
    from jsonschema import Draft7Validator
    from jsonschema.exceptions import ValidationError
    from rule_set_preparation.semantic_audit import project_source_readings, verifier_response_schema, verdict_schema
    from rule_set_preparation.semantic_audit import validate_verdict
    source, graph, unit = example()
    value = audit_input(source, graph, unit, 1)
    native = {"assertions":{"claim_1":{"checks":{k:"SUPPORTED" for k in ["sourceSupport","actor","action","scope"]},
        "sourceReading":{"modalOperator":"NON_OPERATIVE","semanticAuthority":"CONTEXT","assessability":"NON_ASSESSABLE"}}}, "relations":[]}
    schema = Draft7Validator(verifier_response_schema(verdict_schema(value), value))
    with pytest.raises(ValidationError, match="operatorPolarity"):
        schema.validate(native)
    native["assertions"]["claim_1"]["sourceReading"]["operatorPolarity"] = "DENIED"
    result, _ = native_rows(value, verdict_schema(value), validate_verdict, native)
    with pytest.raises(ValueError, match="no modal operator to deny"):
        project_source_readings(value, result)
