"""Provider-free source/HMAC preflight; claims no semantic acceptance."""
import hashlib,json,sys
from tools.common.capabilities.platform.api_client import WorkerApiClient
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.semantic_audit import attest_receipt,verify_attestation,canonical_support,utf16_slice
base,key,run_id=sys.argv[1:4]
bundle=WorkerApiClient(base,key).claim_rule_set_preparation(run_id)
graph=PinnedSourceGraph(bundle["documentGraph"],[{**c,"documentId":d["documentId"],"legalSourceVersionId":bundle["legalSourceVersionId"]} for d in bundle["documents"] for c in d["chunks"]])
assert not graph.extraction_gaps
statuses={node["legalEffectStatus"] for node in graph.nodes.values()}
assert statuses=={"EFFECTIVE"},statuses
supports=0
for node_id,node in graph.nodes.items():
    text=node["content"]
    if not text.strip():continue
    end=len(text.encode("utf-16-le"))//2
    support=canonical_support(graph,[node_id],[{"nodeId":node_id,"startOffset":0,"endOffset":end}])[0]
    assert support["contentSha256"].removeprefix("sha256:")==hashlib.sha256(utf16_slice(text,0,end).encode()).hexdigest()
    supports+=1
receipt=attest_receipt({"sourceNodeId":next(iter(graph.nodes)),"verdict":"NOT_EVALUATED","purpose":"HMAC_PREFLIGHT_ONLY"},run_id)
assert verify_attestation(receipt,run_id)
assert not verify_attestation(receipt,"different-run")
assert not verify_attestation({**receipt,"purpose":"TAMPERED"},run_id)
print(json.dumps({"legalSourceVersionId":bundle["legalSourceVersionId"],"materializationId":bundle["documentGraph"]["materializationId"],"graphNodes":len(graph.nodes),"statuses":sorted(statuses),"sourceSupportHashesVerified":supports,"receipt":receipt,"hmacRoundTrip":True,"tamperRejected":True,"wrongRunRejected":True,"paidModelCalls":0}))
