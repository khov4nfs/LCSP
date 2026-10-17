"""Transactional deterministic frontier regressions; no provider or full Preparation dispatcher."""
import json
import os
from copy import deepcopy
from uuid import uuid4

import pytest
from middleware.failure_policy import NoProgressDetected
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from review_frontier_harness import runtime, call, discover, DatabaseFrontierApi

pytestmark=pytest.mark.skipif("lcsp_review_frontier_test" not in os.environ.get("REVIEW_FRONTIER_DATABASE_URL",os.environ.get("DATABASE_URL","")),reason="Requires explicitly selected isolated frontier database")

def no_claim(tools,work):
    for ref in work["unit"]["references"]:
        assert call(tools,"review_source_reference",reference_id=ref["referenceId"],material=False,relation_ids=[],non_material_reason="No claim in this scripted fixture relies on this reference")["outcome"]=="PASSED"
    return call(tools,"complete_source_review",disposition="NO_RELEVANT_SEMANTIC_CLAIMS",reason="Scripted scope has no relevant semantic proposition in this unit")

def finish_empty(tools):
    while True:
        work=call(tools,"get_next_review_unit")
        assert work["outcome"]=="PASSED",work
        if not work["unit"]: break
        assert no_claim(tools,work)["outcome"]=="PASSED"
    return call(tools,"finalize_semantic_claim_inventory")

def register(tools,key,kind="CONTEXT"):
    return call(tools,"register_semantic_claim",identity_key=key,claim_type=kind,statement="The service must retain receipts" if kind=="DUTY" else "Synthetic "+kind,
                **({"actor":"The service","action":"retain receipts"} if kind=="DUTY" else {}))

def test_real_queue_discovery_freezes_and_forbids_rule_tools():
    seed,ctx,tools=runtime()
    result=discover(seed,ctx,tools)
    assert result["outcome"]=="PASSED"
    assert not {"author_legal_requirement","author_assessment_rule","validate_compliance_rule_set","submit_compliance_rule_set"}&tools.keys()
    assert ctx.inventory.frontier.snapshot["progress"]["pending"]==0
    assert ctx.inventory.begin_authoring()["outcome"]=="FAILED"

def test_historical_partial_claim_review_is_actionable_and_default_collects_exact_ids():
    _,ctx,tools=runtime(small=True)
    work=call(tools,"get_next_review_unit")
    one=register(tools,"definition.a")["claim"]["claimId"]
    two=register(tools,"definition.b")["claim"]["claimId"]
    invalid=call(tools,"complete_source_review",disposition="CLAIMS_AUTHORED",claim_ids=[one])
    assert invalid["missingClaimIds"]==[two] and invalid["requiredAction"]=="complete_source_review"
    accepted=call(tools,"complete_source_review",disposition="CLAIMS_AUTHORED")
    assert set(accepted["claimIds"])=={one,two}
    assert accepted["progress"]["pending"]==work["progress"]["pending"]
    assert call(tools,"get_next_review_unit")["unit"]["sourceNodeId"]!=work["unit"]["sourceNodeId"]

def test_multi_claim_unit_cannot_hide_duty_under_context_and_idempotent_completion():
    _,ctx,tools=runtime(small=True);call(tools,"get_next_review_unit")
    ids={kind:register(tools,"mixed."+kind,kind)["claim"]["claimId"] for kind in ["CONTEXT","DUTY","EXCEPTION","TEMPORAL_RULE"]}
    result=call(tools,"complete_source_review",disposition="CONTEXT_ONLY")
    assert "SOURCE_REVIEW_DISPOSITION_INVALID" in result["gaps"]
    result=call(tools,"complete_source_review",disposition="CLAIMS_AUTHORED",claim_ids=[cid for kind,cid in ids.items() if kind!="DUTY"])
    assert result["missingClaimIds"]==[ids["DUTY"]]
    good=call(tools,"complete_source_review",disposition="CLAIMS_AUTHORED")
    repeat=call(tools,"complete_source_review",disposition="CLAIMS_AUTHORED")
    assert repeat["alreadyCompleted"] and repeat["frontierStateFingerprint"]==good["frontierStateFingerprint"]
    assert len(ctx.draft["sourceAccounting"][good["completedSourceNodeId"]]["claimIds"])==4

def test_no_claim_needs_no_fake_claim_and_can_freeze_empty_semantic_scope():
    _,ctx,tools=runtime(small=True)
    result=finish_empty(tools)
    assert result["outcome"]=="PASSED",result
    assert ctx.inventory.phase=="CLAIM_INVENTORY_READY" and not ctx.inventory.identities
    assert len(ctx.inventory.frozen["sourceAccounting"])==6
    assert all(not row["claimIds"] and row["nonSemanticReason"] for row in ctx.inventory.frozen["sourceAccounting"])

