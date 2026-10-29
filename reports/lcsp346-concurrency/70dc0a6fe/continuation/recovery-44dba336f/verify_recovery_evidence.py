"""Assert exact-build production isolation, checkpoint, broker and reference-cost evidence."""
import collections
import datetime as dt
from decimal import Decimal
import gzip,json
from pathlib import Path

base=Path(__file__).resolve().parent
if (base/'artifacts').is_dir():base=base/'artifacts'
def load(name):
    path=base/name
    return json.loads(path.read_bytes() if path.exists() else gzip.decompress((base/(name+'.gz')).read_bytes()))
snapshot=load('recovery-final-production-observation.json')
revision='44dba336f332d566d3fee9fc0d32642a402d024e'
ids={'A':'ecdf35c1-8487-4c3c-bd61-12666ee95ad7','B':'a7ae7cbe-59a8-4372-b5ff-fa2ab97c615f','C':'9e3cd276-d157-48fd-bf62-be4fa67de6cd'}
assessments={x['id']:x for x in snapshot['assessments']}
parse=lambda value:dt.datetime.fromisoformat(value.replace('Z','+00:00')).replace(tzinfo=dt.timezone.utc)
assert snapshot['head']==snapshot['sandboxImage']['revision']==revision and not snapshot['workingTree']
assert all(snapshot[key]==200 for key in ['apiHealth','agentHealth','webHealth'])
assert snapshot['liveLeaseCount']==0 and snapshot['migrationStatus']=={'total':136,'incomplete':0}
assert len({x['threadId'] for x in assessments.values()})==len({x['currentExecutionId'] for x in assessments.values()})==3
assert len({x['repositorySnapshotId'] for x in assessments.values()})==3
assert assessments[ids['A']]['ownerId']!=assessments[ids['B']]['ownerId']
assert not snapshot['decisions'] and not snapshot['artifacts']
assert all(a['leaseExpiresAt'] is None for a in assessments.values())
assert assessments[ids['A']]['lifecycleState']==assessments[ids['B']]['lifecycleState']=='WAITING_FOR_HUMAN'
assert assessments[ids['C']]['lifecycleState']=='PAUSED'
assert len({s['containerId'] for s in snapshot['sandboxes']})==3
assert all(s['imageId']==snapshot['sandboxImage']['id'] for s in snapshot['sandboxes'])
preflight=load('recovery-production-preflight-44dba33.json')
assert snapshot['preservedFileHashes']==preflight['preservedFileHashes']
effective=load('recovery-effective-runtime-identity.json')
assert effective['head']==revision
assert [effective[k] for k in ['boundaryWorkers','effectivePrefetch','agentServerCapacity']]==[2,2,2]
queued=load('recovery-two-roots-third-queued.json')
queue_states={a['id']:a for a in queued['assessments']}
assert queued['liveLeaseCount']==2 and queue_states[ids['C']]['currentExecutionId'] is None
assert queue_states[ids['C']]['executionState']=='QUEUED'
assert all(queue_states[ids[k]]['executionState']=='RUNNING' for k in ['A','B'])
handoff=load('recovery-after-slot-handoff.json')
assert handoff['liveLeaseCount']==2 and any('assessment_root_requested\t1\t2\t1' in line for line in handoff['brokerQueues'])
assert any('assessment_root_requested\t0\t0\t1' in line for line in snapshot['brokerQueues'])

events=[r['outputSummaryJson']['agentStreamEvent'] for r in snapshot['runtimeEvents'] if r.get('outputSummaryJson',{}).get('agentStreamEvent')]
assert len(events)==len({e['eventId'] for e in events})
turns=collections.defaultdict(list)
model_intervals=collections.defaultdict(list)
open_roots={};open_models={}
for event in sorted(events,key=lambda e:e['emittedAt']):
    aid=event['assessmentId'];kind=event['eventType'];at=event['emittedAt']
    assert event['runId']==assessments[aid]['currentExecutionId']
    if kind=='BOUNDARY_STARTED':
        assert aid not in open_roots
        open_roots[aid]=at
    if kind=='BOUNDARY_COMPLETED':
        turns[aid].append({'start':open_roots.pop(aid),'end':at})
    if kind=='MODEL_CALL_STARTED':
        key=event['data']['logical_invocation_id'];assert key not in open_models
        open_models[key]=(aid,at)
    if kind=='MODEL_CALL_COMPLETED':
        key=event['data']['logical_invocation_id'];owner,start=open_models.pop(key)
        assert owner==aid
        model_intervals[aid].append((parse(start),parse(at)))
