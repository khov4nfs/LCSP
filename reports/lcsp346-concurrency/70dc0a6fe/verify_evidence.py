"""Check saved evidence only; no network, model, database or lifecycle mutations."""
import collections
import gzip
import datetime as dt
import json
from pathlib import Path
import xml.etree.ElementTree as ET

root=Path(__file__).resolve().parent
p=json.loads(gzip.decompress((root/'production-observation.json.gz').read_bytes()))
pr=json.loads((root/'pr-state.json').read_text())
ci=json.loads((root/'ci-run.json').read_text())
identity=json.loads((root/'implementation-identity.json').read_text())
browser=json.loads((root/'browser-isolation.json').read_text())
sha='70dc0a6fe40c618bdf47d532f9baa5230e52faf1'
assert p['head']==pr['headRefOid']==ci['head_sha']==identity['localHead']==sha
assert p['sandboxImage']['revision']==sha and not p['workingTree']
assert p['runtimeSourceHashes']==identity['sourceHashes']
assert all(p[k]==200 for k in ['apiHealth','agentHealth','webHealth'])
assert all(x['conclusion'] in ['SUCCESS','SKIPPED'] for x in pr['statusCheckRollup'])
events=[r['outputSummaryJson']['agentStreamEvent'] for r in p['runtimeEvents'] if r.get('outputSummaryJson',{}).get('agentStreamEvent')]
parse=lambda value:dt.datetime.fromisoformat(value.replace('Z','+00:00')).replace(tzinfo=dt.timezone.utc)
seconds=lambda start,end:round((parse(end)-parse(start)).total_seconds(),6)
cases=[]
for a in p['assessments']:
    aid=a['id'];es=[e for e in events if e['assessmentId']==aid]
    assert all(e['runId']==a['currentExecutionId'] and e['boundaryId']==aid and e['data'].get('runtimeRunId')==a['currentExecutionId'] for e in es)
    cps=[c for c in p['checkpoints'] if c['thread_id']==a['threadId']]
    assert cps and all(c['assessmentId']==aid and c['executionId']==a['currentExecutionId'] and c['snapshotId']==a['repositorySnapshotId'] and c['commit']==a['repositoryCommit'] for c in cps)
    assert a['checkpointId'] in {c['checkpoint_id'] for c in cps}
    assert sum(c['count'] for c in p['coverage'] if c['assessmentId']==aid)==243
    sandbox=next(s for s in p['sandboxes'] if s['assessmentId']==aid)
    marker=sandbox['repositoryMarker']
    assert marker['assessmentId']==aid and marker['snapshotId']==a['repositorySnapshotId'] and marker['commitSha']==a['repositoryCommit'] and marker['scanJobId']==a['repositoryScanJobId']
    assert sandbox['imageId']==p['sandboxImage']['id'] and sandbox['labels']['org.opencontainers.image.revision']==sha
    us=[u for u in p['usage'] if u['assessmentId']==aid]
    assert all(u['userId']==a['ownerId'] and u['runId']==a['currentExecutionId'] for u in us)
    assert len(us)==len({u['invocationId'] for u in us})
    settled=[u for u in us if u['status']=='SETTLED']
    assert all(u['inputTokens']+u['cachedInputTokens']+u['outputTokens']==u['totalTokens'] for u in settled)
    api=next(x for x in browser if x['assessment']==aid)
    assert api['usage']['invocationCount']==len(us) and api['runtime']['checkpointId']==a['checkpointId']
    assert all(r['status']==(200 if r['target']=='OWN' else 404) and not r['otherIdVisible'] for r in api['requests'])
    assert api['stream']['status']==200 and api['stream']['ownAssessmentVisible'] and not api['stream']['otherAssessmentVisible']
    for key in ['inputTokens','outputTokens','totalTokens']:assert sum(u[key] for u in settled)==api['usage'][key]
    start=next(e['emittedAt'] for e in es if e['eventType']=='BOUNDARY_STARTED')
    end=next(e['emittedAt'] for e in es if e['eventType']=='BOUNDARY_COMPLETED')
    first_model=next(e['emittedAt'] for e in es if e['eventType']=='MODEL_CALL_STARTED')
    outbox=next(x for x in p['outbox'] if x['aggregateId']==aid)
    transport=next(x['run'] for x in p['transportRuns'] if x['run']['metadata']['assessment_id']==aid)
    identities={k:sorted({e['data'][k] for e in es if e['data'].get(k)}) for k in ['model_step_id','logical_invocation_id','settlement_invocation_id']}
    identities.update({k:sorted({e[k] for e in es if e.get(k)}) for k in ['toolCallId','taskId']})
    cases.append({'assessment':a,'rootStartedAt':start,'rootEndedAt':end,'rootIntervalSeconds':seconds(start,end),'firstModelStartedAt':first_model,'rootCommand':outbox,'transport':transport,'publishedToTransportSeconds':seconds(outbox['publishedAt'],transport['created_at']),'publishedToLeaseSeconds':seconds(outbox['publishedAt'],a['startedAt']),'publishedToRootSeconds':seconds(outbox['publishedAt'],start),'publishedToFirstModelSeconds':seconds(outbox['publishedAt'],first_model),'brokerCallbackTimestamp':'NOT_CAPTURED','checkpointCount':len(cps),'sandbox':sandbox,'eventTypeCounts':dict(collections.Counter(e['eventType'] for e in es)),'identities':identities,'usageStatusCounts':dict(collections.Counter(u['status'] for u in us)),'tokens':{k:sum(u[k] for u in settled) for k in ['inputTokens','cachedInputTokens','outputTokens','reasoningTokens','totalTokens']}})
