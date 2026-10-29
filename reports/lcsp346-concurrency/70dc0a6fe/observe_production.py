"""Read-only, secret-allowlisted LCSP-346 evidence recovery; never invokes a Root."""
import datetime
import hashlib
import json
import pathlib
import sqlite3
import subprocess
import urllib.parse
import urllib.request
from psycopg import connect
from psycopg.rows import dict_row

ROOT=pathlib.Path('/srv/apps/LCSP')
IDS=['db6266b2-4e16-4ced-8595-7ffe9e33f3ab','06ad978f-0ada-46f9-b648-e2c86aee37c1']
OWNERS=dict(zip(IDS,['2e723a25-b79c-4aac-a094-5771f3fbc590','d3f2f078-78f1-4480-8a8d-9e134a356da1']))
environments={}
processes=[]
for path in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
    try:
        args=path.read_bytes().decode().split('\0')
        role='api' if args[:2]==['node','apps/api/dist/src/main.js'] else 'runtime' if args[1:3]==['-m','tools.common.capabilities.agent_runtime.local_server'] else 'bridge' if args[1:3]==['-m','tools.common.capabilities.agent_runtime.rabbitmq_consumer'] else None
        if role:
            env=dict(item.split('=',1) for item in path.with_name('environ').read_bytes().decode().split('\0') if '=' in item)
            environments[role]=env
            processes.append({'role':role,'pid':int(path.parent.name),'settings':{k:v for k,v in env.items() if k in ['PORT','LCSP_AGENT_RUNTIME_MODE','LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS','LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH','LCSP_AGENT_RUNTIME_JOBS_PER_WORKER']}})
    except (FileNotFoundError,ProcessLookupError):
        pass
assert {'api','runtime','bridge'} <= environments.keys()
def command(args):
    r=subprocess.run(args,capture_output=True,text=True,timeout=40)
    assert r.returncode==0, (args[0],r.returncode)
    return r.stdout.strip()
def db_url(value):
    u=urllib.parse.urlsplit(value)
    return u._replace(query=urllib.parse.urlencode([(k,v) for k,v in urllib.parse.parse_qsl(u.query) if k!='schema'])).geturl()
