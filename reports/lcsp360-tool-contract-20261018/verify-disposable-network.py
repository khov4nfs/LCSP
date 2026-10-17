"""Probe only the owned namespaces after mandatory PostgreSQL egress guards are installed."""
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location("stack", ROOT / "tests/staging-stack.py")
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
run = json.loads((HERE / "disposable-run.json").read_text())["runId"]
s = h.Stack(run)
s.manifest = h.json_file(s.private / "stack.json")
guard = json.loads((HERE / "disposable-network-firewall.json").read_text())
assert s.sql('SELECT count(*) FROM "RuleSetPreparationRun";').strip() == "0"
script = r'''
import net from 'node:net';
const targets = JSON.parse(process.argv[1]);
const probe = host => new Promise(resolve => {
  const socket = net.createConnection({host, port:5432});
  socket.setTimeout(2000);
  socket.once('connect',()=>{socket.destroy();resolve({host,connected:true});});
  socket.once('error',error=>{socket.destroy();resolve({host,connected:false,code:error.code});});
  socket.once('timeout',()=>{socket.destroy();resolve({host,connected:false,code:'TIMEOUT'});});
});
console.log(JSON.stringify(await Promise.all(targets.map(probe))));
'''
receipts = []
for role in ["api", "server", "bridge"]:
    name = s.prefix + "-" + role
    assert s.inspect(name)["Config"]["Labels"][h.OWNER_LABEL] == run
    targets = [guard["isolatedPostgresIp"], "163.61.183.129", "::ffff:163.61.183.129", "2001:db8::1"]
    result = s.docker("run", "--rm", "--label", h.OWNER_LABEL + "=" + run, "--network", "container:" + name,
        "--entrypoint", "node", guard["helperImage"], "--input-type=module", "-e", script, json.dumps(targets))
    probes = json.loads(result)
    assert probes[0]["connected"] and not any(p["connected"] for p in probes[1:])
    receipts.append({"role": role, "namespace": name, "probes": probes})
assert s.sql('SELECT count(*) FROM "RuleSetPreparationRun";').strip() == "0"
(HERE / "disposable-network-probes.json").write_text(json.dumps({"outcome": "PASS", "productionFirewallChanged": False, "providerCalls": 0, "preparations": 0, "namespaces": receipts}, indent=2) + "\n")
print(json.dumps({"networkIsolation": "PASS", "namespaces": 3, "isolatedPostgresReachable": True, "externalPostgresReachable": False, "preparations": 0}))
