"""Summarize safe persisted phase telemetry and frozen inventory rows without model messages."""
import json
from collections import Counter
from pathlib import Path
P=Path(__file__).resolve().parent
KINDS=["CLAIM_INVENTORY_PROGRESS","CLAIM_PHASE_TRANSITION","CLAIM_PHASE_VALIDATION","NO_PROGRESS_DETECTED","CLAIM_DISCOVERY_TOOL_REJECTED","RULE_AUTHORING_TOOL_REJECTED","RULE_AUTHORING_REJECTION_RESOLVED","CLAIM_INVENTORY_READ_REJECTED","RULE_AUTHORING_TOOL_REJECTED","RULE_VALIDATION_STARTED","RULE_VALIDATION_PASSED","RULE_VALIDATION_FAILED","RULE_AUTHORING_CONTEXT"]
d=json.loads((P/"disposable-observation.json").read_text())
events=[e["outputSummaryJson"]["agentStreamEvent"] for e in d["AssessmentRuntimeEvent"] if (e.get("outputSummaryJson") or {}).get("agentStreamEvent")]
activity=[]
for e in events:
 data=e.get("data") or {}
 if data.get("activity_kind") in KINDS:
  activity.append({"eventId":e["eventId"],"emittedAt":e["emittedAt"],**data})
validations=[e for e in activity if e["activity_kind"]=="CLAIM_PHASE_VALIDATION"]
transitions=[e for e in activity if e["activity_kind"]=="CLAIM_PHASE_TRANSITION"]
inventories=[{k:r[k] for k in ["preparationRunId","revision","fingerprint","graphDigest","createdAt","reopenReason"]}|{"claimCount":len(r["graph"]["claims"]),"relationCount":len(r["graph"]["relations"]),"reviewCount":len(r["graph"]["sourceAccounting"])} for r in d["RuleSetPreparationClaimInventory"]]
ctxs=[e for e in activity if e["activity_kind"]=="RULE_AUTHORING_CONTEXT"]
out={"latestAuthoringContext":(ctxs[-1] if ctxs else None),"activityKindCounts":dict(Counter(e["activity_kind"] for e in activity)),"capturedAt":d["capturedAt"],"preparation":d["RuleSetPreparationRun"],"inventories":inventories,"transitions":transitions,"validations":validations,"progress":activity,"validationCounts":dict(Counter((v["phase"]+":"+str(v.get("outcome"))) for v in validations)),"noProgressEvents":sum(e["activity_kind"]=="NO_PROGRESS_DETECTED" for e in activity),"uniqueInventoryFingerprints":len({v.get("claim_inventory_fingerprint") for v in validations}),"uniqueRequirementFingerprints":len({v.get("requirement_fingerprint") for v in validations}),"uniqueAccountingFingerprints":len({v.get("accounting_fingerprint") for v in validations})}
(P/"claim-phase-observation.json").write_text(json.dumps(out,indent=2)+"\n")
print(json.dumps({k:v for k,v in out.items() if k not in ["progress","validations","transitions","preparation"]},indent=2))
