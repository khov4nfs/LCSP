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

from langgraph.checkpoint.postgres import PostgresSaver
runtime=environments['runtime']
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'threadId':'c5c87467-678e-4199-8b49-422b2c0d9029','checkpointId':'1f1d346e-a13d-6052-8329-fc37f070ceb8'}
with connect(db_url(runtime.get('LANGGRAPH_CHECKPOINT_DATABASE_URL') or runtime['DATABASE_URL']),autocommit=True,row_factory=dict_row,prepare_threshold=0,options='-c default_transaction_read_only=on') as c:
 saver=PostgresSaver(c)
 saved=saver.get_tuple({'configurable':{'thread_id':result['threadId'],'checkpoint_ns':'','checkpoint_id':result['checkpointId']}})
 values=saved.checkpoint.get('channel_values',{})
 result['channelNames']=list(values)
 from assessment_root.agent import create_assessment_root_agent
 from assessment_root.tools import RootRun
 from deepagents.backends import FilesystemBackend
 import sys
 sys.path.insert(0,'/srv/apps/LCSP/deepagents/tests')
 from test_assessment_root_agent import FakeClient,RootScriptedModel
 client=FakeClient()
 run=RootRun(client=client,assessment_id='06ad978f-0ada-46f9-b648-e2c86aee37c1',thread_id=result['threadId'],execution_id='aca38bac-2091-4b24-8fc2-3a6de9f141d5',backend=FilesystemBackend(root_dir='/tmp/lcsp346-70dc0a6fe',virtual_mode=True))
 agent=create_assessment_root_agent(run=run,model=RootScriptedModel(responses=[]),checkpointer=saver,governance=(),graph_tools=[])
 snapshot=agent.get_state({'configurable':{'thread_id':result['threadId'],'checkpoint_ns':'','checkpoint_id':result['checkpointId']}})
 messages=snapshot.values.get('messages')
 result['nativeGraphStateReadOnly']=True
 result['fakeApiCalls']=len(client.calls)
 result['messageValueType']=type(messages).__name__
 result['metadata']={k:v for k,v in saved.metadata.items() if k in ['assessment_id','assessment_root_execution_id','case_revision','step']}
 if isinstance(messages,list):
  result['messageCount']=len(messages)
  result['contextToolResults']=[]
  result['toolActionNames']=[]
  for index,m in enumerate(messages):
   for call in getattr(m,'tool_calls',[]) or []:result['toolActionNames'].append({'index':index,'name':call.get('name'),'id':call.get('id')})
   if getattr(m,'type',None)=='tool':
    name=getattr(m,'name',None)
    if name in ['get_assessment_context','open_human_request','report_human_fact_unresolvable']:
     content=m.content if isinstance(m.content,str) else json.dumps(m.content,default=str)
     result['contextToolResults'].append({'index':index,'name':name,'toolCallId':m.tool_call_id,'contentSha256':hashlib.sha256(content.encode()).hexdigest(),'containsBenchmarkContext':'public third-party GitHub projects' in content,'containsUnknownOperator':'legal form: Unknown' in content,'containsDeploymentUnverified':'Actual live production deployment is unverified' in content,'containsNoActualVietnameseDataset':'No actual Vietnamese operational dataset' in content})
print(json.dumps(result,default=str,indent=2))
