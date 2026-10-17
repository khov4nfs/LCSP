"""Read-only live observer. Never dispatches, retries or cancels a Preparation."""
import json,subprocess,sys,time
from pathlib import Path
P=Path(__file__).resolve().parent
while True:
 with (P/"observe.log").open("w") as log:
  subprocess.run([sys.executable,str(P/"disposable.py"),"observe"],stdout=log,check=True)
 for name in ["claim-phase-observation.py","summarize-disposable.py"]:
  subprocess.run([sys.executable,str(P/name)],stdout=subprocess.DEVNULL,check=True)
 d=json.loads((P/"disposable-summary.json").read_text());c=json.loads((P/"claim-phase-observation.json").read_text())
 observation=json.loads((P/"disposable-observation.json").read_text())
 reviews=observation["RuleSetPreparationSourceReview"]
 witness={"capturedAt":observation["capturedAt"],"frontiers":[{k:r.get(k) for k in ["pendingCount","blockedCount","inReviewCount","reviewedWithClaimsCount","reviewedNoClaimsCount","stateFingerprint","frozenAt"]} for r in observation["RuleSetPreparationReviewFrontier"]],"reviews":[{"sourceNodeId":r["sourceNodeId"],"state":r["state"],"claimIds":r["claimIds"],"published":bool(r["completionFingerprint"]),"blockedReferenceIds":r["blockedReferenceIds"],"relations":(r.get("payload") or {}).get("relations",[]),"referenceAccounting":(r.get("payload") or {}).get("referenceAccounting",[]),"invalidatedRelationIds":(r.get("payload") or {}).get("invalidatedRelationIds",[])} for r in reviews]}
 with (P/"live-frontier-durability.ndjson").open("a") as out:out.write(json.dumps(witness)+"\n")
 assert len(c["preparation"])==1
 run=c["preparation"][0];progress=[e for e in c["progress"] if e["activity_kind"]=="CLAIM_INVENTORY_PROGRESS"]
 last=progress[-1] if progress else {}
 row={"time":d["capturedAt"],"state":d["state"],"phase":run["claimPhase"],"calls":d["model"]["logicalCalls"],"completed":d["model"]["logicalCompletions"],"claims":last.get("claim_count"),"relations":last.get("claim_relation_count"),"reviewed":last.get("source_nodes_reviewed"),"remaining":last.get("source_nodes_remaining"),"requirements":last.get("requirement_count"),"assessmentRules":last.get("assessment_rule_count"),"inventoryRevisions":len(c["inventories"]),"validationCounts":c["validationCounts"],"activityKindCounts":c["activityKindCounts"],"authoringContext":{k:(c.get("latestAuthoringContext") or {}).get(k) for k in ["eventSequence","draftRevision","requirementCount","assessmentRuleCount","requirementsWithoutRule","outstandingRejectionCode","outstandingRejectionCount","lastMutationTool","digestBytes"]},"ruleValidatorAttempts":c["activityKindCounts"].get("RULE_VALIDATION_STARTED",0),"noProgressEvents":c["noProgressEvents"]}
 with (P/"live-progress.ndjson").open("a") as out:out.write(json.dumps(row)+"\n")
 print(json.dumps(row),flush=True)
 if d["state"] not in ["RUNNING","QUEUED"]:break
 time.sleep(15)