SAFE={'eventType','event_type','kind','status','phase','state','labelKey','actorType','boundary','boundaryType','boundaryName','toolName','source','emittedAt','namespace','data','agentStreamEvent','semanticPayloads','toState','fromState','toStatus','fromStatus','caseRevision','decisionRevision','timestamp','occurredAt','startedAt','completedAt','durationMs','duration_ms','inputTokens','outputTokens','cachedInputTokens','cacheWriteTokens','totalTokens','input_tokens','output_tokens','total_tokens','sequence','provider','model','agent_role','protocol','usage','details','reasoning','cache_read','fallback_used','route_ordinal','operation_type','provider_attempts','credential_attempts','attempt_ordinal','http_status','error_class','failureClass','provider_error_code','retryability','fallback_eligibility'}
def safe(v):
    if isinstance(v,dict):return {k:safe(x) for k,x in v.items() if k in SAFE or k.endswith(('Id','_id','Ids','_ids'))}
    if isinstance(v,list):return [safe(x) for x in v]
    return v
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':command(['git','-C',str(ROOT),'rev-parse','HEAD']),'branch':command(['git','-C',str(ROOT),'branch','--show-current']),'workingTree':command(['git','-C',str(ROOT),'status','--porcelain']),'processes':processes,'preservedFileHashes':{k:hashlib.sha256((ROOT/k).read_bytes()).hexdigest() for k in ['.env.pm2','ecosystem.config.cjs']}}
with connect(db_url(environments['api']['DATABASE_URL']),row_factory=dict_row) as c:
    c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    result['assessments']=c.execute('''SELECT a.id,a."ownerId",a.name,a."createdAt",a."lifecycleState",a."lifecycleRevision",r."threadId",r."currentExecutionId",r."executionState",r."checkpointId",r."leaseExpiresAt",r."startedAt",r."lastResumedAt",s."ruleSetVersionId",s."repositorySnapshotId",s."repositoryScanJobId",s."repositoryCommit",s."caseRevision" FROM "Assessment" a JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id JOIN "AssessmentCase" s ON s."assessmentId"=a.id WHERE a.id=ANY(%s)''',(IDS,)).fetchall()
    assert len(result['assessments'])==2 and all(a['ownerId']==OWNERS[a['id']] for a in result['assessments'])
    queries={
      'coverage':'SELECT "assessmentId","resolutionState",count(*) AS count FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=ANY(%s) GROUP BY "assessmentId","resolutionState"',
      'decisions':'SELECT "assessmentId","decisionId","assessmentRuleId","decisionRevision",state,applicability,compliance,"caseRevision","repositoryCommit","createdAt" FROM "AssessmentRuleDecision" WHERE "assessmentId"=ANY(%s) ORDER BY "createdAt"',
      'evidence':'SELECT "assessmentId",type,state,count(*) AS count FROM "AssessmentEvidence" WHERE "assessmentId"=ANY(%s) GROUP BY "assessmentId",type,state',
      'humanRequests':'SELECT "assessmentId","requestId","threadId",status,"caseRevision","assessmentRuleId","requestRevision","checkpointId","createdAt","resolvedAt" FROM "AssessmentHumanRequest" WHERE "assessmentId"=ANY(%s) ORDER BY "createdAt"',
      'artifacts':'SELECT "assessmentId","artifactId",kind,"lifecycleState","ruleSetVersionId","repositorySnapshotId","repositoryCommit","caseRevision","contentSha256","sizeBytes","createdAt","activatedAt" FROM "AssessmentArtifact" WHERE "assessmentId"=ANY(%s)',
      'events':'SELECT "eventId","assessmentId","threadId",sequence,timestamp,"eventType","actorType","executionId","parentExecutionId","taskId","toolCallId",payload FROM "AssessmentEvent" WHERE "assessmentId"=ANY(%s) ORDER BY "assessmentId",sequence',
      'runtimeEvents':'SELECT id,"assessmentId","runId",sequence,"toolName","outputSummaryJson","createdAt" FROM "AssessmentRuntimeEvent" WHERE "assessmentId"=ANY(%s) ORDER BY "createdAt"',
      'usage':'SELECT id,"assessmentId","userId","runId","invocationId",provider,model,"agentRole",status,"availabilityReason","attemptStatus","failureClass","inputTokens","inputTokensIncludingCache","cachedInputTokens","cacheWriteTokens","outputTokens","reasoningTokens","totalTokens","chargedCredits","customerChargeVnd","pricingSnapshotId","reservationId","runtimePolicySnapshotId","providerCostCredits","referenceCostSnapshot","occurredAt","createdAt" FROM "LlmUsageEvent" WHERE "assessmentId"=ANY(%s) ORDER BY "createdAt"',
      'outbox':'SELECT id,"aggregateId","eventType",status,attempts,"createdAt","publishedAt" FROM "OutboxMessage" WHERE "aggregateId"=ANY(%s) AND "eventType"=\'command.assessment.root.requested.v1\' ORDER BY "createdAt"',
      'snapshots':'SELECT id,"assessmentId","repositoryFullName",branch,ref,"commitSha",status,"createdAt" FROM "RepositorySnapshot" WHERE "assessmentId"=ANY(%s)'}
    for k,sql in queries.items():result[k]=c.execute(sql,(IDS,)).fetchall()
    for row in result['events']:row['payload']=safe(row['payload'])
    for row in result['runtimeEvents']:row['outputSummaryJson']=safe(row['outputSummaryJson'])
    assert all(u['userId']==OWNERS[u['assessmentId']] for u in result['usage'])
    result['migrationStatus']=c.execute('SELECT count(*) AS total,count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS incomplete FROM _prisma_migrations').fetchone()
    result['liveLeaseCount']=c.execute('SELECT count(*) AS count FROM "AssessmentRuntime" WHERE "leaseExpiresAt">now()').fetchone()['count']
runtime=environments['runtime']
with connect(db_url(runtime.get('LANGGRAPH_CHECKPOINT_DATABASE_URL') or runtime['DATABASE_URL']),row_factory=dict_row) as c:
    c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    threads=[str(a['threadId']) for a in result['assessments']]
    result['checkpoints']=c.execute('''SELECT thread_id,checkpoint_ns,checkpoint_id,parent_checkpoint_id,metadata->>'assessment_id' AS "assessmentId",metadata->>'assessment_root_execution_id' AS "executionId",metadata->>'repository_snapshot_id' AS "snapshotId",metadata->>'repository_commit' AS commit,metadata->>'step' AS step,checkpoint->>'ts' AS timestamp FROM checkpoints WHERE thread_id=ANY(%s) ORDER BY checkpoint_id''',(threads,)).fetchall()
    result['transportRuns']=c.execute("SELECT key,value->'run' AS run FROM store WHERE value->'run'->'metadata'->>'assessment_id'=ANY(%s)",(IDS,)).fetchall()
