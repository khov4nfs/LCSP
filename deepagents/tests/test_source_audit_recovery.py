"""Real Producer Agent + governed Verifier Agent + transactional source-review handler, with scripted models only."""
import json
import os

import pytest
from langchain_core.messages import AIMessage
from middleware import usage_metering
from rule_set_preparation.claim_inventory import claim_id
from rule_set_preparation.semantic_audit import SemanticAuditor, ASSERTION_CHECKS, reconstruct_audit_receipts
from review_frontier_harness import runtime, call, bridge
from structural_semantic_fixture import mechanical_arguments
from authoring_contract_harness import Step, run_script
from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
from semantic_verifier_fixture import model_response
from rule_set_preparation.source_completeness import source_spans

pytestmark = pytest.mark.skipif("lcsp_review_frontier_test" not in os.environ.get("REVIEW_FRONTIER_DATABASE_URL", ""), reason="explicit owned frontier DB required")


@pytest.mark.parametrize("missing", [False, True], ids=["wrong-actor", "missing-definition"])
def test_independent_failure_keeps_same_unit_visible_and_producer_repairs_before_durable_completion(tmp_path, monkeypatch, missing):
    _, ctx, tools = runtime(small=True)
    unit = call(tools, "get_next_review_unit")["unit"]["sourceNodeId"]
    key, kind = "independent-repair", "DEFINITION" if missing else "DUTY"
    cid = claim_id(ctx.run_id, 1, [unit], key)

    def assertion(verdict):
        checks = {k: "SUPPORTED" for k in ASSERTION_CHECKS}
        if verdict != "SUPPORTED": checks["actor"] = verdict
        return {"verdict": verdict, "gaps": [] if verdict == "SUPPORTED" else [{"code": verdict, "detail": "Correct the assertion's actor against its cited source"}],
                "assertions": [{"id": cid, "verdict": verdict, "checks": checks, "gapCodes": [] if verdict == "SUPPORTED" else [verdict]}], "relations": []}

    def message(name, args, index):
        wire = ({"coverage": {"fact_1": {"unitIds": [] if args["gaps"] else ["@claim[1]"], "finding": args["gaps"][0]["detail"] if args["gaps"] else ""}}} if name == "SourceCompletenessVerdict" else args if name == "SourceMaterialCatalog" else model_response(args, {"modalOperator": "NON_OPERATIVE", "semanticAuthority": "DEFINITION", "assessability": "NON_ASSESSABLE"} if missing else None))
        return AIMessage(content="", tool_calls=[{"name": name, "args": wire, "id": "verifier-" + str(index)}])

    responses = ([message("SourceSemanticAuditVerdict", {"verdict": "SUPPORTED", "gaps": [], "assertions": [], "relations": []}, 0),
                  message("SourceCompletenessVerdict", {"verdict": "MISSING_ASSERTION", "gaps": [{"code": "MISSING_ASSERTION", "detail": "The source unit's definition is absent"}]}, 1),
                  message("SourceCompletenessVerdict", {"verdict": "MISSING_ASSERTION", "gaps": [{"code": "MISSING_ASSERTION", "detail": "The source unit's definition is absent"}]}, 4)] if missing else
                 [message("SourceSemanticAuditVerdict", assertion("WRONG_ACTOR"), 0),
                  message("SourceSemanticAuditVerdict", assertion("WRONG_ACTOR"), 4),
                  message("SourceCompletenessVerdict", {"verdict": "SUPPORTED", "gaps": []}, 1)])
    responses += [message("SourceSemanticAuditVerdict", assertion("SUPPORTED"), 2), message("SourceCompletenessVerdict", {"verdict": "SUPPORTED", "gaps": []}, 3)]
    catalog = message("SourceMaterialCatalog", {"facts": [{"id": "fact", "dependency": "NONE", "modality": "NON_OPERATIVE" if missing else "DUTY", "semanticAuthority": "DEFINITION" if missing else "LEGAL_NORMATIVE", "startSpanId": source_spans(ctx.source_graph.nodes[unit])[0]["id"], "endSpanId": source_spans(ctx.source_graph.nodes[unit])[-1]["id"], "meaning": "Scripted source fact for recovery mechanics"}], "noMaterialReason": "", "nonMaterialSpans": []}, 5)
    for fact in catalog.tool_calls[0]["args"]["facts"]:
        for field in ["id", "dependency", "modality", "semanticAuthority"]: fact.pop(field)
    roles = AIMessage(content="", tool_calls=[{"name": "SourceSemanticRoles", "args": {"readings": {"fact_1": {"addressee": "" if missing else "operator", "sourceRole": "DEFINITION" if missing else "LEGAL_NORMATIVE", "modalOperator": "NON_OPERATIVE" if missing else "DUTY", "operatorPolarity": "AFFIRMED", "dependency": "NONE"}}}, "id": "source-roles"}])
    responses[:0] = [catalog, catalog, roles]
    verifier = RuleSetPreparationScriptedModel(responses=responses)
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response))
    ctx.semantic_auditor = SemanticAuditor(verifier)
    args = mechanical_arguments(ctx, {"identity_key": key, "source_node_ids": [unit], "claim_type": kind, "statement": "Scripted review assertion", **({} if missing else {"actor": "Wrong actor", "action": "retain the log"})})
    events, observed = [], {}

    def rejected(c, result, view, text):
        assert result["outcome"] == "FAILED" and "SEMANTIC_AUDIT_REQUIRED" in result["gaps"]
        assert c.inventory.frontier.active["sourceNodeId"] == unit
        assert unit not in c.draft["sourceAccounting"] and c.validation_calls == 0
        assert result["semanticAuditVerdict"] == ("MISSING_ASSERTION" if missing else "WRONG_ACTOR")
        observed["rejection"] = result

    def complete(c, result, view, text):
        assert result["outcome"] == "PASSED" and c.inventory.frontier.active is None
        assert c.draft["sourceAccounting"][unit]["claimIds"] == [cid]

    steps = [] if missing else [Step("register_semantic_claim", args)]
    steps += [Step("complete_source_review", {"disposition": "NO_RELEVANT_SEMANTIC_CLAIMS", "reason": "Scripted empty inventory"} if missing else {"disposition": "CLAIMS_AUTHORED"}, check=rejected)]
    if missing:
        steps.append(Step("register_semantic_claim", args))
    else:
        steps.append(Step("update_semantic_claim", {**{k: v for k, v in args.items() if k not in {"identity_key", "source_node_ids"}}, "claim_id": cid, "actor": "Correct source actor"}))
    steps.append(Step("complete_source_review", {"disposition": "CONTEXT_ONLY" if missing else "CLAIMS_AUTHORED"}, check=complete))
    run_script(ctx, steps, tmp_path, monkeypatch, events=events)
    receipts = reconstruct_audit_receipts(events)
    assert len(receipts) == 2 and receipts[-1]["verdict"] == "SUPPORTED" and receipts[0]["verifierOperationId"] != receipts[-1]["verifierOperationId"]
    assert len(verifier.prompts) == 8
    persisted = bridge({"action": "STATE", "request": {"preparationRunId": ctx.run_id}})
    row = next(r for r in persisted["rows"] if r["sourceNodeId"] == unit)
    assert row["payload"]["semanticAudit"] == receipts[-1]
    assert observed["rejection"] and not ctx.draft["legalRequirements"] and ctx.submission is None
