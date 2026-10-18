"""Exact canonical retained source; no provider, DB, Preparation or approximation of the failed artifact."""
import json
import subprocess
from copy import deepcopy
from pathlib import Path

from rule_set_preparation.source_graph import PinnedSourceGraph

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "reports/lcsp360-source-semantic-fidelity-20261018"
RETAINED = ROOT / "reports/lcsp360-tool-contract-20261018/retained-final-semantic-failure-b7c68479.json"


def retained():
    fixture = json.loads(RETAINED.read_text())
    meta = json.loads((REPORT / "retained-source-metadata.json").read_text())
    content = {n["nodeId"]: n["content"] for n in fixture["sourceNodes"]}
    graph = {**{k: fixture["frozenInventory"]["graph"][k] for k in ["materializationId", "legalSourceVersionId"]},
             "nodes": [{**n, "content": content[n["nodeId"]]} for n in meta["nodes"]],
             "references": fixture["references"], "chunkMappings": meta["chunkMappings"],
             "retrievalUnits": [{**u, "content": content[u["legalDocumentNodeId"]][u["contentStart"]:u["contentEnd"]]} for u in meta["retrievalUnits"]]}
    owners = {m["chunkId"]: m["legalDocumentNodeId"] for m in graph["chunkMappings"]}
    chunks = [{**c, "chunkId": c["id"], "content": content[owners[c["id"]]], "sourceEffectStatus": "IN_FORCE"} for c in meta["chunks"]]
    return fixture, PinnedSourceGraph(graph, chunks), meta


def bridge(action, source, graph, **fields):
    request = {"action": action, "source": source.graph, "graph": graph, "revision": 1, **fields}
    result = subprocess.run(["pnpm", "exec", "tsx", "apps/api/test/support/semantic-audit-bridge.ts"], cwd=ROOT, input=json.dumps(request), capture_output=True, text=True, check=True)
    return json.loads(result.stdout)
