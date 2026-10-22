"""Independent read-only PostgreSQL source/document/chunk/graph binding verification."""
import hashlib
import json
from pathlib import Path
import subprocess

DIR = Path(__file__).resolve().parent
ROOT = DIR.parents[3]
receipt = json.loads((DIR / "database-source-hmac-preflight.json").read_text())
database = receipt["database"]["name"]
source = receipt["sourceVersionId"]
materialization = receipt["materializationId"]
assert database.startswith("lcsp360_document_preflight_")
sql = f'''SELECT json_build_object(
  'database', current_database(),
  'readOnly', current_setting('default_transaction_read_only'),
  'documents', (SELECT json_agg(d) FROM "LegalSourceDocument" d WHERE "legalSourceVersionId"='{source}'),
  'chunks', (SELECT json_agg(c) FROM "LegalDocumentChunk" c WHERE "legalSourceVersionId"='{source}'),
  'materialization', (SELECT row_to_json(m) FROM "LegalDocumentMaterialization" m WHERE id='{materialization}'),
  'nodes', (SELECT json_agg(n) FROM "LegalDocumentNode" n WHERE "materializationId"='{materialization}'),
  'mappings', (SELECT json_agg(cm) FROM "LegalDocumentChunkNode" cm WHERE "materializationId"='{materialization}')
);'''
command = ["docker", "exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on",
           "lcsp360-source-digest-20261022-pg-55503", "psql", "-X", "-v", "ON_ERROR_STOP=1",
           "-U", "postgres", "-d", database, "-At", "-c", sql]
raw = subprocess.check_output(command)
rows = json.loads(raw)
assert rows["database"] == database and rows["readOnly"] == "on"
source_bytes = (ROOT / "deepagents/tests/fixtures/compliance_rule_set_context/synthetic-notice-v1.txt").read_bytes()
digest = hashlib.sha256(source_bytes).hexdigest()
name_digest = hashlib.sha256(receipt["documentSourceBinding"]["fixtureName"].encode()).hexdigest()
assert len(rows["documents"]) == 1
(document,) = rows["documents"]
assert document["sourceSha256"] == f"sha256:{digest}" != f"sha256:{name_digest}"
assert document["documentId"] == "SYNTHETIC-NOTICE-INSTRUMENT"
assert document["legalSourceVersionId"] == source
assert len(rows["chunks"]) == 15
for chunk in rows["chunks"]:
    assert chunk["legalSourceVersionId"] == source
    assert chunk["legalSourceDocumentId"] == document["id"]
    assert chunk["contentSha256"] == "sha256:" + hashlib.sha256(chunk["content"].encode()).hexdigest()
    assert chunk["legalEffectStatus"] == "EFFECTIVE"
assert rows["materialization"]["legalSourceVersionId"] == source
assert len(rows["nodes"]) == 20
for node in rows["nodes"]:
    assert node["legalSourceVersionId"] == source
    assert node["documentId"] == document["documentId"]
    assert node["materializationId"] == materialization
assert len(rows["mappings"]) == 15
chunks = {chunk["id"]: chunk for chunk in rows["chunks"]}
nodes = {node["nodeId"]: node for node in rows["nodes"]}
for mapping in rows["mappings"]:
    assert mapping["legalSourceVersionId"] == source
    assert mapping["chunkId"] in chunks and mapping["legalDocumentNodeId"] in nodes
result = {"status": "PASS", "candidateSha": receipt["candidateSha"], "database": database,
          "readOnly": True, "sql": sql, "documentRowId": document["id"], "documentId": document["documentId"],
          "sourceVersionId": source, "sourceBytes": len(source_bytes), "sourceFileSha256": digest,
          "persistedDocumentSha256": document["sourceSha256"], "fixtureNameSha256": name_digest,
          "matchesSourceBytes": True, "differsFromFixtureName": True, "verifiedChunks": len(chunks),
          "graphMaterializationId": materialization, "graphNodes": len(nodes), "chunkGraphMappings": len(rows["mappings"]),
          "allReferencesSharePinnedSourceVersion": True, "paidModelCalls": 0}
(DIR / "independent-postgres-verification.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
