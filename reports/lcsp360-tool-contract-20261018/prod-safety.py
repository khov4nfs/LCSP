"""Read-only production safety snapshot (git, authority, pins, active work, health). No mutation."""
import json,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parent
script=r'''
import os,json,subprocess,hashlib,urllib.request
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from dotenv import dotenv_values
import psycopg
from psycopg.rows import dict_row
VERSION='80bcda31-d0a7-4463-9f6e-41bd6da6ff12'
env={**os.environ,**{k:v for k,v in {**dotenv_values('.env'),**dotenv_values('.env.pm2')}.items() if v is not None}}
pid=int((Path.home()/'.pm2/pm2.pid').read_text().strip());env['PATH']=str((Path('/proc')/str(pid)/'exe').resolve().parent)+os.pathsep+env['PATH']
def run(a):return subprocess.check_output(a,env=env,text=True).strip()
def connect(url):
 u=urlsplit(url);return psycopg.connect(urlunsplit(u._replace(query=urlencode([(k,v) for k,v in parse_qsl(u.query) if k!='schema']))),row_factory=dict_row,options='-c default_transaction_read_only=on -c statement_timeout=15000')
def digest(rows):return hashlib.sha256(json.dumps(rows,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()
out={'branch':run(['git','branch','--show-current']),'head':run(['git','rev-parse','HEAD']),'origin':run(['git','rev-parse','origin/fix/LCSP-360-corpus-driven-applicability']),'trackedStatus':run(['git','status','--short','--untracked-files=no'])}
with connect(env['DATABASE_URL']) as db:
 db.execute('SET TRANSACTION READ ONLY')
 out['activeRuleSets']=[r['id'] for r in db.execute('SELECT id FROM "ComplianceRuleSetVersion" WHERE "lifecycleState"=\'ACTIVE\'')]
 out['ruleSetStates']=[dict(r) for r in db.execute('SELECT id,"lifecycleState" FROM "ComplianceRuleSetVersion" ORDER BY id')]
 out['activePreparations']=db.execute('SELECT count(*) AS n FROM "RuleSetPreparationRun" WHERE "executionState" IN (\'QUEUED\',\'RUNNING\')').fetchone()['n']
 out['unpublishedOutbox']=db.execute('SELECT count(*) AS n FROM "OutboxMessage" WHERE "publishedAt" IS NULL').fetchone()['n']
 out['assessmentLeases']=db.execute('SELECT count(*) AS n FROM "AssessmentRuntime" WHERE "leaseToken" IS NOT NULL AND "leaseExpiresAt">now()').fetchone()['n']
 out['reviewLeases']=db.execute('SELECT count(*) AS n FROM "RuleSetPreparationSourceReview" WHERE "leaseExpiresAt">now()').fetchone()['n']
 out['assessmentCasePins']=[dict(r) for r in db.execute('SELECT "assessmentId","ruleSetVersionId","pinnedAt" FROM "AssessmentCase" ORDER BY "assessmentId"')]
 out['sourceVersion']=digest(db.execute('SELECT * FROM "LegalSourceVersion" WHERE id=%s',(VERSION,)).fetchall())
 out['sourceDocuments']=digest(db.execute('SELECT * FROM "LegalSourceDocument" WHERE "legalSourceVersionId"=%s ORDER BY 1',(VERSION,)).fetchall())
 out['sourceChunks']=digest(db.execute('SELECT * FROM "LegalDocumentChunk" WHERE "legalSourceVersionId"=%s ORDER BY 1',(VERSION,)).fetchall())
 for t in ['ComplianceRuleSetVersion','RuleSetPreparationRun','AssessmentCase','LlmUsageEvent']:
  rows=db.execute('SELECT * FROM "'+t+'" ORDER BY 1').fetchall();out['digest_'+t]={'count':len(rows),'digest':digest(rows)}
with connect(env['LANGGRAPH_CHECKPOINT_DATABASE_URL']) as db:
 db.execute('SET TRANSACTION READ ONLY')
 out['nativeActiveRuns']=db.execute("SELECT count(*) AS n FROM store WHERE prefix LIKE 'lcsp-agent-runtime-runs%' AND value->'run'->>'status' IN ('pending','running')").fetchone()['n']
urls={'API':'http://127.0.0.1:8080/health','Web':'http://127.0.0.1:3002/sign-in','Agent':'http://127.0.0.1:2024/ok'}
out['health']={k:urllib.request.urlopen(v,timeout=5).status for k,v in urls.items()}
out['pm2']=[{'name':p['name'],'pid':p['pid'],'status':p['pm2_env']['status'],'restarts':p['pm2_env']['restart_time']} for p in json.loads(run(['pm2','jlist']))]
print(json.dumps(out,default=str))
'''
r=subprocess.run(['ssh','-F','/home/khovan/.ssh/config','fogewise','cd /srv/apps/LCSP && .venv/bin/python -'],input=script.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
text=r.stdout.decode(errors='replace')
name=sys.argv[1] if len(sys.argv)>1 else 'production-safety.json'
if r.returncode:
    print(r.stderr.decode(errors='replace')[-3000:]);raise SystemExit(r.returncode)
(root/name).write_text(json.dumps(json.loads(text.strip().splitlines()[-1]),indent=1)+'\n');print(text[-3500:])
