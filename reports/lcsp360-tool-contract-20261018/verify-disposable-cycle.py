"""Verify the committed legal-source fixture has a resolved cycle before live dispatch."""
import json
from pathlib import Path
P=Path(__file__).resolve().parent
d=json.loads((P/"disposable-input.json").read_text());g=d["graph"]
nodes={n["nodeId"]:n for n in g["nodes"]};refs=[r for r in g["references"] if r["resolutionState"]=="RESOLVED"]
adj={n:set() for n in nodes}
for r in refs:adj[r["fromNodeId"]].add(r["toNodeId"])
def reachable(start):
 seen=set();todo=[start]
 while todo:
  n=todo.pop()
  if n in seen:continue
  seen.add(n);todo.extend(adj[n]-seen)
 return seen
reach={n:reachable(n) for n in nodes};remaining=set(nodes);cycles=[]
while remaining:
 n=min(remaining);component={k for k in remaining if k in reach[n] and n in reach[k]};remaining-=component
 if len(component)>1:cycles.append(sorted(component))
assert any(len(c) in [2,3] for c in cycles),"No two- or three-node resolved cycle; live dispatch prohibited"
result={"FIXTURE_RESOLVED_CYCLE":"PASS","sha":json.loads((P/"disposable-images.json").read_text())["sha"],"cycles":[{"nodes":[{k:nodes[n][k] for k in ["nodeId","structuralPath","content"]} for n in c],"references":[r for r in refs if r["fromNodeId"] in c and r["toNodeId"] in c]} for c in cycles],"materiality":"The reciprocal prohibition/exception references must receive semantic bindings; independent post-run semantic review required","providerCalls":0,"preparations":0}
(P/"disposable-cycle-preflight.json").write_text(json.dumps(result,indent=2)+"\n")
print(json.dumps({"FIXTURE_RESOLVED_CYCLE":"PASS","sizes":[len(c) for c in cycles],"preparations":0}))