def test_stable_claim_identity_retries_and_repeated_next_keep_same_active_draft():
    _,ctx,tools=runtime(small=True);one=call(tools,"get_next_review_unit")
    first=register(tools,"Stable claim")
    again=register(tools,"  stable   claim  ")
    assert first["claim"]["claimId"]==again["claim"]["claimId"]
    assert len(ctx.inventory.identities)==1
    assert call(tools,"remove_semantic_claim",claim_id=first["claim"]["claimId"],reason="Scripted correction")["outcome"]=="PASSED"
    assert call(tools,"get_next_review_unit")["unit"]["sourceNodeId"]==one["unit"]["sourceNodeId"]
    assert not ctx.inventory.frontier.owned_claims()

def test_references_block_expand_reuse_and_wake_without_returning_same_unit_forever():
    seed,ctx,tools=runtime(small=True)
    nodes=sorted([n for n in seed["documentGraph"]["nodes"] if n["nodeType"]=="ARTICLE"],key=lambda n:int(n["label"]))
    frontier=ctx.inventory.frontier
    init=frontier.request("INIT",scopeNodeIds=[n["nodeId"] for n in nodes[:4]])
    assert init["progress"]["total"]==4
    for _ in range(3):
        work=call(tools,"get_next_review_unit");assert no_claim(tools,work)["outcome"]=="PASSED"
    work=call(tools,"get_next_review_unit");assert work["unit"]["sourceNodeId"]==nodes[3]["nodeId"]
    refs=work["unit"]["references"];target6=next(r for r in refs if r["toNodeId"]==nodes[5]["nodeId"])
    for ref in refs:
        if ref!=target6:call(tools,"review_source_reference",reference_id=ref["referenceId"],material=False,relation_ids=[],non_material_reason="Context reference only in this scripted scope")
    failed=call(tools,"complete_source_review",disposition="REQUIRES_REFERENCE_RESOLUTION",reason="Inspect target definition first",reference_ids=[target6["referenceId"]])
    assert failed["requiredAction"]=="expand_review_frontier"
    expanded=call(tools,"expand_review_frontier",reference_ids=[target6["referenceId"]],reason="The active claim requires this definition")
    assert expanded["frontierRevision"]==2 and expanded["progress"]["total"]==5
    assert call(tools,"expand_review_frontier",reference_ids=[target6["referenceId"]],reason="The same definition target")["alreadyInFrontier"]
    blocked=call(tools,"complete_source_review",disposition="REQUIRES_REFERENCE_RESOLUTION",reason="Inspect target definition first",reference_ids=[target6["referenceId"]])
    assert blocked["progress"]["blocked"]==1
    following=call(tools,"get_next_review_unit");assert following["unit"]["sourceNodeId"]==nodes[5]["nodeId"]
    assert no_claim(tools,following)["outcome"]=="PASSED"
    reopened=call(tools,"get_next_review_unit");assert reopened["unit"]["sourceNodeId"]==nodes[3]["nodeId"]
    assert no_claim(tools,reopened)["outcome"]=="PASSED"
    result=call(tools,"finalize_semantic_claim_inventory");assert result["outcome"]=="PASSED",result
    assert ctx.inventory.phase=="CLAIM_INVENTORY_READY"

def test_lease_stale_revision_and_source_version_isolation():
    seed,ctx,tools=runtime(small=True);work=call(tools,"get_next_review_unit");api=ctx.api
    conflict=api.source_review_operation(ctx.run_id,1,"NEXT",operationId=str(uuid4()))
    assert conflict["failures"][0]["code"]=="SOURCE_REVIEW_LEASE_CONFLICT"
    stale=api.source_review_operation(ctx.run_id,1,"NEXT",operationId=ctx.inventory.frontier.operation_id,sourceRevision="f"*64)
    assert stale["failures"][0]["code"]=="STALE_REVIEW_REVISION"
    other,otherctx,_=runtime(small=True)
    wrong=api.source_review_operation(otherctx.run_id,1,"INIT",operationId=str(uuid4()),scopeNodeIds=[work["unit"]["sourceNodeId"]])
    assert wrong["failures"][0]["code"]=="CLAIM_SOURCE_BINDING_INVALID"
    assert no_claim(tools,work)["outcome"]=="PASSED"

