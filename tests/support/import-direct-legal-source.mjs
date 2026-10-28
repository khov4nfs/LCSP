import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { python, pythonPath, sha, workerKey } from "./compliance-rule-set-stack.mjs";

/** Exercise upload, original download, the production parser and ingestion callbacks without inference. */
export async function importDirectLegalSource(stack, token, corpus, evidence) {
  const request = async (method, route, body, worker = false, mediaType = "application/json") => {
    const response = await fetch(`${stack.base}${route}`, {
      method,
      headers: { "content-type": mediaType, ...(worker ? { "x-worker-api-key": workerKey } : { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const result = await response.json();
    assert.ok(response.ok && result.ok, `${route}: ${JSON.stringify(result)}`);
    return result.data;
  };
  const checkpoint = path.join(evidence, "import.json");
  let state;
  if (existsSync(checkpoint)) state = JSON.parse(readFileSync(checkpoint));
  else {
    const source = await request("POST", "/admin/legal-sources", { name: "LCSP-360 official eight-document acceptance corpus" });
    const version = await request("POST", `/admin/legal-sources/${source.id}/versions`, {});
    state = { sourceId: source.id, versionId: version.id, documents: [], pending: null };
    writeFileSync(checkpoint, JSON.stringify(state, null, 2));
  }
  const versionId = state.versionId;
  for (const { document, blob } of corpus.entries) {
    if (state.documents.some((d) => d.documentId === document.documentId)) continue;
    const bytes = Buffer.from(blob.base64, "base64");
    assert.equal(sha(bytes), blob.sha256.replace(/^sha256:/, ""));
    assert.equal(bytes.length, blob.byteLength);
    const metadata = new URLSearchParams({ fileName: document.originalFileName, title: document.title, structureProfile: document.structureProfile });
    const row = state.pending ?? await request("POST", `/admin/legal-source-versions/${versionId}/documents/upload?${metadata}`, bytes, false, document.mediaType);
    assert.equal(row.documentId, document.documentId);
    state.pending = row;
    writeFileSync(checkpoint, JSON.stringify(state, null, 2));
    const original = await fetch(`${stack.base}/internal/legal-sources/documents/${row.id}/original?attempt=${row.attempt}`, { headers: { "x-worker-api-key": workerKey } });
    assert.equal(original.status, 200);
    const downloaded = Buffer.from(await original.arrayBuffer());
    assert.equal(sha(downloaded), sha(bytes));
    assert.equal(original.headers.get("x-lcsp-content-sha256").replace(/^sha256:/, ""), sha(bytes));
    const parsed = spawnSync(python, ["-c", "import base64,json,sys; from tools.legal.managed_documents.ingest import ingest_document; x=json.load(sys.stdin); print(json.dumps(ingest_document(data=base64.b64decode(x['data']),media_type=x['mediaType'],structure_profile=x['profile'],attempt=x['attempt']),ensure_ascii=False))"], {
      input: JSON.stringify({ data: downloaded.toString("base64"), mediaType: document.mediaType, profile: original.headers.get("x-lcsp-structure-profile"), attempt: row.attempt }),
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PYTHONPATH: pythonPath },
    });
    assert.equal(parsed.status, 0, parsed.stderr);
    const ingestion = JSON.parse(parsed.stdout);
    assert.equal(ingestion.outcome, "READY", JSON.stringify(ingestion));
    assert.ok(ingestion.chunks.length && ingestion.extraction.characterCount);
    assert.equal(new Set(ingestion.chunks.map((c) => c.locator)).size, ingestion.chunks.length);
    for (const chunk of ingestion.chunks) assert.equal(chunk.contentSha256.replace(/^sha256:/, ""), sha(chunk.content));
    assert.equal(ingestion.extraction.textSha256.replace(/^sha256:/, ""), sha(ingestion.extraction.pages.join("\n")));
    await request("POST", `/internal/legal-sources/documents/${row.id}/ingestion-result`, ingestion, true);
    const effect = document.provenance.legalEffectMetadata;
    // Existing legal metadata uses Vietnamese local dates stored as UTC instants.
    const effectiveDate = document.effectiveDate ? new Date(Date.parse(document.effectiveDate) + 7 * 3600_000).toISOString().slice(0, 10) : null;
    await request("PATCH", `/admin/legal-source-versions/${versionId}/documents/${row.id}/effect`, { ...effect, effectiveDate, provisionStatuses: document.provenance.provisionStatuses ?? {} });
    await request("PATCH", `/admin/legal-source-versions/${versionId}/documents/${row.id}/corpus-role`, { corpusRole: document.corpusRole });
    state.documents.push({ id: row.id, documentId: row.documentId, originalSha256: sha(bytes), chunkCount: ingestion.chunks.length, parser: ingestion.extraction.tool, parserVersion: ingestion.extraction.toolVersion });
    state.pending = null;
    writeFileSync(checkpoint, JSON.stringify(state, null, 2));
  }
  return versionId;
}
