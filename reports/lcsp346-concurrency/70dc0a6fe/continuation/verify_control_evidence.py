"""Verify recorded control/isolation evidence; retain the semantic failure explicitly."""
import collections
import datetime as dt
import gzip
import json
from pathlib import Path

root=Path(__file__).resolve().parent
load=lambda name:json.loads((root/name).read_text())
p=json.loads(gzip.decompress((root/'final-production-observation.json.gz').read_bytes()))
parse=lambda text:dt.datetime.fromisoformat(text.replace('Z','+00:00')).replace(tzinfo=dt.timezone.utc)
sha='70dc0a6fe40c618bdf47d532f9baa5230e52faf1'
assert p['head']==p['sandboxImage']['revision']==sha and not p['workingTree']
assert all(p[k]==200 for k in ['apiHealth','agentHealth','webHealth'])
exit_health=load('exit-health.json')
assert exit_health['head']==sha and not exit_health['workingTree'] and all(exit_health[k]==200 for k in ['apiHealth','agentHealth','webHealth'])
report=load('observed-report-contract.json')
metadata=load('completed-artifact-metadata.json')
assert report['artifact']['status']==200 and report['crossAccountDownloadStatus']==404
assert report['artifact']['sha256']==metadata['artifact']['contentSha256'] and report['artifact']['sizeBytes']==metadata['artifact']['sizeBytes']
assert report['artifact']['assessmentId']==metadata['assessment'] and report['artifact']['findingCount']==report['reportFindingElements']==243
assert report['artifact']['pins']['repositoryCommit']==metadata['artifact']['repositoryCommit']
assert load('actual-model-overlap.json')['actualModelCallOverlapSeconds']>0
ci=load('implementation-head-checks.json')
assert ci['total_count']==len(ci['checks']) and all(x['head_sha']==sha and x['status']=='completed' and x['conclusion'] in ['success','skipped'] for x in ci['checks'])
latest=load('question-current-status.json')
assert latest['head']==sha and not latest['workingTree'] and latest['activeLeaseCount']==0
states={x['id']:(x['lifecycleState'],x['executionState']) for x in latest['assessments']}
assert states['db6266b2-4e16-4ced-8595-7ffe9e33f3ab']==('WAITING_FOR_HUMAN','INTERRUPTED')
assert states['ce1d9e22-5460-4a16-b53f-d646a942478d']==('COMPLETE','SUCCEEDED')
assert states['bcf4d105-1f2a-48c9-8251-1197d34d38f1']==('WAITING_FOR_HUMAN','INTERRUPTED')
assert any('assessment_root_requested\t0\t0\t1' in x for x in latest['brokerQueues'])
ids={'A':'db6266b2-4e16-4ced-8595-7ffe9e33f3ab','B':'06ad978f-0ada-46f9-b648-e2c86aee37c1'}
stopcp={'A':'1f1d3468-5abd-6e9c-81c2-f311b14fe3f1','B':'1f1d346e-a13d-6052-8329-fc37f070ceb8'}
es=[r['outputSummaryJson']['agentStreamEvent'] for r in p['runtimeEvents'] if r.get('outputSummaryJson',{}).get('agentStreamEvent')]
summary=[]
for label,aid in ids.items():
    a=next(x for x in p['assessments'] if x['id']==aid)
    cp={x['checkpoint_id']:x for x in p['checkpoints'] if x['thread_id']==a['threadId'] and x['checkpoint_ns']==''}
    assert stopcp[label] in cp
    current=a['checkpointId'];ancestors=[]
    while current and current in cp:
        ancestors.append(current);current=cp[current]['parent_checkpoint_id']
    assert stopcp[label] in ancestors, 'Final checkpoint must descend from the exact stopped checkpoint'
    assert all(x['assessmentId']==aid and x['executionId']==a['currentExecutionId'] and x['snapshotId']==a['repositorySnapshotId'] and x['commit']==a['repositoryCommit'] for x in cp.values())
    events=[x for x in p['events'] if x['assessmentId']==aid]
    paused=next(x for x in events if x['eventType']=='EXECUTION_STATE_CHANGED' and x['payload'].get('toState')=='PAUSED')
    resumed=next(x for x in events if x['eventType']=='EXECUTION_STATE_CHANGED' and x['payload'].get('toState')=='RUNNING' and parse(x['timestamp'])>parse(paused['timestamp']))
    late=[x for x in events if x['eventType'] in ['EVIDENCE_ACCEPTED','DECISION_ACCEPTED'] and parse(paused['timestamp'])<parse(x['timestamp'])<parse(resumed['timestamp'])]
    assert not late, 'No governed findings may enter during the paused interval'
    usage=[x for x in p['usage'] if x['assessmentId']==aid]
    assert len(usage)==len({x['invocationId'] for x in usage})
    assert all(x['userId']==a['ownerId'] and x['runId']==a['currentExecutionId'] for x in usage)
    settled=[x for x in usage if x['status']=='SETTLED']
    assert all(x['inputTokens']+x['cachedInputTokens']+x['outputTokens']==x['totalTokens'] for x in settled)
    turns=[];start=None
    for e in [x for x in es if x['assessmentId']==aid]:
        if e['eventType']=='BOUNDARY_STARTED':start=e['emittedAt']
        if e['eventType']=='BOUNDARY_COMPLETED':
            assert start
            turns.append({'start':start,'end':e['emittedAt']});start=None
    assert len(turns)==3
    summary.append({'account':label,'assessment':a,'stoppedCheckpoint':stopcp[label],'stopAcknowledgedAt':paused['timestamp'],'actualResumedAt':resumed['timestamp'],'pausedIntervalGovernedWrites':len(late),'stopCheckpointInFinalAncestry':True,'rootTurns':turns,'usageCount':len(usage),'usageStates':dict(collections.Counter(x['status'] for x in usage)),'tokens':{k:sum(x[k] for x in settled) for k in ['inputTokens','cachedInputTokens','outputTokens','reasoningTokens','totalTokens']}})
