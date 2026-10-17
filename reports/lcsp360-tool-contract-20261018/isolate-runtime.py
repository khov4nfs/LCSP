"""Disposable-only network namespace firewall; no host/VPS firewall or application source changes."""
import importlib.util,json,subprocess,sys
from pathlib import Path
p=Path(__file__).resolve().parent;root=p.parents[1]
spec=importlib.util.spec_from_file_location('stack',root/'tests/staging-stack.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
from runtime_limits import apply
apply(h)
identity=json.loads((p/'disposable-run.json').read_text());run=identity['runId'];s=h.Stack(run);s.manifest=h.json_file(s.private/'stack.json');prefix=s.prefix
assert s.sql('SELECT count(*) FROM "RuleSetPreparationRun";').strip()=='0'
pg=s.inspect(prefix+'-postgres')['NetworkSettings']['Networks'][prefix]['IPAddress'];tag='lcsp-legal-graph-isolation:'+run
s.docker('build','--build-arg','LCSP_ACCEPTANCE_API_IMAGE=lcsp-legal-graph-api:'+json.loads((p/'disposable-images.json').read_text())['sha'][:12],'--resource','memory=1g','--resource','cpu-quota=100000','-t',tag,'-f',str(p/'isolation.Dockerfile'),'.',timeout=300)
envs=h.json_file(s.private/'runtime-envs.json')
# Broker pause prevents any queued delivery while the canonical bridge starts and its namespace is protected.
s.docker('pause',prefix+'-rabbitmq')
try:
 if not s.inspect(prefix+'-bridge'):
  mounts=[(str(s.private/n),target) for n,target in [('legal_source','/app/.legal-source'),('chroma','/app/.chroma'),('runtime','/app/tmp'),('runtime','/app/deepagents/tmp')]]
  s.create('bridge',envs['bridge'],mounts=mounts)
 receipts=[]
 for role in ['api','server','bridge']:
  name=prefix+'-'+role;info=s.inspect(name);assert info['State']['Running'] and info['Config']['Labels'][h.OWNER_LABEL]==run
  args=['docker','run','--rm','--label',h.OWNER_LABEL+'='+run,'--network','container:'+name,'--cap-add','NET_ADMIN','--user','0',tag,'-c','iptables -A OUTPUT -p tcp --dport 5432 ! -d "$1" -j REJECT --reject-with tcp-reset; ip6tables -A OUTPUT -p tcp --dport 5432 -j REJECT --reject-with tcp-reset; iptables -S OUTPUT; ip6tables -S OUTPUT','firewall',pg]
  # sh -e makes every rule mandatory, including IPv6; helper has no application credentials.
  args[args.index('-c')]='-ec'
  result=subprocess.run(args,capture_output=True,text=True);assert result.returncode==0,'Network namespace firewall failed; broker remains unprocessed'
  receipts.append({'role':role,'rules':result.stdout.strip().splitlines(),'hostFirewallChanged':False})
finally:
 s.docker('unpause',prefix+'-rabbitmq')
assert s.sql('SELECT count(*) FROM "RuleSetPreparationRun";').strip()=='0'
(p/'disposable-network-firewall.json').write_text(json.dumps({'scope':'DISPOSABLE_CONTAINER_NETWORK_NAMESPACES_ONLY','isolatedPostgresIp':pg,'externalPostgres':'BLOCKED IPv4 and IPv6; only isolated PostgreSQL is allowed','runtimeCapabilitiesUnchanged':True,'helperImage':tag,'rules':receipts,'preparations':0,'teardown':'Rules disappear with owned container network namespaces'},indent=2)+'\n')
print(json.dumps({'firewall':'PASS','protectedRoles':['api','server','bridge'],'productionFirewallChanged':False,'preparations':0}))
