"""Run the API gates on task-owned loopback PostgreSQL containers (created here, removed by --teardown)."""
import json,os,subprocess,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
PREFIX='lcsp360-ruleauth-owned-'
DBS={ # name -> (port, database)
 'src':(55471,'lcsp_ra_src'),'tests':(55472,'lcsp_ra_tests'),'service':(55473,'lcsp_ra_service'),'lifecycle':(55474,'lcsp_ra_lifecycle'),
 'inventory':(55475,'lcsp_ra_inventory'),'graph':(55441,'lcsp_legal_graph'),'admin':(55445,'lcsp_admin_prepare_test'),'mgmt':(55445,'lcsp_legal_source_mgmt_test'),'reactivation':(55479,'lcsp_reactivation_test'),'e2e':(55480,'lcsp_ra_e2e')}
def sh(*a,**k):return subprocess.run(a,check=True,**k)
def up(port,db):
 name=PREFIX+str(port)
 if subprocess.run(['docker','inspect',name],capture_output=True).returncode:
  sh('docker','run','-d','--name',name,'-e','POSTGRES_PASSWORD=postgres','-p',f'127.0.0.1:{port}:5432','postgres:16-alpine',stdout=subprocess.DEVNULL)
 ok=0
 for _ in range(240):
  # The image restarts PostgreSQL after its init phase: require two consecutive TCP-level successes.
  ok=ok+1 if subprocess.run(['docker','exec',name,'psql','-h','127.0.0.1','-U','postgres','-Atc','select 1'],capture_output=True).returncode==0 else 0
  if ok>=2:break
  time.sleep(1)
 have=subprocess.check_output(['docker','exec',name,'psql','-U','postgres','-Atc',f"SELECT 1 FROM pg_database WHERE datname='{db}'"],text=True).strip()
 if not have:sh('docker','exec',name,'createdb','-U','postgres',db)
 return f'postgresql://postgres:postgres@127.0.0.1:{port}/{db}?schema=public'
RUNS={
 'src':('jest.config.ts',['--testPathPatterns=src/','--testPathIgnorePatterns=compliance-rule-set.service.integration.spec.ts|rule-set-preparation-lifecycle.integration.spec.ts|claim-inventory.integration.spec.ts']),
 'tests':('jest.config.ts',['--testPathPatterns=test/']),
 'service':('jest.config.ts',['--runTestsByPath','src/modules/compliance-rule-set/application/services/compliance-rule-set.service.integration.spec.ts']),
 'lifecycle':('jest.config.ts',['--runTestsByPath','src/modules/compliance-rule-set/application/services/rule-set-preparation-lifecycle.integration.spec.ts']),
 'inventory':('jest.config.ts',['--runTestsByPath','src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.integration.spec.ts']),
 'graph':('jest.config.ts',['--runTestsByPath','src/modules/legal-source/application/services/legal-document-graph.integration.spec.ts']),
 'admin':('jest.config.ts',['--runTestsByPath','src/modules/compliance-rule-set/application/services/admin-rule-set-preparation.integration.spec.ts']),
 'mgmt':('jest.config.ts',['--runTestsByPath','src/modules/legal-source/application/services/legal-source-management.integration.spec.ts']),
 'reactivation':('jest.config.ts',['--runTestsByPath','src/modules/compliance-rule-set/application/services/rule-set-reactivation.integration.spec.ts']),
 'e2e':('test/jest-e2e.ts',['--runTestsByPath','test/legal-source.e2e-spec.ts']),
}
if sys.argv[1]=='--teardown':
 for port in {p for p,_ in DBS.values()}:subprocess.run(['docker','rm','-f',PREFIX+str(port)],capture_output=True)
 print('torn down');raise SystemExit
results=json.loads((HERE/'api-validation.json').read_text()) if (HERE/'api-validation.json').exists() else []
for name in sys.argv[1:]:
 results=[r for r in results if r['check']!=name]
 port,db=DBS[name];url=up(port,db)
 env={**os.environ,'DATABASE_URL':url,'PHASE25_DATABASE_URL':url,'LCSP_TEST_POSTGRES_PORT':str(port),'LCSP_TEST_POSTGRES_DB':db,'NODE_OPTIONS':'--experimental-vm-modules --max-old-space-size=2048'}
 log=HERE/f'api-{name}.log'
 with log.open('w') as out:
  sh('pnpm','--dir','apps/api','exec','prisma','migrate','deploy',cwd=ROOT,env=env,stdout=out,stderr=subprocess.STDOUT)
  config,args=RUNS[name]
  rc=subprocess.run(['pnpm','--dir','apps/api','exec','jest','--config',config,'--runInBand','--silent','--json','--outputFile='+str(HERE/f'api-{name}.json'),*args],cwd=ROOT,env=env,stdout=out,stderr=subprocess.STDOUT).returncode
 j=json.loads((HERE/f'api-{name}.json').read_text()) if (HERE/f'api-{name}.json').exists() else {}
 # These suites describe.skip unless the database NAME matches; a skipped suite is not a pass.
 if name not in ('src',) and rc==0 and (not j.get('numPassedTests') or j.get('numPendingTests')):rc=3
 results.append({'check':name,'exitCode':rc,'passed':j.get('numPassedTests'),'failed':j.get('numFailedTests'),'pending':j.get('numPendingTests'),'suites':j.get('numTotalTestSuites')})
 (HERE/'api-validation.json').write_text(json.dumps(results,indent=2)+'\n');print(results[-1],flush=True)
