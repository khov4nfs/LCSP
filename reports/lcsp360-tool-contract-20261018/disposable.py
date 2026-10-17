"""Single live semantic acceptance; reuse repository-owned isolated Docker primitives."""
import hashlib,importlib.util,json,os,re,secrets,shutil,stat,subprocess,sys,time
from datetime import datetime,timezone
from pathlib import Path
from uuid import uuid4
from dotenv import dotenv_values

REPORT=Path(__file__).resolve().parent
ROOT=REPORT.parents[1]
SHA=json.loads((REPORT/'disposable-images.json').read_text())['sha']
spec=importlib.util.spec_from_file_location('stack',ROOT/'tests/staging-stack.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
from runtime_limits import apply
apply(h)
def save(name,value):
 (REPORT/name).write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
def emit(value):print(json.dumps(value,ensure_ascii=False),flush=True)
def now():return datetime.now(timezone.utc).isoformat()
def read(s,query,database='lcsp_staging'):
 assert query.lstrip().startswith('SELECT ')
 return s.sql('BEGIN READ ONLY;\n'+query+'\nCOMMIT;',database).splitlines()[1:-1]
def scalar(s,query,database='lcsp_staging'):
 rows=read(s,query,database);assert len(rows)==1;return rows[0]
def rows(s,table,database='lcsp_staging'):
 assert re.fullmatch('[A-Za-z_]+',table)
 return json.loads(scalar(s,'SELECT COALESCE(jsonb_agg(t),\'[]\'::jsonb) FROM "'+table+'" t;',database))
def bootstrap(s,control):
 for name in ['tests/legal-graph-source.mjs','tests/fixtures/legal-graph/source.json','tests/fixtures/legal-graph/source.pdf']:
  assert (ROOT/name).read_bytes()==subprocess.check_output(['git','show',SHA+':'+name],cwd=ROOT)
 if control['mode']=='input':
  control['originalBase64']=__import__('base64').b64encode((ROOT/'tests/fixtures/legal-graph/source.pdf').read_bytes()).decode()
  output=s.docker('exec','-i','--workdir','/app/deepagents',s.prefix+'-server','python','-c',"import sys,json;from tools.legal.managed_documents.ingest import ingest_document;print(json.dumps(ingest_document(data=__import__('base64').b64decode(sys.stdin.read()),media_type='application/pdf',structure_profile='ARTICLES',attempt=1)))",input=control['originalBase64'])
  control['ingestion']=json.loads(output)
 source='const control='+json.dumps(control)+';\n'+(ROOT/'tests/legal-graph-source.mjs').read_text()
 output=s.docker('exec','-i','--workdir','/app/apps/api',s.prefix+'-api','node','--input-type=module',input=source)
 result=[json.loads(line) for line in output.splitlines() if line.startswith('{')][-1]
 return result
def load():
 identity=json.loads((REPORT/'disposable-run.json').read_text());s=h.Stack(identity['runId'])
 s.manifest=h.json_file(s.private/'stack.json');return s
def snapshot(s):
 data={'capturedAt':now(),'readOnly':True}
 for table in ['LegalDocumentMaterialization','LegalDocumentNode','LegalDocumentReference','LegalDocumentRetrievalUnit','LegalDocumentChunkNode','LegalSemanticGraph','LegalSemanticClaim','LegalSemanticClaimSource','LegalSemanticClaimRelation','LegalRequirementClaimBinding','LegalDocumentChunk','LegalSourceVersion','LegalSourceDocument','RuleSetPreparationRun','RuleSetPreparationReviewFrontier','RuleSetPreparationSourceReview','RuleSetPreparationClaimInventory','ComplianceRuleSetVersion','LegalRequirement','AssessmentRule','LegalRequirementContextRelation','LegalRequirementProvenance','ComplianceRuleSetActivationRecord','AssessmentRuntimeEvent','LlmUsageEvent']:
  data[table]=rows(s,table)
 data['unpublishedOutbox']=json.loads(scalar(s,'SELECT COALESCE(jsonb_agg(t),\'[]\'::jsonb) FROM (SELECT id,"aggregateType","eventType","createdAt" FROM "OutboxMessage" WHERE "publishedAt" IS NULL) t;'))
 data['nativeRuns']=json.loads(scalar(s,"SELECT COALESCE(jsonb_agg(value->'run'),'[]'::jsonb) FROM store WHERE prefix LIKE 'lcsp-agent-runtime-runs.%';",'lcsp_langgraph'))
 data['checkpoints']=json.loads(scalar(s,"SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM (SELECT thread_id,checkpoint_ns,checkpoint_id,parent_checkpoint_id FROM checkpoints) t;",'lcsp_langgraph'))
 save('disposable-observation.json',data)
 return data

action=sys.argv[1]
try:
 if action=='setup':
  assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==SHA
  images=json.loads((REPORT/'disposable-images.json').read_text());assert images['sha']==SHA
  deployed=json.loads((REPORT/'production-deployment.json').read_text());assert deployed['deployment']=='PASS' and deployed['sha']==SHA and all(v=='PASS' for v in json.loads((REPORT/'DISPOSABLE_GATE_RECEIPT.json').read_text())['gates'].values())
  run_id=secrets.token_hex(8)
  with (REPORT/'disposable-run.json').open('x') as f:json.dump({'runId':run_id,'sha':SHA,'createdAt':now()},f)
  s=h.Stack(run_id);s.private.mkdir(parents=True,mode=0o700,exist_ok=False);s.private.chmod(0o700);s.evidence.mkdir(parents=True,exist_ok=False)
  (s.private/'commands.log').touch(mode=0o600)
  endpoint=s.host_env.get('DOCKER_HOST') or s.docker('context','inspect','--format','{{.Endpoints.docker.Host}}')
  assert endpoint.startswith('unix://') and stat.S_ISSOCK(Path(endpoint[7:]).stat().st_mode)
  infrastructure={}
  for role,tag in [('postgres','postgres:16'),('rabbitmq','rabbitmq:3.13-management')]:
   infrastructure[role]=json.loads(s.docker('image','inspect',tag))[0]['Id']
  for role,iid in images['images'].items():
   info=json.loads(s.docker('image','inspect',iid))[0];assert info['Config']['Labels']['org.opencontainers.image.revision']==SHA
  s.manifest={'runId':run_id,'daemonId':s.docker('info','--format','{{.ID}}'),'network':s.prefix,'images':{**images['images'],**infrastructure,'bridge':images['images']['worker']},'baselineContainers':s.docker('ps','-aq','--no-trunc').split(),'resources':{},'candidateSha':SHA}
  s.save();s.docker('network','create','--label',h.OWNER_LABEL+'='+run_id,s.prefix)
  provider=h.provider_credentials(os.environ,dotenv_values(ROOT/'.env'))
  envs=h.environment(run_id,images['images'],provider)
  # Acceptance-only route policy (never production defaults): the SET of routes is narrowed, routing/fallback/rotation/metering stay the governed ones.
  decision=json.loads((REPORT/'ACCEPTANCE_ROUTES.json').read_text());routes_file=REPORT/'acceptance-model-routes.yaml'
  assert decision['decision']=='READY' and routes_file.exists() and hashlib.sha256(routes_file.read_bytes()).hexdigest()==decision['file']['sha256'],'LIVE_ACCEPTANCE_PROVIDER_ROUTE is not READY'
  for role in ('server','bridge'):envs[role]['LCSP_MODEL_ROUTES_FILE']='/app/tmp/acceptance-model-routes.yaml'
  assert all(s.prefix+'-postgres' in envs[role]['DATABASE_URL'] for role in ['api','server','bridge'])
  h.write_json(s.private/'runtime-envs.json',envs,private=True)
  s.create('postgres',envs['postgres'],port=5432)
  s.wait('postgres',lambda:s.docker('exec',s.prefix+'-postgres','pg_isready','-U','postgres') is not None,target='pg_isready')
  assert scalar(s,"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")=='0'
  s.docker('exec',s.prefix+'-postgres','createdb','-U','postgres','lcsp_langgraph')
  s.create('rabbitmq',envs['rabbitmq'])
  s.wait('rabbitmq',lambda:s.docker('exec','--user','rabbitmq',s.prefix+'-rabbitmq','rabbitmq-diagnostics','-q','ping') is not None,target='broker readiness')
  mounts={}
  for name,target in [('legal_source','/app/.legal-source'),('chroma','/app/.chroma'),('runtime','/app/tmp'),('artifacts','/app/.artifacts'),('snapshot-cache','/app/.snapshot-cache')]:
   p=s.private/name;p.mkdir(mode=0o700);mounts[name]=(str(p),target)
  shutil.copyfile(routes_file,s.private/'runtime'/'acceptance-model-routes.yaml')
  s.create('server',envs['server'],port=8000,mounts=[mounts[n] for n in ['legal_source','chroma','runtime']]+[(endpoint[7:],'/var/run/docker.sock')])
  server=s.url('server',8000);s.wait('server',lambda:h.http_ok(server+'/health'),target='/health')
  assert s.docker('exec',s.prefix+'-server','docker','info','--format','{{.ID}}')==s.manifest['daemonId']
  s.create('api',envs['api'],port=8080,mounts=list(mounts.values()))
  api=s.url('api',8080);s.wait('api',lambda:h.http_ok(api+'/health'),target='/health',seconds=240)
  for t in ['RuleSetPreparationRun','RuleSetPreparationReviewFrontier','RuleSetPreparationSourceReview','RuleSetPreparationClaimInventory','ComplianceRuleSetVersion','AssessmentCase']:
   assert scalar(s,'SELECT count(*) FROM "'+t+'";')=='0'
  count=scalar(s,'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')
  contract=bootstrap(s,{'mode':'input','runId':run_id,'legalSource':json.loads((ROOT/'tests/fixtures/legal-graph/source.json').read_text()),'correlationId':str(uuid4())})
  assert contract['LEGAL_GRAPH_INPUT_CONTRACT']=='PASS' and contract['orphanChunks']==0 and all(s.prefix+'-postgres' in envs[role]['DATABASE_URL'] for role in ['api','server','bridge']) and contract['preparations']==0
  save('disposable-input.json',contract)
  receipt={'status':'READY','runId':run_id,'sha':SHA,'migrations':int(count),'api':api,'agentServer':server,'web':'NOT_REQUIRED_HEADLESS_APPLICATION_LIFECYCLE','input':contract,'isolation':{'network':s.prefix,'databaseHost':s.prefix+'-postgres','databaseName':'lcsp_staging','productionConnection':False,'source':'committed Git archive','providerKeysNotPrinted':True},'preparations':0}
  save('disposable-readiness.json',receipt);emit(receipt)
 elif action=='run':
  cycle=json.loads((REPORT/'disposable-cycle-preflight.json').read_text());assert cycle['FIXTURE_RESOLVED_CYCLE']=='PASS' and cycle['sha']==SHA
  assert all(v=='PASS' for v in json.loads((REPORT/'DISPOSABLE_GATE_RECEIPT.json').read_text())['gates'].values())
  deployed=json.loads((REPORT/'deployed-safe-verification.json').read_text());assert deployed['sha']==SHA and deployed['claimProtocol']['protocol']=='PASS'
  decision=json.loads((REPORT/'ACCEPTANCE_ROUTES.json').read_text());readiness=json.loads((REPORT/'PROVIDER_READINESS_final.json').read_text())
  age=(datetime.now(timezone.utc)-datetime.strptime(readiness['probedAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)).total_seconds()
  assert decision['decision']=='READY' and decision['probedAt']==readiness['probedAt'] and age<2700,f'provider readiness is not READY or is stale ({int(age)}s old); the single live allowance stays unused'
  assert hashlib.sha256((REPORT/'acceptance-model-routes.yaml').read_bytes()).hexdigest()==decision['file']['sha256']
  s=load();ready=json.loads((REPORT/'disposable-readiness.json').read_text());assert ready['status']=='READY' and ready['sha']==SHA
  assert scalar(s,'SELECT count(*) FROM "RuleSetPreparationRun";')=='0'
  envs=h.json_file(s.private/'runtime-envs.json')
  for role in ['api','server','bridge']:
   assert s.prefix+'-postgres:5432/lcsp_staging' in envs[role]['DATABASE_URL']
  contract=json.loads((REPORT/'disposable-input.json').read_text())
  subprocess.run([sys.executable,str(REPORT/'verify-disposable-network.py')],check=True,stdout=subprocess.DEVNULL)
  assert json.loads((REPORT/'disposable-network-probes.json').read_text())['outcome']=='PASS'
  with (REPORT/'live-preparation-dispatch-reserved.json').open('x') as f:json.dump({'reservedAt':now(),'runId':s.run_id,'sourceVersionId':contract['versionId'],'maximumPreparations':1},f)
  result=bootstrap(s,{'mode':'activate','runId':s.run_id,'versionId':contract['versionId'],'legalSource':json.loads((ROOT/'tests/fixtures/legal-graph/source.json').read_text()),'correlationId':contract['correlationId']})
  save('disposable-dispatch.json',{'dispatchedAt':now(),'result':result,'calls':1})
  mounts=[(str(s.private/n),target) for n,target in [('legal_source','/app/.legal-source'),('chroma','/app/.chroma'),('runtime','/app/tmp'),('runtime','/app/deepagents/tmp')]]
  if 'bridge' not in s.manifest['resources']:s.create('bridge',envs['bridge'],mounts=mounts)
  emit({'dispatchedExactlyOnce':True,'versionId':contract['versionId'],'correlationId':contract['correlationId']})
 elif action=='observe':
  s=load();data=snapshot(s)
  emit({'capturedAt':data['capturedAt'],'preparations':data['RuleSetPreparationRun'],'rulesets':data['ComplianceRuleSetVersion'],'runtimeEventCount':len(data['AssessmentRuntimeEvent']),'usageRows':len(data['LlmUsageEvent']),'unpublished':len(data['unpublishedOutbox'])})
 elif action=='stop':
  s=load();data=snapshot(s);assert len(data['RuleSetPreparationRun'])<=1
  assert not any(p['executionState'] in ['QUEUED','RUNNING'] for p in data['RuleSetPreparationRun'])
  save('disposable-manifest-safe.json',s.manifest)
  result=s.stop();private=s.private.resolve();assert private.parent==(ROOT/'tmp/staging').resolve() and private.name==s.run_id
  shutil.rmtree(private);result['temporaryCredentialFilesRemoved']=True;save('disposable-teardown.json',result);emit(result)
 else:raise AssertionError('Unknown action')
except Exception as error:
 emit({'action':action,'status':'FAILED','errorType':type(error).__name__,'detail':'Raw output withheld; inspect safe harness operation state','operation':getattr(locals().get('s'),'failure_context',None)})
 raise SystemExit(1)