def test_committed_reviews_rehydrate_without_repeating_completed_nodes():
    seed,ctx,tools=runtime(small=True);first=call(tools,"get_next_review_unit")
    cid=register(tools,"durable-context")["claim"]["claimId"]
    call(tools,"complete_source_review",disposition="CONTEXT_ONLY")
    resumed=RuleSetPreparationContext(ctx.run_id,ctx.api,source_graph=ctx.source_graph,discovery_only=True)
    other={t.name:t for t in build_rule_set_tools(resumed)}
    next_unit=call(other,"get_next_review_unit")
    assert next_unit["unit"]["sourceNodeId"]!=first["unit"]["sourceNodeId"]
    assert cid in resumed.inventory.identities and len(resumed.draft["sourceAccounting"])==1
    assert no_claim(other,next_unit)["outcome"]=="PASSED"
    assert finish_empty(other)["outcome"]=="PASSED"

def test_frontier_no_progress_does_not_loosen_and_valid_work_resets_state():
    _,ctx,tools=runtime(small=True)
    assert "NO_PROGRESS" not in call(tools,"finalize_semantic_claim_inventory")
    assert call(tools,"finalize_semantic_claim_inventory")["NO_PROGRESS"]
    with pytest.raises(NoProgressDetected):call(tools,"finalize_semantic_claim_inventory")
    work=call(tools,"get_next_review_unit");assert no_claim(tools,work)["outcome"]=="PASSED"
    assert "NO_PROGRESS" not in call(tools,"finalize_semantic_claim_inventory")
    assert finish_empty(tools)["outcome"]=="PASSED"


def test_native_managed_agent_stops_at_inventory_ready_without_rule_tools(tmp_path,monkeypatch):
    from langchain_core.messages import AIMessage
    from middleware import usage_metering
    from rule_set_preparation.agent import create_rule_set_preparation_agent
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
    seed,ctx,_=runtime(small=True)
    actions=[]
    def step(name,**args):actions.append(AIMessage(content="",tool_calls=[{"name":name,"args":args,"id":"frontier-"+str(len(actions))}]))
    for node in sorted([n for n in seed["documentGraph"]["nodes"] if n["nodeType"]=="ARTICLE"],key=lambda n:int(n["label"])):
        step("get_next_review_unit")
        if node["label"]=="2":step("register_semantic_claim",identity_key="receipt-duty",claim_type="DUTY",statement="The service must retain transfer receipts",actor="The service",action="retain transfer receipts")
        for ref in seed["documentGraph"]["references"]:
            if ref["fromNodeId"]==node["nodeId"]:step("mark_reference_non_material",reference_id=ref["referenceId"],reason="No operative claim in this scripted diagnostic relies on this edge")
        step("complete_source_review",disposition="CLAIMS_AUTHORED" if node["label"]=="2" else "NO_RELEVANT_SEMANTIC_CLAIMS",**({} if node["label"]=="2" else {"reason":"This scripted diagnostic has no claim for this unit"}))
    step("finalize_semantic_claim_inventory")
    model=RuleSetPreparationScriptedModel(responses=actions)
    original=usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering,"assert_model_identity",lambda m,response=None:None if isinstance(m,RuleSetPreparationScriptedModel) else original(m,response))
    graph=create_rule_set_preparation_agent(context=ctx,legal_source_root=tmp_path,model=model)
    graph.invoke({"messages":[{"role":"user","content":"Complete the deterministic review frontier and freeze the inventory. Stop at CLAIM_INVENTORY_READY."}]})
    assert ctx.inventory.phase=="CLAIM_INVENTORY_READY" and ctx.submission is None
    bound={name for names in model.bound_tool_names for name in names}
    assert "get_next_review_unit" in bound and "complete_source_review" in bound
    assert not {"author_legal_requirement","author_assessment_rule","validate_compliance_rule_set","submit_compliance_rule_set"}&bound


def test_already_reviewed_reference_cannot_create_unwakeable_block():
    seed,ctx,tools=runtime(small=True)
    for _ in range(3):
        work=call(tools,"get_next_review_unit");assert no_claim(tools,work)["outcome"]=="PASSED"
    work=call(tools,"get_next_review_unit")
    ref=next(r for r in work["unit"]["references"] if r["toNodeId"] in ctx.draft["sourceAccounting"])
    result=call(tools,"complete_source_review",disposition="REQUIRES_REFERENCE_RESOLUTION",reason="Target inspection requested",reference_ids=[ref["referenceId"]])
    assert result["outcome"]=="FAILED" and result["requiredAction"]=="inspect_semantic_reference_binding"
    assert ctx.inventory.frontier.snapshot["progress"]["blocked"]==0