assert not open_roots and not open_models
points=[(parse(t[k]),delta) for values in turns.values() for t in values for k,delta in [('start',1),('end',-1)]]
active=maximum=0
for _,delta in sorted(points):
    active+=delta;maximum=max(maximum,active)
assert maximum==2 and active==0
def overlaps(left,right):
    values=[]
    for start,end in left:
        for other_start,other_end in right:
            lo=max(start,other_start);hi=min(end,other_end)
            if hi>lo:values.append((lo,hi))
    merged=[]
    for lo,hi in sorted(values):
        if merged and lo<=merged[-1][1]:merged[-1]=(merged[-1][0],max(hi,merged[-1][1]))
        else:merged.append((lo,hi))
    return sum((hi-lo).total_seconds() for lo,hi in merged)
root_overlap=overlaps([(parse(t['start']),parse(t['end'])) for t in turns[ids['A']]],[(parse(t['start']),parse(t['end'])) for t in turns[ids['B']]])
model_overlap=overlaps(model_intervals[ids['A']],model_intervals[ids['B']])
assert root_overlap>0 and model_overlap>0
stop=load('recovery-stop-A-receipt.json')
paused_at=parse(stop['pausedAt'])
resumed_at=parse(turns[ids['A']][1]['start'])
assert stop['observerInvocationCountAfter']>stop['observerInvocationCountBefore']
assert stop['observerStateBefore']==stop['observerStateAfter']=='RUNNING'
assert stop['beforeDecisionIds']==stop['pausedDecisionIds']==[]
late=[e for e in snapshot['events'] if e['assessmentId']==ids['A'] and e['eventType'] in ['EVIDENCE_ACCEPTED','DECISION_ACCEPTED'] and paused_at<parse(e['timestamp'])<resumed_at]
assert not late
checkpoint_stop=stop['pausedCheckpointId'];a=assessments[ids['A']]
checkpoints={c['checkpoint_id']:c for c in snapshot['checkpoints'] if c['thread_id']==a['threadId'] and c['checkpoint_ns']==''}
ancestor=a['checkpointId'];ancestry=[]
while ancestor in checkpoints:
    ancestry.append(ancestor);ancestor=checkpoints[ancestor]['parent_checkpoint_id']
assert checkpoint_stop in ancestry
for checkpoint in snapshot['checkpoints']:
    owner=assessments[checkpoint['assessmentId']]
    assert checkpoint['thread_id']==owner['threadId'] and checkpoint['executionId']==owner['currentExecutionId']
    assert checkpoint['snapshotId']==owner['repositorySnapshotId'] and checkpoint['commit']==owner['repositoryCommit']

usage=snapshot['usage'];physical={u['invocationId'] for u in usage}
assert len(physical)==len(usage)==65
costs=collections.defaultdict(lambda:Decimal(0));totals={}
for label,aid in ids.items():
    records=[u for u in usage if u['assessmentId']==aid];settled=[u for u in records if u['status']=='SETTLED']
    totals[label]={'physicalAttempts':len(records),'settled':len(settled),'unavailable':len(records)-len(settled),
        **{key:sum(int(u[key] or 0) for u in settled) for key in ['inputTokens','cachedInputTokens','outputTokens','reasoningTokens','totalTokens']}}
    for record in records:
        assert record['userId']==assessments[aid]['ownerId'] and record['runId']==assessments[aid]['currentExecutionId']
        price=record['referenceCostSnapshot'];assert price['priceVersionId']=='inception:mercury-3:launch:2026-10-29'
        if record['status']=='SETTLED':
            assert int(record['inputTokensIncludingCache'])==int(record['inputTokens'])+int(record['cachedInputTokens'])
            assert int(record['totalTokens'])==int(record['inputTokensIncludingCache'])+int(record['outputTokens'])
            assert int(record['reasoningTokens'])<=int(record['outputTokens'])
            assert int(record['cacheWriteTokens'] or 0)==0
            expected=(Decimal(record['inputTokens'])*Decimal('0.10')+Decimal(record['cachedInputTokens'])*Decimal('0.01')+Decimal(record['outputTokens'])*Decimal('0.35'))/Decimal(1_000_000)
            assert price['status']=='COMPLETE' and Decimal(price['estimatedCostUsd'])==expected
            assert int(price['knownCostAttodollars'])==int(expected*10**18)
            costs[label]+=expected
        else:
            assert record['status']=='UNAVAILABLE' and record['attemptStatus']=='FAILED'
            assert price['status']=='UNKNOWN' and price['estimatedCostUsd'] is None and price['missingCategories']
    totals[label]['knownReferenceCostUsd']=str(costs[label])
    totals[label]['referenceCostCompleteness']='PARTIAL' if len(settled)!=len(records) else 'COMPLETE'