result['sandboxes']=[]
for a in result['assessments']:
    digest=hashlib.sha256(str(a['threadId']).encode()).hexdigest();name='lcsp-repository-sandbox-'+digest[:24]
    r=subprocess.run(['docker','inspect',name],capture_output=True,text=True)
    if r.returncode:result['sandboxes'].append({'assessmentId':a['id'],'name':name,'state':'NOT_PRESENT_AT_RECOVERY'});continue
    info=json.loads(r.stdout)[0]
    marker=json.loads(command(['docker','exec',name,'cat','/workspace/repository/.lcsp/repository.json']))
    assert info['Config']['Labels']['lcsp.thread-id']==digest and marker['assessmentId']==a['id']
    result['sandboxes'].append({'assessmentId':a['id'],'threadId':a['threadId'],'name':name,'containerId':info['Id'],'imageId':info['Image'],'createdAt':info['Created'],'state':info['State']['Status'],'labels':{k:v for k,v in info['Config']['Labels'].items() if k.startswith('lcsp.') or k=='org.opencontainers.image.revision'},'memoryBytes':info['HostConfig']['Memory'],'mountTargets':[x['Destination'] for x in info['Mounts']],'repositoryMarker':{k:marker[k] for k in ['assessmentId','snapshotId','scanJobId','commitSha','role']}})
journal=pathlib.Path(runtime.get('USAGE_RECOVERY_STORE_PATH') or str(ROOT/'tmp/lcsp-storage/usage-recovery.sqlite3'))
if not journal.is_absolute():journal=ROOT/journal
result['journalEvidence']=[]
with sqlite3.connect(journal.as_uri()+'?mode=ro',uri=True) as db:
    for rowid,kind,state,raw in db.execute('SELECT id,kind,state,payload FROM usage_recovery WHERE payload LIKE ? OR payload LIKE ?',tuple('%'+x+'%' for x in IDS)):
        payload=json.loads(raw);keys={'event','assessmentId','runId','invocationId','agentRole','provider','model','attemptStatus','failureClass','occurredAt','inputTokens','inputTokensIncludingCache','cachedInputTokens','cacheWriteTokens','outputTokens','totalTokens','reasoningTokens','availabilityReason'}
        result['journalEvidence'].append({'id':rowid,'kind':kind,'state':state,'payload':{k:v for k,v in payload.items() if k in keys}})
for label,url in [('api','http://127.0.0.1:8080/health'),('agent','http://127.0.0.1:2024/ok'),('web','http://127.0.0.1:3002/')]:
    with urllib.request.urlopen(url,timeout=10) as response:result[label+'Health']=response.status
result['runtimeSourceHashes']={k:hashlib.sha256((ROOT/k).read_bytes()).hexdigest() for k in ['deepagents/assessment_root/agent.py','deepagents/assessment_root/instructions.md','deepagents/tools/common/capabilities/agent_runtime/rabbitmq_consumer.py','deepagents/tools/common/capabilities/agent_runtime/local_server.py']}
result['sandboxImage']=json.loads(command(['docker','image','inspect','lcsp-agent-runtime:production-sandbox','--format','{"id":{{json .Id}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}']))
broker=urllib.parse.urlsplit(runtime['RABBITMQ_URL']);vhost=urllib.parse.unquote(broker.path[1:]) or '/'
result['brokerVhost']=vhost
result['brokerConsumers']=[line for line in command(['docker','exec','fogewise-rabbitmq','rabbitmqctl','list_consumers','-p',vhost,'queue_name','channel_pid','consumer_tag','ack_required','prefetch_count','active']).splitlines() if 'assessment_root_requested' in line]
result['brokerChannels']=[line for line in command(['docker','exec','fogewise-rabbitmq','rabbitmqctl','list_channels','vhost','pid','consumer_count','messages_unacknowledged','prefetch_count']).splitlines() if vhost in line]
result['brokerQueues']=[line for line in command(['docker','exec','fogewise-rabbitmq','rabbitmqctl','list_queues','-p',vhost,'name','messages_ready','messages_unacknowledged','consumers']).splitlines() if 'assessment_root_requested' in line]
result['memory']=command(['free','-m']);result['disk']=command(['df','-h',str(ROOT)])
encoded=json.dumps(result,default=lambda x:x.isoformat() if hasattr(x,'isoformat') else str(x),indent=2)
for env in environments.values():
    for key,value in env.items():
        if len(value)>8 and any(s in key.upper() for s in ['PASSWORD','TOKEN','API_KEY','DATABASE_URL','RABBITMQ_URL']):assert value not in encoded,key
print(encoded)