assert len({c['assessment']['ownerId'] for c in cases})==2
for key in cases[0]['identities']:assert not set(cases[0]['identities'][key]) & set(cases[1]['identities'][key])
usage_ids={u['invocationId'] for u in p['usage']}
delivered=[r for r in p['journalEvidence'] if r['kind']=='USAGE']
assert {r['payload']['invocationId'] for r in delivered}==usage_ids and all(r['state']=='DELIVERED' for r in delivered)
tests={}
for filename in ['fogewise-controlled-tests.xml','native-stop-isolation.xml']:
    suites=list(ET.parse(root/filename).getroot().iter('testsuite'))
    counts={k:sum(int(s.get(k,'0')) for s in suites) for k in ['tests','failures','errors','skipped']}
    assert counts['failures']==counts['errors']==counts['skipped']==0
    tests[filename]=counts
overlap_start=max(c['rootStartedAt'] for c in cases);overlap_end=min(c['rootEndedAt'] for c in cases)
overlap=seconds(overlap_start,overlap_end);assert overlap>0
result={'implementationSha':sha,'observedAt':p['observedAt'],'overlapStart':overlap_start,'overlapEnd':overlap_end,'overlapSeconds':overlap,'proof':'Persisted native Root events and checkpoint writes, not API labels or lease intervals','cases':cases,'physicalInvocations':len(usage_ids),'deliveredTransitionRows':len(delivered),'vpsProviderFreeTests':tests,'limitations':['Both workflows remain WAITING_FOR_HUMAN; no final report exists.','Production Stop/Continue has not run.','Paired live two-active UI screenshots were not captured.','No child researcher tasks occurred in these live runs.','Monetary records are UNPRICED with null reservations.','Published-to-transport includes broker and dispatch latency; broker callback timing was not captured.','Temporary local logs were lost; exact-head CI logs and durable VPS reports were recovered.']}
(root/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
base=parse('2026-10-28T18:00:30Z');x=lambda ts:180+(parse(ts)-base).total_seconds()*2.7
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="460" viewBox="0 0 1200 460">','<rect width="1200" height="460" fill="#f8fafc"/><g font-family="sans-serif" fill="#0f172a">','<text x="28" y="40" font-size="23">LCSP-346: persisted production Root execution</text>','<text x="28" y="68" font-size="14">Historical telemetry • Fogewise • 2026-10-28 UTC • implementation 70dc0a6fe</text>','<text x="28" y="93" font-size="13">Generated from recorded events. This is not a live application screenshot.</text>']
for offset in range(0,301,60):
    xx=180+offset*2.7;label=(base+dt.timedelta(seconds=offset)).strftime('%H:%M:%S')
    svg.extend([f'<line x1="{xx}" x2="{xx}" y1="130" y2="330" stroke="#cbd5e1"/>',f'<text x="{xx-28}" y="355" font-size="13">{label}</text>'])
svg.append(f'<rect x="{x(overlap_start)}" y="125" width="{overlap*2.7}" height="205" fill="#dcfce7" opacity="0.65"/>')
for i,c in enumerate(cases):
    yy=160+i*95;start,end=c['rootStartedAt'],c['rootEndedAt'];color=['#2563eb','#7c3aed'][i]
    svg.extend([f'<text x="28" y="{yy+20}" font-size="17">Account {chr(65+i)}</text>',f'<rect x="{x(start)}" y="{yy}" width="{seconds(start,end)*2.7}" height="32" rx="4" fill="{color}"/>',f'<text x="{x(start)}" y="{yy-10}" font-size="13">{start[11:23]} → {end[11:23]} (human interrupt)</text>'])
    for e in events:
        if e['assessmentId']==c['assessment']['id'] and e['eventType']=='MODEL_CALL_COMPLETED':svg.append(f'<circle cx="{x(e["emittedAt"])}" cy="{yy+16}" r="2" fill="white"/>')
svg.extend([f'<text x="28" y="398" font-size="19">Actual Root overlap: {overlap:.3f} seconds</text>','<text x="28" y="428" font-size="13">Dots: completed model steps. Distinct owners, executions, threads, pins and Docker sandboxes.</text>','</g></svg>'])
(root/'execution-timeline.svg').write_text('\n'.join(svg)+'\n')
print(json.dumps({'assertions':'PASS','overlapSeconds':overlap,'physicalInvocations':len(usage_ids),'vpsProviderFreeTests':tests}))