def test_completed_relation_requires_owning_review_reopen_before_mutation():
    _,ctx,tools=runtime(small=True);call(tools,"get_next_review_unit")
    one=register(tools,"context.one")["claim"]["claimId"]
    two=register(tools,"context.two")["claim"]["claimId"]
    relation=call(tools,"link_semantic_claims",from_claim_id=one,to_claim_id=two,kind="CROSS_REFERENCE")["relation"]["relationId"]
    call(tools,"complete_source_review",disposition="CONTEXT_ONLY")
    call(tools,"get_next_review_unit")
    rejected=call(tools,"remove_semantic_relation",relation_id=relation,reason="Intentional correction")
    assert rejected["outcome"]=="FAILED" and rejected["requiredAction"]=="reopen_source_review"
    assert relation in ctx.draft["claimRelations"]


def test_cosmetic_review_reopen_cannot_reset_phase_no_progress():
    _,ctx,tools=runtime(small=True)
    while True:
        work=call(tools,"get_next_review_unit")
        if not work["unit"]:break
        assert no_claim(tools,work)["outcome"]=="PASSED"
    ctx.api.claim_inventory_operation=lambda *args,**kwargs:{"outcome":"FAILED","failures":[{"code":"SEMANTIC_CLAIM_INVALID","ref":"unchanged-test-gap"}]}
    assert "NO_PROGRESS" not in call(tools,"validate_semantic_claim_inventory")
    assert call(tools,"validate_semantic_claim_inventory")["NO_PROGRESS"]
    previous=ctx.inventory.frontier.snapshot["frontierStateFingerprint"]
    node=next(iter(ctx.draft["sourceAccounting"]))
    assert call(tools,"reopen_source_review",source_node_id=node,reason="Reword the same no-claim explanation")["outcome"]=="PASSED"
    call(tools,"get_next_review_unit")
    result=call(tools,"complete_source_review",disposition="NO_RELEVANT_SEMANTIC_CLAIMS",reason="Different words describe the same empty semantic scope")
    assert result["frontierStateFingerprint"]==previous
    with pytest.raises(NoProgressDetected):call(tools,"validate_semantic_claim_inventory")


def test_exact_retained_six_completed_reopen_once_repair_restore_and_freeze():
    from review_frontier_harness import bridge
    from test_semantic_reference_binding import FIXTURE, REFERENCE, SOURCE, SCOPE, DEFINITION
    seed = bridge({"action": "SEED_RETAINED"})
    scope, definition = seed["claimIds"][SCOPE], seed["claimIds"][DEFINITION]
    ctx = RuleSetPreparationContext(seed["preparationRunId"], DatabaseFrontierApi(),
        source_graph=PinnedSourceGraph(seed["documentGraph"], []), discovery_only=True)
    tools = {t.name: t for t in build_rule_set_tools(ctx)}
    progress = call(tools, "get_review_progress")
    assert progress["progress"]["reviewedWithClaims"] == 6
    invalid = call(tools, "validate_semantic_claim_inventory")
    assert "SEMANTIC_DEPENDENCY_DETACHED" in invalid["gaps"]
    assert call(tools, "reopen_source_review", source_node_id=SOURCE, reason="Repair the retained wrong structural target")["outcome"] == "PASSED"
    assert call(tools, "get_next_review_unit")["unit"]["sourceNodeId"] == SOURCE
    inspected = call(tools, "inspect_semantic_reference_binding", reference_id=REFERENCE)
    assert inspected["targetReviewReady"]
    assert [c["claimId"] for c in inspected["targetClaims"]] == [definition]
    bad = FIXTURE["reviews"][3]["payload"]["relations"][0]
    assert call(tools, "remove_semantic_relation", relation_id=seed["relationIds"][bad["relationId"]], reason="This source-side cross-reference claim is not the resolved target")["outcome"] == "PASSED"
    args = dict(reference_id=REFERENCE, from_claim_id=scope, to_claim_id=definition, kind="DEFINITION")
    bound = call(tools, "bind_semantic_reference", **args)
    assert bound["outcome"] == "PASSED", bound
    assert call(tools, "bind_semantic_reference", **args) == bound
    completed = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    assert completed["outcome"] == "PASSED", completed
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["alreadyCompleted"]
    assert all(completed["progress"][k] == 0 for k in ["pending", "blocked", "inReview"])
    restarted = RuleSetPreparationContext(ctx.run_id, ctx.api, source_graph=ctx.source_graph, discovery_only=True)
    resumed = {t.name: t for t in build_rule_set_tools(restarted)}
    assert call(resumed, "get_review_progress")["progress"]["discoveryCompleteEligible"]
    rid = bound["relation"]["relationId"]
    assert restarted.inventory.frontier.relation_owners[rid] == SOURCE
    assert scope in restarted.inventory.identities and definition in restarted.inventory.identities
    assert restarted.draft["referenceAccounting"][REFERENCE]["relationIds"] == [rid]
    assert len(restarted.draft["claimRelations"]) == 1
    ready = call(resumed, "finalize_semantic_claim_inventory")
    assert ready["outcome"] == "PASSED", ready
    assert restarted.inventory.phase == "CLAIM_INVENTORY_READY"
    assert len(restarted.inventory.identities) == sum(len(r["payload"]["claims"]) for r in FIXTURE["reviews"])


