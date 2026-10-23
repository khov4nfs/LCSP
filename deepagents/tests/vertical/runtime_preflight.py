"""Read-only provider-free verification of a queued run's pinned graph and audit key."""
import hashlib,json,sys
from pathlib import Path
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.semantic_audit import attest_receipt,verify_attestation,canonical_support,utf16_slice
bundle=json.loads(Path(sys.argv[1]).read_text())
run_id=sys.argv[2]
graph=PinnedSourceGraph(bundle["documentGraph"],[{**c,"documentId":d["documentId"],"legalSourceVersionId":bundle["legalSourceVersionId"]} for d in bundle["documents"] for c in d["chunks"]])
assert not graph.extraction_gaps
assert {node["legalEffectStatus"] for node in graph.nodes.values()} == {"EFFECTIVE"}
for node_id,node in graph.nodes.items():
    text=node["content"]
    if not text.strip():continue
    end=len(text.encode("utf-16-le"))//2
    support=canonical_support(graph,[node_id],[{"nodeId":node_id,"startOffset":0,"endOffset":end}])[0]
    assert support["contentSha256"].removeprefix("sha256:")==hashlib.sha256(utf16_slice(text,0,end).encode()).hexdigest()
receipt=attest_receipt({"sourceNodeId":next(iter(graph.nodes)),"verdict":"NOT_EVALUATED","purpose":"RUNTIME_PREFLIGHT_ONLY"},run_id)
assert verify_attestation(receipt,run_id)
assert not verify_attestation(receipt,"different-run")
assert not verify_attestation({**receipt,"purpose":"TAMPERED"},run_id)
print(json.dumps({"status":"PASS","sourceSupportHashesVerified":len(graph.nodes),"hmacRoundTrip":True,"tamperRejected":True,"wrongRunRejected":True,"receipt":receipt,"paidModelCalls":0,"semanticAcceptance":"NOT_EVALUATED"}))
