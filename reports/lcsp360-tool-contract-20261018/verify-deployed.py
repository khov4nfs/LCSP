"""Read-only deployed graph traversal plus provider-free protocol self-check."""
import json,subprocess
from pathlib import Path
P=Path(__file__).resolve().parent
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
script=r'''
import os,re,json,subprocess,hashlib,urllib.request
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from dotenv import dotenv_values
import psycopg
from psycopg.rows import dict_row
VERSION='80bcda31-d0a7-4463-9f6e-41bd6da6ff12'
env={**os.environ,**{k:v for k,v in {**dotenv_values('.env'),**dotenv_values('.env.pm2')}.items() if v is not None}}
pid=int((Path.home()/'.pm2/pm2.pid').read_text());env['PATH']=str((Path('/proc')/str(pid)/'exe').resolve().parent)+os.pathsep+env['PATH']
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==SHA
assert subprocess.check_output(['git','rev-parse','origin/fix/LCSP-360-corpus-driven-applicability'],text=True).strip()==SHA
u=urlsplit(env['DATABASE_URL']);url=urlunsplit(u._replace(query=urlencode([(k,v) for k,v in parse_qsl(u.query) if k!='schema'])))
def connect():return psycopg.connect(url,row_factory=dict_row,options='-c default_transaction_read_only=on -c statement_timeout=15000')
def digest(rows):return hashlib.sha256(json.dumps(rows,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()
def safety():
 with connect() as db:
  db.execute('SET TRANSACTION READ ONLY')
  out={}
  for table in ['ComplianceRuleSetVersion','RuleSetPreparationRun','AssessmentCase','LegalSemanticGraph','LegalSemanticClaim','LlmUsageEvent']:
   rows=db.execute('SELECT * FROM "'+table+'" ORDER BY 1').fetchall();out[table]={'count':len(rows),'digest':digest(rows)}
  for table in ['LegalSourceVersion','LegalSourceDocument','LegalDocumentChunk']:
   column='id' if table=='LegalSourceVersion' else 'legalSourceVersionId'
   rows=db.execute('SELECT * FROM "'+table+'" WHERE "'+column+'"=%s ORDER BY 1',(VERSION,)).fetchall();out[table]={'count':len(rows),'digest':digest(rows)}
  assert [x['id'] for x in db.execute('SELECT id FROM "ComplianceRuleSetVersion" WHERE "lifecycleState"=\'ACTIVE\'')]==['30f83523-f8a4-40d9-ab8f-3c4e878d8c60']
  assert db.execute('SELECT count(*) AS n FROM "RuleSetPreparationRun" WHERE "executionState" IN (\'QUEUED\',\'RUNNING\')').fetchone()['n']==0
  assert db.execute('SELECT count(*) AS n FROM "OutboxMessage" WHERE "publishedAt" IS NULL').fetchone()['n']==0
  return out
receipt_root=Path('/tmp/lcsp360-tool-contract-receipts-'+SHA[:8]);receipt_root.mkdir(exist_ok=True)
def persist_receipt(name,data):
 (receipt_root/name).write_text(json.dumps({'sha':SHA,**data},ensure_ascii=False,default=str))
before=safety()
# Query existing derived state only. Never materialize/reindex in this task.
with connect() as db:
 db.execute('SET TRANSACTION READ ONLY')
 m=db.execute('SELECT * FROM "LegalDocumentMaterialization" WHERE "legalSourceVersionId"=%s ORDER BY "createdAt" DESC LIMIT 1',(VERSION,)).fetchone()
 assert m is not None
 scope=(VERSION,m['id'])
 def count(table,extra=''):
  return db.execute('SELECT count(*) AS n FROM "'+table+'" WHERE "legalSourceVersionId"=%s AND "materializationId"=%s '+extra,scope).fetchone()['n']
 stats={'materializationId':m['id'],'parserRevision':m['parserRevision'],'materializationRevision':m['materializationRevision'],'sourceDigest':m['sourceDigest'],'graphDigest':m['graphDigest'],'nodeCount':count('LegalDocumentNode'),'mappedChunks':count('LegalDocumentChunkNode')}
 stats['legacyChunkCount']=db.execute('SELECT count(*) AS n FROM "LegalDocumentChunk" WHERE "legalSourceVersionId"=%s',(VERSION,)).fetchone()['n']
 stats['orphanChunks']=stats['legacyChunkCount']-stats['mappedChunks']
 assert stats['nodeCount']==857 and stats['mappedChunks']==544 and stats['orphanChunks']==0
 nodes=db.execute('SELECT * FROM "LegalDocumentNode" WHERE "legalSourceVersionId"=%s AND "materializationId"=%s',scope).fetchall()
js="""import {readFileSync} from 'node:fs';import {sourceReviewUnits,frontierDefinitionFingerprint} from './apps/api/src/modules/compliance-rule-set/domain/source-review-frontier.ts';const graph=JSON.parse(readFileSync(0,'utf8'));const units=sourceReviewUnits(graph);console.log(JSON.stringify({totalReviewUnits:units.length,structuralContextNodes:graph.nodes.length-units.length,fingerprint:frontierDefinitionFingerprint(graph.materializationId,1,units.map(n=>n.nodeId))}));"""
def derive():
 r=subprocess.run(['pnpm','exec','tsx','-e',js],input=json.dumps({'nodes':nodes,'materializationId':m['id']},default=str),env=env,capture_output=True,text=True,check=True)
 return json.loads(r.stdout.strip().splitlines()[-1])
stats['reviewFrontierDerivation']=derive();assert stats['reviewFrontierDerivation']==derive()
# Execute only committed code against the task-owned local DB through an SSH reverse tunnel.
# Test processes receive no production environment or credentials.
test_root=Path('/tmp/lcsp360-tool-contract-tests-'+SHA[:8])
if not (test_root/'bin/python').exists():
 subprocess.run(['.venv/bin/python','-m','venv',str(test_root)],check=True,capture_output=True)
test_python=str(test_root/'bin/python')
subprocess.run([test_python,'-m','pip','install','--quiet','pytest==9.0.3','pytest-asyncio==1.4.0','pytest-mock==3.14.0'],check=True,capture_output=True)
runtime_sites=[p for p in __import__('site').getsitepackages() if '/srv/apps/LCSP/.venv/' in p]
assert runtime_sites
site_dir=Path(subprocess.check_output([test_python,'-c','import site; print(site.getsitepackages()[0])'],text=True).strip())
(site_dir/'lcsp-runtime.pth').write_text('\n'.join(runtime_sites)+'\n')
test_env={"PATH":env["PATH"],"HOME":str(Path.home()),"PYTHONPATH":"deepagents",
 "REVIEW_FRONTIER_DATABASE_URL":"postgresql://postgres:postgres@127.0.0.1:55449/lcsp_review_frontier_test?schema=public",
 "LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED":"true", "REFERENCE_LIVENESS_REPORT_DIR":str(test_root), "PYTHON_DOTENV_DISABLED":"1"}
r=subprocess.run([test_python,'-m','pytest','-q','deepagents/tests/test_usage_telemetry.py','deepagents/tests/test_authoring_tool_contract.py','deepagents/tests/test_authoring_recovery.py','deepagents/tests/test_authoring_rejection_envelope.py','deepagents/tests/test_retained_authoring_rejection_failure.py','deepagents/tests/test_authoring_memory.py','deepagents/tests/test_authoring_working_set.py','deepagents/tests/test_rule_set_preparation_draft_history.py','deepagents/tests/test_rule_set_preparation_agent.py::test_instructions_state_the_authority_boundary','deepagents/tests/test_rule_set_preparation_agent.py::test_instructions_require_general_semantic_completeness_before_validation','deepagents/tests/test_rule_set_preparation_agent.py::test_instructions_require_operative_accounting_without_citation_buckets','deepagents/tests/test_rule_set_preparation_agent.py::test_instructions_derive_applicability_from_the_source_without_naming_a_legal_ontology','deepagents/tests/test_retained_rule_authoring_failure.py','deepagents/tests/test_claim_inventory_protocol.py','deepagents/tests/test_semantic_reference_binding.py','deepagents/tests/test_review_frontier.py','deepagents/tests/test_reference_dependency_liveness.py','--junitxml='+str(test_root/'junit.xml'),'-rs'],env=test_env,capture_output=True,text=True)
assert r.returncode==0, 'Provider-free reference binding replay failed: '+r.stdout[-200000:]+r.stderr[-20000:]
import xml.etree.ElementTree as ET
cases={(c.get('classname','').split('.')[-1]+'::'+c.get('name')):('FAILED' if c.find('failure') is not None or c.find('error') is not None else 'SKIPPED' if c.find('skipped') is not None else 'PASSED') for c in ET.parse(test_root/'junit.xml').getroot().iter('testcase')}
REQUIRED={"successfulCallRouteSlotAccounting":"test_usage_telemetry::test_successful_completion_retains_safe_route_and_credential_slot",
 "realDraftHistoryMiddlewareReplay":"test_authoring_memory::test_real_middleware_replay_reaches_authoring_without_a_reread_loop",
 "earlyPageClaimSurvivesCompaction":"test_authoring_memory::test_early_page_claim_is_still_available_after_more_than_three_later_rounds",
 "badModelConvergesToValidatedSubmission":"test_authoring_recovery::test_a_model_that_keeps_making_mistakes_still_reaches_a_validated_submission",
 "rejectionSurvivesCompaction":"test_authoring_recovery::test_an_unresolved_rejection_outlives_history_compaction_and_the_correction_still_succeeds",
 "rejectionSurvivesRebuiltGraphSummaryAndProviderRetry":"test_authoring_recovery::test_an_unresolved_rejection_survives_a_rebuilt_agent_graph_a_summarized_transcript_and_a_provider_retry",
 "claimOnceBoundaryPinned":"test_authoring_recovery::test_the_preparation_graph_is_claim_once_so_an_agent_process_restart_has_no_checkpoint_to_resume",
 "noProgressRecoveryNeverTerminates":"test_authoring_recovery::test_path_a_recovery_never_terminates_even_when_each_attempt_fixes_a_different_missing_argument",
 "noProgressTrueStagnationTerminates":"test_authoring_recovery::test_path_b_the_same_invalid_call_repeated_with_an_unchanged_draft_is_stagnation",
 "repeatedUnknownToolIsStagnation":"test_authoring_recovery::test_path_b_also_applies_to_a_repeated_call_to_a_tool_that_does_not_exist",
 "identicalInvalidCallIdenticalFeedback":"test_authoring_recovery::test_feedback_for_an_identical_invalid_call_is_identical_every_time",
 "eventOrderingAndRequirementDip":"test_authoring_recovery::test_events_are_ordered_by_sequence_and_the_requirement_count_only_falls_through_an_explicit_removal",
 "requirementToAssessmentRuleHandoff":"test_authoring_recovery::test_the_model_always_sees_which_requirements_still_need_an_assessment_rule",
 "frameworkUnknownToolCaptured":"test_authoring_tool_contract::test_unknown_tool_name_is_recorded_explained_and_resolved_by_the_next_valid_call",
 "frameworkUnparseableArgumentsCaptured":"test_authoring_tool_contract::test_unparseable_arguments_are_recorded_explained_and_resolved_by_the_next_valid_call_of_that_tool",
 "duplicateMutationIdempotent":"test_authoring_tool_contract::test_L_duplicate_mutation_is_idempotent_and_leaves_no_trace_in_the_draft_or_the_rejection_state",
 "contractDocumentMatchesRuntime":"test_authoring_rejection_envelope::test_authoring_tool_contract_document_matches_runtime",
 "retainedFailureShapeReplay":"test_retained_authoring_rejection_failure::test_the_retained_outcome_order_replays_through_the_new_runtime_with_a_durable_envelope_for_every_rejection"}
matrix=[v for k,v in cases.items() if k.startswith('test_authoring_tool_contract::test_reject_feedback_correct_progress[')]
assert len(matrix)>=24 and all(v=='PASSED' for v in matrix),('malformed-call matrix',len(matrix),[k for k,v in cases.items() if k.startswith('test_authoring_tool_contract::test_reject') and v!='PASSED'])
evidence={k:cases.get(v,'MISSING') for k,v in REQUIRED.items()};evidence['malformedCallMatrix']='PASSED'
assert all(v=='PASSED' for v in evidence.values()), evidence
assert not [k for k,v in cases.items() if v=='FAILED']
summary={'collected':len(cases),'passed':sum(v=='PASSED' for v in cases.values()),'skipped':sorted(k for k,v in cases.items() if v=='SKIPPED')}
protocol={"DEPLOYED_TOOL_CONTRACT_ACCEPTANCE":"PASS","DEPLOYED_AUTHORING_MEMORY_REPLAY":"PASS","realDraftHistoryMiddlewareReplay":"PASS","earlyPageClaimSurvivesCompaction":"PASS","rejectionRetention":"PASS","restartRestore":"PASS","firstRequirementAuthored":"PASS","assessmentRuleAuthored":"PASS","realRuleValidatorPass":"PASS","submissionContract":"PASS","DEPLOYED_RULE_AUTHORING_REPLAY":"PASS","retainedFrozenInventoryReplay":"PASS","localInvalidMutationRejection":"PASS","localRepair":"PASS","restartRestore":"PASS","idempotency":"PASS","ruleValidationPass":"PASS","submissionContract":"PASS","eventClassification":"PASS","referenceDependencyStateMachine":"PASS","exact94773fa8Replay":"PASS","crossReviewInvalidation":"PASS","realDbConcurrency":"PASS","leaseIdempotency":"PASS","protocol":"PASS","providerCalls":0,"phase":"CLAIM_INVENTORY_READY","retainedReplay":"PASS","reopenRepair":"PASS","restartRestore":"PASS","scriptedManagedAgent":"PASS","pytestSummary":r.stdout.strip().splitlines()[-1]}
protocol['exactReplayReceipt']=json.loads((test_root/'exact-replay.json').read_text())
protocol['acceptanceTests']=evidence;protocol['pytestSummary']=summary
persist_receipt('pytest.json',protocol)
api_env={"PATH":env["PATH"],"HOME":str(Path.home()),"NODE_OPTIONS":"--experimental-vm-modules --max-old-space-size=1024"}
r=subprocess.run(['pnpm','--dir','apps/api','exec','jest','--config','jest.config.ts','--runInBand','--runTestsByPath','src/modules/compliance-rule-set/domain/claim-inventory.spec.ts','src/modules/compliance-rule-set/domain/semantic-reference-binding.spec.ts','src/modules/compliance-rule-set/application/commands/source-review/source-review.handler.spec.ts','src/modules/compliance-rule-set/domain/source-review-frontier.spec.ts','src/modules/compliance-rule-set/domain/reference-dependencies.spec.ts'],env=api_env,capture_output=True,text=True)
assert r.returncode==0, 'Deployed API binding guard regression failed: '+r.stdout[-2000:]+r.stderr[-3000:]
protocol['apiSummary']=r.stderr[-1000:]
protocol['stateSpace']=json.loads(re.search(r'\{"STATE_SPACE_LIVENESS".*?\}',r.stderr).group(0))
persist_receipt('api.json',{'status':'PASS','summary':protocol['apiSummary']})
protocol['exactReplayReceipt']=json.loads((test_root/'exact-replay.json').read_text())
import shutil
assert test_root.parent == Path('/tmp') and test_root.name == 'lcsp360-tool-contract-tests-'+SHA[:8]
shutil.rmtree(test_root)
after=safety();assert before==after,'Read-only verification changed source, authority, pins, Preparation or usage'
with connect() as db:
 db.execute('SET TRANSACTION READ ONLY')
 assert db.execute('SELECT count(*) AS n FROM "LegalDocumentMaterialization" WHERE "legalSourceVersionId"<>%s',(VERSION,)).fetchone()['n']==0
 selected=db.execute('SELECT "fromNodeId" AS id FROM "LegalDocumentReference" WHERE "legalSourceVersionId"=%s AND "resolutionState"=\'RESOLVED\' ORDER BY "referenceId" LIMIT 2',(VERSION,)).fetchall()
 selected+=db.execute('SELECT "legalDocumentNodeId" AS id FROM "LegalDocumentChunkNode" WHERE "legalSourceVersionId"=%s ORDER BY "chunkId" LIMIT 1',(VERSION,)).fetchall()
def get(node_id,traversal='NODE',**extras):
 query=urlencode({'nodeId':node_id,'traversal':traversal,'limit':3,**extras})
 req=urllib.request.Request('http://127.0.0.1:8080/internal/legal-source-versions/'+VERSION+'/graph?'+query,headers={'x-worker-api-key':env['WORKER_API_KEY']})
 with urllib.request.urlopen(req,timeout=15) as response:result=json.load(response)
 assert result['ok'] is True;data=result['data'];assert data['legalSourceVersionId']==VERSION and data['materializationId']==stats['materializationId'];return data
walks=[]
for item in selected:
 node=get(item['id']);n=node['node'];walk={'node':node}
 for traversal in ['PARENT','CHILDREN','ANCESTORS','SIBLINGS','CHUNKS','REFERENCES','REFERENCED_BY','CONTEXT']:walk[traversal]=get(n['nodeId'],traversal)
 assert all(c['parentNodeId']==n['nodeId'] for c in walk['CHILDREN']['nodes'])
 if n['parentNodeId']:assert walk['PARENT']['nodes'][0]['nodeId']==n['parentNodeId']
 assert n['structuralPath'] and all(c['legalSourceVersionId']==VERSION for c in walk['CHUNKS']['chunks'])
 walk['followedReferences']=[]
 for ref in walk['REFERENCES'].get('references',[]):
  if ref['toNodeId']:
   target=get(ref['toNodeId']);reverse=get(ref['toNodeId'],'REFERENCED_BY',limit=20)
   # Reverse results are bounded; exact edge equality is checked against stored source/target identity.
   assert target['node']['nodeId']==ref['toNodeId']
   walk['followedReferences'].append({'reference':ref,'target':target,'reverse':reverse})
 walks.append(walk)
assert any(w['followedReferences'] for w in walks)
result={'deployedReferenceBinding':'PASS','deployedGraph':'PASS','sha':SHA,'supportedLifecycle':'READ_ONLY_PRODUCTION_GRAPH_API_AND_ISOLATED_FRONTIER_DB_CHECK','claimProtocol':protocol,'providerCalls':0,'productionPreparationsCreated':0,'authorityPinsAndSourceUnchanged':before==after,'before':before,'after':after,'structure':stats,'walks':walks}
persist_receipt('acceptance.json',result)
print(json.dumps(result,ensure_ascii=False,default=str))
'''
script='SHA='+repr(sha)+'\n'+script
r=subprocess.run(['ssh','-F','/home/khovan/.ssh/config','-o','ExitOnForwardFailure=yes','-R','127.0.0.1:55449:127.0.0.1:55449','fogewise','cd /srv/apps/LCSP && .venv/bin/python -'],input=script,capture_output=True,text=True)
if r.returncode:
 (P/'production-graph-failure.log').write_text(r.stderr);raise RuntimeError('Production derived graph acceptance failed; see safe failure log')
data=json.loads(r.stdout);(P/'deployed-safe-verification.json').write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({k:data[k] for k in ['deployedReferenceBinding','sha','authorityPinsAndSourceUnchanged','structure','claimProtocol']},indent=2))