delivered=[r for r in snapshot['journalEvidence'] if r['kind']=='USAGE']
assert len(delivered)==130 and all(r['state']=='DELIVERED' for r in delivered)
assert {r['payload']['invocationId'] for r in delivered}==physical
assert all(count==2 for count in collections.Counter(r['payload']['invocationId'] for r in delivered).values())
fallbacks=[e for e in events if e['eventType']=='MODEL_CALL_COMPLETED' and e['data'].get('fallback_used')]
assert len(fallbacks)==1 and fallbacks[0]['data']['provider_attempts']==2
assert len([e for e in events if e['eventType']=='MODEL_CALL_COMPLETED'])==64
for payload in load('recovery-native-unknown-answer-receipts.json')['cases']:
    assert payload['beforeCaseRevision']==payload['afterCaseRevision']
    assert all(r['result']['factId'] is None and r['result']['status']=='OPEN' and not r['result']['resumed'] for r in payload['submitted'])
unknown=load('recovery-new-A-unknown-receipt.json')['result']
assert unknown['caseRevision']==0 and unknown['factId'] is None and not unknown['resumed']
browser=load('recovery-preserved-report-and-browser-timeline.json')
assert browser['artifact']['sha256']=='b1a8fe7b01371c8c42b97f74f2b09f7402b4b6f42882de9e18421a6c8dc8fdd9'
assert browser['artifact']['findingCount']==243 and browser['crossAccountDownloadStatus']==404
for stream in browser['streams']:
    assert stream['status']==200 and stream['foreignStatus']==404
    aid=stream['id']
    assert all(e['assessmentId']==aid and e['threadId']==assessments[aid]['threadId'] for e in stream['events'])
ci=load('recovery-44dba33-check-runs.json')
assert ci['total_count']==len(ci['check_runs'])==36
assert all(c['head_sha']==revision and c['status']=='completed' and c['conclusion']=='success' for c in ci['check_runs'])
customer=load('recovery-customer-usage-totals.json')
for label,aid in ids.items():
    observed=next(x for x in customer['cases'] if x['id']==aid)
    assert observed['usage']['invocationCount']==totals[label]['physicalAttempts']
    for key in ['inputTokens','outputTokens','totalTokens']:
        assert observed['usage'][key]==totals[label][key]
    assert observed['usage']['partial']==(totals[label]['unavailable']>0)
result={'implementationSha':revision,'observedAt':snapshot['observedAt'],'maximumActualRoots':maximum,'rootOverlapSeconds':round(root_overlap,3),'actualLogicalModelOverlapSeconds':round(model_overlap,3),'rootTurns':dict(turns),'canonicalStoppedCheckpointInFinalAncestry':True,'lateAcceptedWritesWhilePaused':0,'physicalAttempts':65,'logicalModelCalls':64,'successfulAttempts':64,'failedAttemptsWithUnknownUsage':1,'usageCallbackTransitionsDelivered':130,'usageByAccount':totals,'knownReferenceCostUsd':str(sum(costs.values())),'overallReferenceCostCompleteness':'PARTIAL: one failed provider attempt supplies no usage; its price and route are known, its cost is unknown','pricingScope':'OFFICIAL_MODEL_PRICING reference estimate, not provider invoice or customer wallet charge','boundedFallbackAttempts':2,'crossAccountTimelineDenials':[x['foreignStatus'] for x in browser['streams']],'freshReports':0,'freshAcceptedDecisions':0,'productionBenchmarkDisposition':'A/B valid native human waits with unresolved operational facts; C deliberately paused after capacity admission proof','reportLifecycleDisposition':'Provider-free real API/DB/Root report contracts pass and existing production report preserved; fresh production report generation remains unexecuted'}
(base/'recovery-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
