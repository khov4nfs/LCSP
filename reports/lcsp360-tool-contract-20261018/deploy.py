"""Authorized Git-first API + Agent deployment; no Preparation/authority command."""
import json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
script=r'''
import os,json,subprocess,time,urllib.request
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from dotenv import dotenv_values
import psycopg
from psycopg.rows import dict_row
OLD='8f0b2519c5d6b607104b0ea314ee3e8a37f3a604'
NEW=EXPECTED_NEW
env={**os.environ,**{k:v for k,v in {**dotenv_values('.env'),**dotenv_values('.env.pm2')}.items() if v is not None}}
pid=int((Path.home()/'.pm2/pm2.pid').read_text().strip());env['PATH']=str((Path('/proc')/str(pid)/'exe').resolve().parent)+os.pathsep+env['PATH']
def run(args):return subprocess.check_output(args,env=env,text=True).strip()
assert run(['git','branch','--show-current'])=='fix/LCSP-360-corpus-driven-applicability'
assert run(['git','rev-parse','HEAD']) in [OLD,NEW]
assert not run(['git','status','--short','--untracked-files=no'])
def connect(url):
 u=urlsplit(url);return psycopg.connect(urlunsplit(u._replace(query=urlencode([(k,v) for k,v in parse_qsl(u.query) if k!='schema']))),row_factory=dict_row,options='-c default_transaction_read_only=on -c statement_timeout=15000')
def safe():
 with connect(env['DATABASE_URL']) as db:
  db.execute('SET TRANSACTION READ ONLY')
  assert [r['id'] for r in db.execute('SELECT id FROM "ComplianceRuleSetVersion" WHERE "lifecycleState"=\'ACTIVE\'')]==['30f83523-f8a4-40d9-ab8f-3c4e878d8c60']
  assert db.execute('SELECT "lifecycleState" FROM "ComplianceRuleSetVersion" WHERE id=\'43eaa343-9fbe-40ef-a6a9-935249bbcb1e\'').fetchone()['lifecycleState']=='SUPERSEDED'
  assert db.execute('SELECT count(*) AS n FROM "RuleSetPreparationRun" WHERE "executionState" IN (\'QUEUED\',\'RUNNING\')').fetchone()['n']==0
  assert db.execute('SELECT count(*) AS n FROM "OutboxMessage" WHERE "publishedAt" IS NULL').fetchone()['n']==0
  assert db.execute('SELECT count(*) AS n FROM "AssessmentRuntime" WHERE "leaseToken" IS NOT NULL AND "leaseExpiresAt">now()').fetchone()['n']==0
  assert db.execute('SELECT count(*) AS n FROM "RuleSetPreparationSourceReview" WHERE "leaseExpiresAt">now()').fetchone()['n']==0
 with connect(env['LANGGRAPH_CHECKPOINT_DATABASE_URL']) as db:
  db.execute('SET TRANSACTION READ ONLY')
  assert db.execute("SELECT count(*) AS n FROM store WHERE prefix LIKE 'lcsp-agent-runtime-runs%' AND value->'run'->>'status' IN ('pending','running')").fetchone()['n']==0
safe()
with connect(env['DATABASE_URL']) as db:
 db.execute('SET TRANSACTION READ ONLY')
 ledger=db.execute('SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations"').fetchall()
 assert all(r['finished_at'] is not None or r['rolled_back_at'] is not None for r in ledger)
 applied={r['migration_name'] for r in ledger if r['finished_at'] is not None and r['rolled_back_at'] is None}
before=[{'name':p['name'],'pid':p['pid'],'restarts':p['pm2_env']['restart_time']} for p in json.loads(run(['pm2','jlist']))]
subprocess.run(['git','pull','--ff-only'],env=env,check=True)
assert run(['git','rev-parse','HEAD'])==NEW
assert run(['git','rev-parse','origin/fix/LCSP-360-corpus-driven-applicability'])==NEW
available={p.name for p in Path('apps/api/prisma/migrations').iterdir() if p.is_dir()}
assert not available-applied, 'No unapplied current schema migration is permitted; historical ledger entries stay untouched'
# Python-only change: no API build and no API restart.
safe()
for name in ['lcsp-agent-runtime']:subprocess.run(['pm2','restart',name],env=env,check=True,stdout=subprocess.DEVNULL)
urls={'API':'http://127.0.0.1:8080/health','Web':'http://127.0.0.1:3002/sign-in','Agent':'http://127.0.0.1:2024/ok'}
for attempt in range(25):
 try:
  health={k:urllib.request.urlopen(v,timeout=3).status for k,v in urls.items()}
  if all(v==200 for v in health.values()):break
 except Exception:pass
 time.sleep(2)
else:raise RuntimeError('Deployment health failed')
safe()
assert not run(['git','status','--short','--untracked-files=no'])
after=[{'name':p['name'],'pid':p['pid'],'status':p['pm2_env']['status'],'restarts':p['pm2_env']['restart_time']} for p in json.loads(run(['pm2','jlist']))]
assert all(next(p for p in after if p['name']==b['name'])['pid']==b['pid'] for b in before if b['name'] not in ['lcsp-agent-runtime'])
assert all(next(p for p in after if p['name']==name)['pid']!=next(p for p in before if p['name']==name)['pid'] for name in ['lcsp-agent-runtime'])
print(json.dumps({'deployment':'PASS','sha':NEW,'trackedStatus':'CLEAN','before':before,'after':after,'health':health,'providerCalls':0,'preparationsStarted':0}),flush=True)
'''
script='EXPECTED_NEW='+repr(subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip())+'\n'+script
r=subprocess.run(['ssh','-F','/home/khovan/.ssh/config','fogewise','cd /srv/apps/LCSP && .venv/bin/python -'],input=script.encode(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
text=r.stdout.decode(errors='replace');(root/'production-deployment.log').write_text(text);print(text)
raise SystemExit(r.returncode)