@pytest.mark.parametrize("target_descendant", [False, True])
def test_target_scheduling_inspection_atomic_binding_and_native_managed_inventory_ready(tmp_path, monkeypatch, target_descendant):
    from langchain_core.messages import AIMessage
    from middleware import usage_metering
    from rule_set_preparation.agent import create_rule_set_preparation_agent
    from rule_set_preparation.claim_inventory import claim_id
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
    seed, ctx, _ = runtime(small=True, target_descendant=target_descendant)
    nodes = sorted([n for n in seed["documentGraph"]["nodes"] if n["nodeType"] == "ARTICLE"], key=lambda n: int(n["label"]))
    ref = next(r for r in seed["documentGraph"]["references"] if r["toNodeId"] == nodes[5]["nodeId"])
    target_unit = next(n for n in seed["reviewUnits"] if n["nodeId"] == ref["toNodeId"] or n["parentNodeId"] == ref["toNodeId"])
    if target_descendant: assert target_unit["parentNodeId"] == ref["toNodeId"]
    actions = []
    def step(name, **args): actions.append(AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": "binding-" + str(len(actions))}]))
    def finish(node):
        if node["nodeId"] == target_unit["nodeId"]:
            step("register_semantic_claim", identity_key="transfer-definition", claim_type="DEFINITION", statement="A record transfer means delivery of a record by a participating service to another participating service.")
            step("complete_source_review", disposition="CONTEXT_ONLY")
        else: step("complete_source_review", disposition="NO_RELEVANT_SEMANTIC_CLAIMS", reason="No claim in this scripted scope")
    for node in seed["reviewUnits"]:
        step("get_next_review_unit")
        if node["nodeId"] == ref["fromNodeId"]:
            step("register_semantic_claim", identity_key="transfer-scope", claim_type="SCOPE", statement="The duty applies to record transfers as defined in Article 6.")
            for other in seed["documentGraph"]["references"]:
                if other["referenceId"] != ref["referenceId"]:
                    step("mark_reference_non_material", reference_id=other["referenceId"], reason="No additional semantic dependency in this scripted scope")
            step("inspect_semantic_reference_binding", reference_id=ref["referenceId"])
            step("complete_source_review", disposition="REQUIRES_REFERENCE_RESOLUTION", reference_ids=[ref["referenceId"]], reason="Review the referenced definition before binding")
        else: finish(node)
    step("get_next_review_unit")
    step("inspect_semantic_reference_binding", reference_id=ref["referenceId"])
    step("bind_semantic_reference", reference_id=ref["referenceId"],
        from_claim_id=claim_id(ctx.run_id, 1, [nodes[3]["nodeId"]], "transfer-scope"),
        to_claim_id=claim_id(ctx.run_id, 1, [target_unit["nodeId"]], "transfer-definition"), kind="DEFINITION")
    step("complete_source_review", disposition="CLAIMS_AUTHORED")
    step("finalize_semantic_claim_inventory")
    model = RuleSetPreparationScriptedModel(responses=actions)
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response))
    graph = create_rule_set_preparation_agent(context=ctx, legal_source_root=tmp_path, model=model)
    result = graph.invoke({"messages": [{"role": "user", "content": "Review the target definition, bind the material reference atomically, complete all work and freeze the inventory."}]})
    inspections = [json.loads(m.content) for m in result["messages"] if getattr(m, "name", None) == "inspect_semantic_reference_binding"]
    assert inspections[0]["targetReviewReady"] is False
    assert inspections[0]["targetReviewState"] == "TARGET_REVIEW_REQUIRED"
    assert inspections[1]["targetReviewReady"] is True
    assert inspections[1]["targetClaims"][0]["sourceNodeIds"] == [target_unit["nodeId"]]
    assert ctx.inventory.phase == "CLAIM_INVENTORY_READY"
    assert len(ctx.inventory.frozen["relations"]) == 1
    bound_tools = {name for names in model.bound_tool_names for name in names}
    assert "bind_semantic_reference" in bound_tools and "review_source_reference" not in bound_tools
    assert ctx.submission is None
