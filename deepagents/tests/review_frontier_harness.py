"""Provider-free native-tool harness backed by real transactional API handlers."""
import json
import os
import subprocess
from copy import deepcopy
from pathlib import Path

from structural_semantic_fixture import StructuralFixtureAuditor, MechanicalTools, mechanical_arguments
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools

ROOT=Path(__file__).resolve().parents[2]

_process = None

def bridge(payload):
    global _process
    if _process is None:
        _process=subprocess.Popen(["pnpm","exec","tsx","apps/api/test/support/review-frontier-bridge.ts"],cwd=ROOT,
            env={**os.environ,"REVIEW_FRONTIER_BRIDGE_STREAM":"true","DATABASE_URL":os.environ.get("REVIEW_FRONTIER_DATABASE_URL",os.environ.get("DATABASE_URL",""))},stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,text=True,bufsize=1)
        import atexit
        def close():
            _process.stdin.close()
            try: _process.wait(timeout=10)
            except subprocess.TimeoutExpired: _process.terminate()
        atexit.register(close)
    _process.stdin.write(json.dumps(payload)+"\n");_process.stdin.flush()
    while True:
        line=_process.stdout.readline()
        if not line: raise RuntimeError("Frontier bridge exited before returning a result")
        try: result=json.loads(line)
        except json.JSONDecodeError: continue
        if "error" in result: raise RuntimeError(result["error"])
        return result["result"]

class DatabaseFrontierApi:
    def source_review_operation(self,run_id,revision,action,**fields):
        return bridge({"action":"REVIEW","request":{"preparationRunId":run_id,"inventoryRevision":revision,"action":action,**fields}})
    def claim_inventory_operation(self,run_id,action,revision,**fields):
        return bridge({"action":"INVENTORY","request":{"preparationRunId":run_id,"action":action,"revision":revision,**fields}})
    def validate_compliance_rule_set(self,*args):
        raise AssertionError("Discovery-only harness cannot validate Rules")
    def submit_compliance_rule_set(self,*args):
        raise AssertionError("Discovery-only harness cannot submit")

def runtime(small=False, target_descendant=False):
    seed=bridge({"action":"SEED","small":small,"targetDescendant":target_descendant});graph=seed["documentGraph"]
    chunks=[{**c,"chunkId":c["id"]} for c in seed["chunks"]]
    ctx=RuleSetPreparationContext(seed["preparationRunId"],DatabaseFrontierApi(),source_graph=PinnedSourceGraph(graph,chunks),discovery_only=True,semantic_auditor=StructuralFixtureAuditor())
    tools=MechanicalTools(ctx, build_rule_set_tools(ctx))
    return seed,ctx,tools

def call(tools,name,**args):
    if name in {"register_semantic_claim", "update_semantic_claim"} and isinstance(tools, MechanicalTools):
        args = mechanical_arguments(tools.context, args)
    return json.loads(tools[name].invoke(args))

def discover(seed,ctx,tools,record=None,finalize=True,completions=None):
    remap={};pending_relations=deepcopy(seed["packet"]["semanticGraph"]["relations"])
    def action(name,**args):
        if name == "register_semantic_claim": args = mechanical_arguments(ctx, args)
        if record:record(name,args)
        return call(tools,name,**args)
    while True:
        work=action("get_next_review_unit");assert work["outcome"]=="PASSED",work
        if work["unit"] is None:
            assert work["progress"]["discoveryCompleteEligible"],work
            break
        node=work["unit"]["sourceNodeId"]
        for c in seed["packet"]["semanticGraph"]["claims"]:
            if node not in c["sourceNodeIds"] or c["claimId"] in remap:continue
            result=action("register_semantic_claim",identity_key=c["claimId"],source_node_ids=c["sourceNodeIds"],claim_type=c["claimType"],statement=c["statement"],
                **({"actor":c["operative"]["actor"],"action":c["operative"]["action"]} if c["operative"] else {}))
            assert result["outcome"]=="PASSED",result
            remap[c["claimId"]]=result["claim"]["claimId"]
        for r in pending_relations[:]:
            if r["fromClaimId"] in remap and r["toClaimId"] in remap:
                result=action("link_semantic_claims",from_claim_id=remap[r["fromClaimId"]],to_claim_id=remap[r["toClaimId"]],kind=r["kind"],
                    **({"reference_id":r["referenceId"]} if r["referenceId"] else {}))
                assert result["outcome"]=="PASSED",result
                pending_relations.remove(r)
        for ref in work["unit"]["references"]:
            result=action("review_source_reference",reference_id=ref["referenceId"],material=False,relation_ids=[],non_material_reason="Scripted source fixture contains no material incorporation at this edge")
            assert result["outcome"]=="PASSED",result
        owned=ctx.inventory.frontier.owned_claims()
        result=action("complete_source_review",disposition="CLAIMS_AUTHORED" if owned else "NO_RELEVANT_SEMANTIC_CLAIMS",
            **({} if owned else {"reason":"Scripted source unit has no independent claim in this fixture"}))
        assert result["outcome"]=="PASSED",result
        if completions is not None:completions.append(result)
    assert not pending_relations,pending_relations
    if not finalize:return None
    result=action("finalize_semantic_claim_inventory");assert result["outcome"]=="PASSED",result
    assert ctx.inventory.phase=="CLAIM_INVENTORY_READY" and ctx.submission is None
    return result

if __name__=="__main__":
    from middleware.failure_policy import NoProgressDetected
    seed,ctx,tools=runtime()
    assert "NO_PROGRESS" not in call(tools,"finalize_semantic_claim_inventory")
    assert call(tools,"finalize_semantic_claim_inventory")["NO_PROGRESS"]
    try:call(tools,"finalize_semantic_claim_inventory")
    except NoProgressDetected:pass
    else:raise AssertionError("Repeated frontier state must terminate after feedback")
    result=discover(seed,ctx,tools)
    first=call(tools,"get_review_progress");second=call(tools,"get_review_progress")
    assert first["frontierStateFingerprint"]==second["frontierStateFingerprint"]
    print(json.dumps({"frontierProtocol":"PASS","phase":ctx.inventory.phase,"inventoryFingerprint":result["fingerprint"],
        "frontier":ctx.inventory.frontier.snapshot,"claims":len(ctx.inventory.identities),"noProgress":"PASS","stableFingerprint":"PASS","providerCalls":0,"fullPreparationsDispatched":0,"ruleSets":0}))
