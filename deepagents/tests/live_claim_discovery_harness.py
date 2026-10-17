"""One-shot discovery-only acceptance. Only the exact isolated database bridge is reachable."""
from __future__ import annotations
import argparse
import json
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

from langchain_core.callbacks import BaseCallbackHandler
from middleware.usage_metering import AgentRunState, activate_agent_run_state
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream
from rule_set_preparation.agent import create_rule_set_preparation_agent
from rule_set_preparation.legal_source_files import materialize_legal_source
from tests.review_frontier_harness import runtime, ROOT

class SafeTrace(BaseCallbackHandler):
    def __init__(self,path): self.path=path;self.tools=Counter()
    def on_tool_start(self,serialized,input_str,*,inputs=None,**kwargs):
        name=serialized.get("name") if serialized else kwargs.get("name")
        self.tools[name]+=1
        with self.path.open("a") as output:output.write(json.dumps({"event":"TOOL_START","tool":name})+"\n")

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--expected-sha",required=True);parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    if (args.output/"live-discovery-started.json").exists():raise RuntimeError("The single live discovery invocation is already reserved; no second run is authorized")
    sha=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
    if sha!=args.expected_sha:raise RuntimeError("Harness requires the exact committed candidate SHA")
    owned=["apps/api/src/modules/compliance-rule-set","apps/api/test/support/review-frontier-bridge.ts","packages/contracts","deepagents/rule_set_preparation","deepagents/tests/live_claim_discovery_harness.py","deepagents/tests/review_frontier_harness.py","deepagents/tests/fixtures/review-frontier-source.json"]
    if subprocess.check_output(["git","diff","HEAD","--",*owned],cwd=ROOT):raise RuntimeError("Harness source differs from committed candidate")
    seed,ctx,_=runtime(small=True)
    progress=ctx.inventory.frontier.request("INIT")
    if progress["progress"]["total"]!=6:raise RuntimeError("Expected exactly six source-bearing review units")
    trace=SafeTrace(args.output/"live-tools.ndjson");events=[]
    def emit(event):
        data=event.get("data",{})
        if event["event_type"].startswith("MODEL_CALL") or data.get("activity_kind") in {"CLAIM_INVENTORY_PROGRESS","CLAIM_PHASE_TRANSITION","CLAIM_PHASE_VALIDATION","NO_PROGRESS_DETECTED"}:
            safe={k:event[k] for k in ["event_type","emitted_at","client_sequence"]}
            safe["data"]={k:v for k,v in data.items() if k in {"activity_kind","phase","previous_phase","inventory_revision","inventory_fingerprint","review_frontier","source_nodes_reviewed","source_nodes_remaining","claim_count","claim_relation_count","effective_state_fingerprint","gap_fingerprint","gap_counts","outcome","provider","model","usage","duration_ms","inventory_validation_attempt","provider_attempts","credential_attempts","fallback_used"}}
            events.append(safe)
            with (args.output/"live-progress.ndjson").open("a") as output:output.write(json.dumps(safe)+"\n")
    session=AgentStreamSession(assessment_id=None,run_id=ctx.run_id,correlation_id=ctx.run_id,boundary_name="claim-discovery-diagnostic",emit_payload=emit,boundary_type="RULE_SET_PREPARATION",preparation_run_id=ctx.run_id)
    bundle={"legalSourceVersionId":seed["source"]["legalSourceVersionId"],"legalSourceVersion":"SYNTHETIC-DISCOVERY-ONLY", "documentGraph":seed["documentGraph"],
        "documents":[{"documentId":"synthetic-discovery","sourceEffectStatus":"IN_FORCE","chunks":[{**c,"legalStatusSourceRef":"synthetic-fixture:declared-in-force"} for c in seed["chunks"]]}]}
    with tempfile.TemporaryDirectory(prefix="lcsp-claim-discovery-") as directory:
        root=Path(directory);materialize_legal_source(bundle,root)
        agent=create_rule_set_preparation_agent(context=ctx,legal_source_root=root)
        journal={"sha":sha,"preparationRunId":ctx.run_id,"sourceVersionId":ctx.source_graph.version,"mode":"CLAIM_DISCOVERY_ONLY","frontier":progress,"modelInvoked":True}
        with (args.output/"live-discovery-started.json").open("x") as output:json.dump(journal,output,indent=2)
        error=None
        try:
            with activate_agent_stream(session),activate_agent_run_state(AgentRunState(run_id=ctx.run_id,agent_role="rule-set-preparation")):
                agent.invoke({"messages":[{"role":"user","content":"Review the synthetic legal source for semantic claim discovery only. Call get_next_review_unit, interpret only that bounded unit with its structural/reference context, register all distinct claims and semantic dependencies, and complete its typed disposition. Follow references using document graph tools and explicitly expand scope only if required. Repeat runtime-scheduled work until discoveryCompleteEligible=true, then finalize_semantic_claim_inventory. STOP at CLAIM_INVENTORY_READY. No Rule authoring or submission is authorized."}]},config={"callbacks":[trace],"configurable":{"thread_id":ctx.run_id}})
        except Exception as failure:error=type(failure).__name__
        status=ctx.inventory.frontier.request("PROGRESS")
        ready=ctx.inventory.phase=="CLAIM_INVENTORY_READY" and ctx.inventory.frozen is not None
        assert not ctx.submission and not ctx.draft["legalRequirements"] and not ctx.draft["assessmentRules"]
        report={**journal,"outcome":"PASS" if ready else "NOT_ACCEPTED","errorType":error,"phase":ctx.inventory.phase,
            "modelCalls":sum(e["event_type"]=="MODEL_CALL_STARTED" for e in events),"completedModelCalls":sum(e["event_type"]=="MODEL_CALL_COMPLETED" for e in events),
            "toolCalls":dict(trace.tools),"validationAttempts":ctx.inventory.inventory_validation_calls,
            "noProgressEvents":sum(e["data"].get("activity_kind")=="NO_PROGRESS_DETECTED" for e in events),
            "claims":len(ctx.inventory.identities),"claimRelations":len(ctx.draft["claimRelations"]),"inventoryRevision":ctx.inventory.revision,
            "inventoryFingerprint":ctx.inventory.frozen_fingerprint,"finalFrontier":status,"validations":ctx.trace,
            "ruleSets":0,"submissions":0,"productionPreparations":0}
        (args.output/"live-discovery-result.json").write_text(json.dumps(report,indent=2))
        (args.output/"live-claim-inventory.json").write_text(json.dumps(ctx.inventory.graph(),indent=2))
        print(json.dumps({k:report[k] for k in ["outcome","phase","errorType","modelCalls","claims","validationAttempts","inventoryFingerprint","finalFrontier"]}),flush=True)
        if not ready:raise SystemExit(1)

if __name__=="__main__":main()
