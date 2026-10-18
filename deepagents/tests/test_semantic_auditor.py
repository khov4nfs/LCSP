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


def example():
    node = {"nodeId": "a" * 64, "parentNodeId": None, "structuralPath": "/document/unit", "nodeType": "ARTICLE", "content": "The operator must retain the export log.", "legalEffectStatus": "EFFECTIVE"}
    source = SimpleNamespace(nodes={node["nodeId"]: node}, graph={"materializationId": "b" * 64, "references": []})
    claim = {"claimId": "claim-one", "sourceNodeIds": [node["nodeId"]], "claimType": "DUTY", "statement": node["content"], "operative": {"actor": "operator", "modality": "DUTY", "action": "retain the export log"}, "sourceSupport": canonical_support(source, [node["nodeId"]], [{"nodeId": node["nodeId"], "startOffset": 0, "endOffset": len(node["content"])}]), "semanticAuthority": "LEGAL_NORMATIVE", "assessability": "REPOSITORY_VERIFIABLE", "semanticFrame": {k: None for k in FRAME_FIELDS}, "state": "RELEVANT"}
    graph = {"claims": [claim], "relations": [], "sourceAccounting": [{"sourceNodeId": node["nodeId"], "claimIds": [claim["claimId"]]}]}
    return source, graph, node["nodeId"]


@pytest.mark.parametrize("verdict", ["SUPPORTED", "CONTRADICTED", "INSUFFICIENT_SUPPORT", "MISSING_ASSERTION", "WRONG_ACTOR", "WRONG_MODALITY", "WRONG_ACTION", "WRONG_SCOPE", "WRONG_RELATION", "WRONG_SEMANTIC_AUTHORITY"])
def test_independent_verdict_runs_through_governed_agent_stack(monkeypatch, verdict):
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)
    checks = {k: "SUPPORTED" for k in ASSERTION_CHECKS}
    dimension = {"CONTRADICTED": "sourceSupport", "INSUFFICIENT_SUPPORT": "sourceSupport", "WRONG_ACTOR": "actor", "WRONG_MODALITY": "modality", "WRONG_ACTION": "action", "WRONG_SCOPE": "scope", "WRONG_SEMANTIC_AUTHORITY": "semanticAuthority"}.get(verdict)
    if dimension: checks[dimension] = verdict
    result = {"verdict": verdict, "gaps": [] if verdict == "SUPPORTED" else [{"code": verdict, "detail": "Bounded factual repair target"}], "assertions": [{"id": "claim-one", "checks": checks, "verdict": verdict, "gapCodes": [] if verdict == "SUPPORTED" else [verdict]}], "relations": []}
    model = RuleSetPreparationScriptedModel(responses=[AIMessage(content="", tool_calls=[{"name": "SourceSemanticAuditVerdict", "args": result, "id": "audit-verdict"}]), AIMessage(content="", tool_calls=[{"name": "SourceCompletenessVerdict", "args": {"verdict": "SUPPORTED", "gaps": []}, "id": "completeness"}])])
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if m is model else original(m, response))
    receipt = SemanticAuditor(model).audit(value)
    UUID(receipt["verifierOperationId"])
    assert receipt["verifierRole"] == "legal-semantic-auditor"
    assert receipt["assertions"][0]["fingerprint"] == digest(graph["claims"][0])
    assert receipt_passed(value, receipt) == (verdict == "SUPPORTED")
    assert receipt_current(value, receipt)
    assert len(model.prompts) == (2 if verdict == "SUPPORTED" else 1)
    assert len(model.prompts[0]) == 2  # dedicated system context + bounded evidence, no Producer transcript
    assert "independent source-to-assertion verifier" in model.prompts[0][0].content
    assert model.bound_tool_names[0] == ["SourceSemanticAuditVerdict"]
    if verdict == "SUPPORTED":
        assert model.bound_tool_names[1] == ["SourceCompletenessVerdict"]
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
            result = {"verdict": "SUPPORTED", "gaps": []}
            if schema["title"] == "SourceSemanticAuditVerdict":
                result.update(assertions=[{"id": c["claimId"], "verdict": "SUPPORTED", "gapCodes": [], "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}} for c in value["claims"]], relations=[])
            elif schema["title"] == "SemanticRelationVerdict":
                result["relations"] = [{"id": r["relationId"], "verdict": "SUPPORTED", "gapCodes": [], "checks": {k: "SUPPORTED" for k in RELATION_CHECKS}} for r in value["relationEvidence"]]
            return result, str(uuid4())

    original = ScriptedParts().audit(audit_input(source, graph, node_id, 1))
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
    from middleware.failure_policy import StructuredOutputRejected
    from structural_semantic_fixture import StructuralFixtureAuditor
    source, graph, node_id = example()
    second = {**deepcopy(graph["claims"][0]), "claimId": "claim-two"}
    graph["claims"].append(second)
    graph["sourceAccounting"][0]["claimIds"].append(second["claimId"])
    value = audit_input(source, graph, node_id, 1)
    row = lambda cid: {"id": cid, "verdict": "SUPPORTED", "gapCodes": [], "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}}
    valid = {"verdict": "SUPPORTED", "gaps": [], "assertions": [row("claim-one"), row("claim-two")], "relations": []}
    invalid = {**valid, "assertions": [row("claim-one"), row("claim-one")]}
    outputs = [("SourceSemanticAuditVerdict", invalid), ("SourceSemanticAuditVerdict", valid), ("SourceCompletenessVerdict", {"verdict": "SUPPORTED", "gaps": []})]
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
    with pytest.raises(StructuredOutputRejected, match="every owned assertion"):
        auditor.audit(value)
    assert auditor.rejected_verdicts == [invalid]
    # Shared governance sends schema failures to an eligible provider fallback, never
    # retries the same scripted route or mislabels them as source-semantic verdicts.
    assert len(metered) == len(model.prompts) == 1
    assert all(role == "legal-semantic-auditor" for _, _, role in metered)
    assert all(UUID(invocation) for _, invocation, _ in metered)
    altered = StructuralFixtureAuditor().audit(value)
    altered["assertions"][0]["checks"]["actor"] = "WRONG_ACTOR"
    assert not receipt_passed(value, altered)
