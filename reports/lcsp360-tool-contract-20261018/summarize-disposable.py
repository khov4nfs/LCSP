"""Reconcile retained safe events; never invokes a provider or mutates runtime state."""
import json
from collections import Counter
from pathlib import Path
p=Path(__file__).resolve().parent
d=json.loads((p/'disposable-observation.json').read_text())
events=[e['outputSummaryJson']['agentStreamEvent'] for e in d['AssessmentRuntimeEvent'] if (e.get('outputSummaryJson') or {}).get('agentStreamEvent')]
assert len({e['eventId'] for e in events})==len(events)
starts=[e['data'] for e in events if e['eventType']=='MODEL_CALL_STARTED']
done=[e['data'] for e in events if e['eventType']=='MODEL_CALL_COMPLETED']
failed=[e['data'] for e in events if e['eventType'] in ['MODEL_CALL_FAILED','MODEL_CALL_TIMEOUT','MODEL_CALL_CANCELLED']]
attempts=[e['data'] for e in events if e.get('data',{}).get('activity_kind')=='MODEL_PROVIDER_ATTEMPT_FAILED']
by_id={x['invocation_id']:x for x in starts};terminal=done+failed
def usage(items):
 return {'usageBearing':sum(isinstance(x.get('usage'),dict) for x in items),**{target:sum((x.get('usage') or {}).get(key,0) for x in items) for target,key in [('inputTokens','input_tokens'),('outputTokens','output_tokens'),('knownTotalTokens','total_tokens')]},**{target:sum((x.get('usage') or {}).get('details',{}).get(key,0) for x in items) for target,key in [('cacheReadTokens','cache_read'),('cacheWriteTokens','cache_creation')]}}
missing=[x for x in starts+terminal+attempts if not x.get('invocation_id') or not x.get('model_step_id')]
orphans=[x.get('invocation_id') for x in terminal+attempts if x.get('invocation_id') not in by_id]
mismatches=[x['invocation_id'] for x in terminal+attempts if x.get('invocation_id') in by_id and x.get('model_step_id')!=by_id[x['invocation_id']]['model_step_id']]
inflight=sorted(set(by_id)-{x.get('invocation_id') for x in terminal})
summary_ids={x['invocation_id'] for x in starts if x.get('operation_type')=='SUMMARIZATION'}
summary=[x for x in terminal if x['invocation_id'] in summary_ids]
routes={}
for provider,model in sorted({(x['provider'],x['model']) for x in done}):
 calls=[x for x in done if (x['provider'],x['model'])==(provider,model)]
 routes[provider+'/'+model]={'completions':len(calls),**usage(calls)}
tools=[e for e in events if e['eventType']=='SEMANTIC_TOOL_CALL']
validations=[e for e in events if e.get('data',{}).get('activity_kind')=='VALIDATION_RESULT']
report={'capturedAt':d['capturedAt'],'state':d['RuleSetPreparationRun'][0]['executionState'],'model':{'logicalCalls':len(starts),'logicalCompletions':len({x['invocation_id'] for x in done}),'completionEventRows':len(done),'duplicateCompletionInvocationIds':[k for k,n in Counter(x['invocation_id'] for x in done).items() if n>1],'logicalFailures':len(failed),'observedPhysicalProviderAttempts':len(done)+len(attempts),'reportedCumulativeAttemptCounterSum':sum(x.get('provider_attempts',0) for x in terminal),'failedProviderAttempts':len(attempts),'fallbackCalls':len({x['invocation_id'] for x in terminal if x.get('fallback_used') is True}),'summarizationCalls':len(summary_ids),'summarizationUsage':usage(summary),'usage':usage(done),'routes':routes,'missingIdentity':len(missing),'orphanedInvocationIds':orphans,'modelStepMismatches':mismatches,'inflight':inflight,'customerLlmUsageRows':len(d['LlmUsageEvent']),'safeProviderFailures':attempts},'agent':{'toolCounts':dict(Counter(e['data'].get('native_tool') or e['data'].get('tool_name') for e in tools)),'sourceReadPaths':[e['data']['source_path'] for e in tools if e['data'].get('native_tool')=='read_file' and 'source_path' in e['data']],'activityCounts':dict(Counter(e.get('data',{}).get('activity_kind') for e in events if e.get('data',{}).get('activity_kind'))),'eventCounts':dict(Counter(e['eventType'] for e in events))},'nativeRuns':d['nativeRuns'],'checkpoints':d['checkpoints']}
report['model']['accounting']='IN_PROGRESS' if inflight else 'PARTIAL' if attempts or usage(done)['usageBearing']!=len(done) or missing or orphans or mismatches else 'COMPLETE'
report['model']['accountingLimit']='Failed provider attempts do not report token consumption; no estimates added' if attempts else None
report['model']['completionTelemetryLimit']=None if not report['model']['duplicateCompletionInvocationIds'] else 'Multiple completion receipts share a logical ID; retain distinct provider response usage and do not sum cumulative attempt counters without reconciliation.'
(p/'disposable-summary.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['nativeRuns','checkpoints']},indent=2))
