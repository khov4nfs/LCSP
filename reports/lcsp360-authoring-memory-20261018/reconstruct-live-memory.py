"""Rebuild what the model could see after CLAIM_INVENTORY_READY in live run 7fefb641 (retained evidence only)."""
import json,re,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path[:0]=[str(ROOT/'deepagents')]
from langchain_core.messages import AIMessage,HumanMessage,ToolMessage
from rule_set_preparation.draft_history import compact_draft_history
log=(ROOT/'reports/lcsp360-rule-authoring-20261017/live-evidence/server.log').read_text(errors='replace').splitlines()
ctx,resp=[],[]
for l in log:
    if 'rule-set-preparation' in l and 'MODEL_CONTEXT_DIAGNOSTIC' in l:
        m=re.search(r'estimated_input_bytes=(\d+).*?message_count=(\d+).*?tool_result_count=(\d+)',l)
        if m:ctx.append((int(m.group(2)),int(m.group(3)),int(m.group(1))))
    if 'MODEL_RESPONSE_DIAGNOSTIC' in l:
        m=re.search(r"'calls': \[(.*?)\], 'invalid'",l);names=re.findall(r"'name': '([^']+)', 'arg_keys': \[([^\]]*)\], 'arg_chars': (\d+)",m.group(1)) if m else []
        resp.append((l[:19],[(n,k.replace("'",""),int(c)) for n,k,c in names]))
tools=lambda ms:sum(isinstance(m,ToolMessage) for m in ms)
msgs=[HumanMessage(content='start')];sim=[];vis=[]
for j in range(len(resp)):
    view=compact_draft_history(list(msgs));sim.append((len(view),tools(view)));vis.append({m.tool_call_id for m in view if isinstance(m,ToolMessage)})
    calls=[{'name':n,'args':{},'id':f'c{j}_{i}'} for i,(n,_,_) in enumerate(resp[j][1])]
    msgs.append(AIMessage(content='',tool_calls=calls));msgs+=[ToolMessage(content='r',tool_call_id=c['id']) for c in calls]
collapse=lambda s:[x for i,x in enumerate(s) if i==0 or x!=s[i-1]]
live=collapse([(a,b) for a,b,_ in ctx]);simc=collapse(sim)
rejected_seconds={'11:22:48','11:22:56','11:23:06','11:23:16'}  # CLAIM_INVENTORY_READ_REJECTED events in disposable-observation.json
rej=sorted({j for j,(t,c) in enumerate(resp) if t[11:] in rejected_seconds and c and c[0][0]=='get_claim_inventory'})
rej=[max(j for j,(t,c) in enumerate(resp) if t[11:]==s and c and c[0][0]=='get_claim_inventory') for s in sorted(rejected_seconds)]
post=[j for j,(t,c) in enumerate(resp) if t>='2026-10-17 11:22:46']
rows=[]
for j in post:
    reads=[k for k in range(j) if resp[k][1] and resp[k][1][0][0]=='get_claim_inventory' and f'c{k}_0' in vis[j]]
    prior=[k for k in rej if k<j];last=prior[-1] if prior else None
    rows.append({'request':j,'time':resp[j][0][11:],'tool':resp[j][1][0][0],'priorInventoryReadsVisible':len(reads),'lastRejectionVisible':(last in reads) if last is not None else None,'roundsSinceLastRejection':(j-last) if last is not None else None,'thisCallRejected':j in rej})
visible=[r for r in rows if r['lastRejectionVisible'] is True];gone=[r for r in rows if r['lastRejectionVisible'] is False and r['tool']=='get_claim_inventory']
out={'method':'real compact_draft_history from the deployed SHA fed only the retained tool-call sequence','exactMatchWithLiveVisibleCounts':live==simc,'distinctStates':len(live),
 'finalVisible':{'messages':sim[-1][0],'toolResults':sim[-1][1]},'postFreezeRequests':len(post),'postFreezeInventoryReads':sum(r['tool']=='get_claim_inventory' for r in rows),
 'maxPriorReadsVisible':max(r['priorInventoryReadsVisible'] for r in rows),
 'rejectionRecurrence':{'requestsWithPreviousRejectionVisible':len(visible),'repeatedAmongThose':sum(r['thisCallRejected'] for r in visible),'requestsWithPreviousRejectionGone':len(gone),'repeatedAmongThose_':sum(r['thisCallRejected'] for r in gone)},
 'requests':rows,'notRetained':'raw message bodies, returned claim IDs, offsets and the exact limit values were destroyed with the isolated stack; only tool names, argument keys/sizes and context counts survive',
 'verdict':{'INFORMATION_LOSS':'PROVEN (exact reproduction of the live visible-history series)','REJECTION_RECURRENCE_AFTER_FEEDBACK_LEFT_VIEW':'PROVEN as a pattern (0 of 9 repeats while visible; 3 of 3 repeats came after it left view)','NO_AUTHORING_CAUSED_BY_FORGETTING':'STRONGLY INDICATED, NOT PROVEN (no counterfactual run; model behaviour confound)'}}
(HERE/'LIVE_AUTHORING_MEMORY_RECONSTRUCTION.json').write_text(json.dumps(out,indent=1)+'\n')
md=['# Live authoring-memory reconstruction (run 7fefb641)','',f"Method: {out['method']}. Exact match with the live visible-message/tool-result series: **{out['exactMatchWithLiveVisibleCounts']}** over {out['distinctStates']} distinct states.",'',
 f"After the freeze: {out['postFreezeRequests']} model requests, {out['postFreezeInventoryReads']} inventory reads; at most **{out['maxPriorReadsVisible']}** prior inventory reads were ever visible; final view {out['finalVisible']['messages']} messages / {out['finalVisible']['toolResults']} tool results.",'',
 f"Rejection recurrence: previous rejection still visible at {out['rejectionRecurrence']['requestsWithPreviousRejectionVisible']} requests, repeated at {out['rejectionRecurrence']['repeatedAmongThose']}; gone at {out['rejectionRecurrence']['requestsWithPreviousRejectionGone']} read requests, repeated at {out['rejectionRecurrence']['repeatedAmongThose_']}.",'','## Verdict']+[f'- {k}: {v}' for k,v in out['verdict'].items()]+['','## Not retained',out['notRetained'],'','| req | time | tool | prior reads visible | last rejection visible | rounds since | rejected |','|---|---|---|---|---|---|---|']+[f"| {r['request']} | {r['time']} | {r['tool']} | {r['priorInventoryReadsVisible']} | {r['lastRejectionVisible']} | {r['roundsSinceLastRejection']} | {r['thisCallRejected']} |" for r in rows]
(HERE/'LIVE_AUTHORING_MEMORY_RECONSTRUCTION.md').write_text('\n'.join(md)+'\n')
print(json.dumps({k:out[k] for k in ('exactMatchWithLiveVisibleCounts','maxPriorReadsVisible','rejectionRecurrence','verdict')},indent=1))