sb=load('production-stop-b.json');assert sb['observer']['progressObserved']
assert sb['observer']['before']['runtime']['currentExecutionId']==sb['observer']['after']['runtime']['currentExecutionId']
assert sb['observer']['before']['runtime']['executionState']==sb['observer']['after']['runtime']['executionState']=='RUNNING'
assert sb['observer']['owner']!=next(a['ownerId'] for a in p['assessments'] if a['id']==ids['B'])
assert sb['before']['decisionIds']==sb['paused']['decisionIds']
assert len([x for x in p['usage'] if x['assessmentId']==ids['B']])==sb['paused']['usage']['invocationCount']==41
assert set(sb['paused']['decisionIds'])=={d['decisionId'] for d in p['decisions'] if d['assessmentId']==ids['B'] and d['state']=='ACCEPTED'}
unknown=load('a-operational-unknowns-preserved.json')
assert unknown['beforeCaseRevision']==unknown['afterCaseRevision']==6
assert len(unknown['submitted'])==4 and all(x['result']['factId'] is None and not x['result']['resumed'] and x['result']['status']=='OPEN' for x in unknown['submitted'])
audit=load('b-native-checkpoint-context-audit.json')
assert audit['nativeGraphStateReadOnly'] and audit['fakeApiCalls']==0
fresh=[x for x in audit['contextToolResults'] if x['containsBenchmarkContext'] and x['containsUnknownOperator'] and x['containsDeploymentUnverified'] and x['containsNoActualVietnameseDataset']]
assert fresh and max(x['index'] for x in fresh)<min(x['index'] for x in audit['toolActionNames'] if x['index']>max(t['index'] for t in fresh) and x['name']=='submit_rule_decision')
assert all(x['identical'] for x in load('governance-baseline-identity.json')['comparisons'])
accepted=[d for d in p['decisions'] if d['assessmentId']==ids['B'] and d['state']=='ACCEPTED']
assert len(accepted)==6 and all(d['applicability']=='APPLICABLE' for d in accepted)
assert not p['artifacts']
physical={u['invocationId'] for u in p['usage']}
delivered=[x for x in p['journalEvidence'] if x['kind']=='USAGE']
assert {x['payload']['invocationId'] for x in delivered}==physical and all(x['state']=='DELIVERED' for x in delivered)
result={'implementationSha':sha,'observedAt':p['observedAt'],'controlAndIsolation':'PASS','crossAccountStopObserver':'PASS','canonicalStopCheckpointRestoration':'PASS','lateGovernedWritesWhilePaused':0,'acceptedDecisionsReplayedAfterStopB':0,'extraProviderCallsAfterContinueB':0,'physicalInvocations':len(physical),'journalDeliveredTransitions':len(delivered),'tokenAttribution':'PASS','monetaryBilling':'BLOCKED: existing UNPRICED route and null reservations','semanticAcceptance':'FAIL: six renewed applicability decisions infer an actual controller from repository capabilities despite visible unknown operational context','completedBenchmarkReports':0,'cases':summary,'limitations':['Stop A was issued while the untouched grading Root was active; credit Root B acquired the freed slot after A paused.','Direct cross-account Stop proof uses credit Root B against the untouched Account A grading Root.','The first A harness wait timed out at 20 seconds; later native/API evidence proves its PAUSED outcome without a second Stop.','Unknown operational facts remain open or blocked; no final benchmark report is claimed.']}
(root/'control-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['cases','limitations']}))
