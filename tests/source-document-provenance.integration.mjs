// Provider-free PostgreSQL regression. Requires a fresh task-owned test instance and a built API.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { LEGAL_SOURCE_CHUNK_STATUSES } from "@lcsp/contracts/legal-source";
import { root, runPython, startStack } from "./support/compliance-rule-set-stack.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = process.env.LCSP_SOURCE_PROVENANCE_OUT;
const database = process.env.LCSP_SOURCE_PROVENANCE_DATABASE ?? `lcsp_provenance_${randomUUID().replaceAll("-", "")}`;
let stack;
let fixture;
let bytes;

before(async () => {
  stack = await startStack({ database, apiPort: Number(process.env.LCSP_SOURCE_PROVENANCE_API_PORT ?? 3460) });
  fixture = await runPython(path.join(root, "deepagents/tests/vertical/fixture_chunks.py"), []);
  bytes = readFileSync(path.join(root, "deepagents/tests/fixtures/compliance_rule_set_context/synthetic-notice-v1.txt"));
});
after(async () => { await stack?.stop(); });

async function verifyDocument(label, material, sourceBytes, sourceSha256) {
  const name = `different-fixture-name-${randomUUID()}`;
  const sourceId = await stack.seedLegalSource({ name, status: "ACTIVE", documentId: material.documentId,
    chunks: material.chunks, sourceBytes, sourceSha256 });
  const document = (await stack.q(`SELECT id,"legalSourceVersionId","documentId","sourceSha256" FROM "LegalSourceDocument" WHERE "legalSourceVersionId"=$1`, [sourceId])).rows;
  const chunks = (await stack.q(`SELECT "legalSourceVersionId","legalSourceDocumentId",locator,content,"contentSha256","legalEffectStatus","legalStatusSourceRef" FROM "LegalDocumentChunk" WHERE "legalSourceVersionId"=$1 ORDER BY locator`, [sourceId])).rows;
  const expected = digest(sourceBytes);
  const receipt = { database, sourceVersionId: sourceId, document, sourceFileSha256: expected,
    fixtureNameSha256: digest(Buffer.from(name)), verifiedChunks: chunks.length,
    documentMatchesSource: document[0]?.sourceSha256 === `sha256:${expected}`,
    documentDiffersFromName: document[0]?.sourceSha256 !== `sha256:${digest(Buffer.from(name))}` };
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, `${label}.json`), JSON.stringify(receipt, null, 2) + "\n");
  }
  assert.equal(document.length, 1);
  assert.equal(document[0].sourceSha256, `sha256:${expected}`);
  assert.notEqual(document[0].sourceSha256, `sha256:${digest(Buffer.from(name))}`);
  assert.equal(document[0].legalSourceVersionId, sourceId);
  assert.equal(document[0].documentId, material.documentId);
  assert.equal(chunks.length, material.chunks.length);
  const originals = new Map(material.chunks.map((chunk) => [chunk.locator, chunk]));
  for (const chunk of chunks) {
    assert.equal(chunk.legalSourceVersionId, sourceId);
    assert.equal(chunk.legalSourceDocumentId, document[0].id);
    assert.equal(chunk.content, originals.get(chunk.locator).content);
    assert.equal(chunk.contentSha256, `sha256:${digest(Buffer.from(chunk.content))}`);
    assert.equal(chunk.legalEffectStatus, LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE);
    assert.equal(chunk.legalStatusSourceRef, `fixture:${name}`);
  }
}

test("pinned source digest is independently verified and persisted instead of the fixture-name hash", async () => {
  const pins = JSON.parse(readFileSync(path.join(root, "deepagents/tests/fixtures/compliance_rule_set_context/pins.json")));
  const pin = pins.sources.find((source) => source.legalSourceVersion === "SYNTHETIC-LEGAL_SOURCE-V1");
  assert.equal(`sha256:${digest(bytes)}`, pin.sourceSha256);
  assert.equal(fixture.sourceSha256, digest(bytes));
  assert.deepEqual(Buffer.from(fixture.sourceBytesBase64, "base64"), bytes);
  await verifyDocument("pinned", fixture, bytes, fixture.sourceSha256);
});

test("unfamiliar semantic control binds its actual source bytes", async () => {
  const control = "P10-multilingual-unfamiliar";
  const material = await runPython(path.join(root, "deepagents/tests/vertical/control_chunks.py"), [control]);
  const sourceBytes = readFileSync(path.join(root, `tests/fixtures/semantic-control/${control}.txt`));
  assert.equal(material.sourceSha256, digest(sourceBytes));
  assert.deepEqual(Buffer.from(material.sourceBytesBase64, "base64"), sourceBytes);
  await verifyDocument("control", material, sourceBytes, material.sourceSha256);
});

test("canonical prefixed digest is stored once without a double prefix", async () => {
  await verifyDocument("prefixed", fixture, bytes, `sha256:${digest(bytes)}`);
});

async function counts() {
  return (await stack.q(`SELECT (SELECT count(*) FROM "LegalSourceVersion")::int AS versions,
    (SELECT count(*) FROM "LegalSourceDocument")::int AS documents,
    (SELECT count(*) FROM "LegalDocumentChunk")::int AS chunks,
    (SELECT count(*) FROM "LegalRetrievalIndex")::int AS indexes`)).rows[0];
}

for (const [label, supplied] of [
  ["absent", undefined], ["null", null], ["empty", ""], ["short", "a".repeat(63)],
  ["nonhex", "g".repeat(64)], ["double prefix", `sha256:sha256:${"a".repeat(64)}`],
]) {
  test(`rejects ${label} authoritative digest before any source writes`, async () => {
    const before = await counts();
    await assert.rejects(stack.seedLegalSource({ name: `invalid-${randomUUID()}`, status: "ACTIVE",
      documentId: fixture.documentId, chunks: fixture.chunks, sourceBytes: bytes, sourceSha256: supplied }), /sourceSha256/);
    assert.deepEqual(await counts(), before);
  });
}

test("rejects a syntactically valid digest of different source bytes before writes", async () => {
  const before = await counts();
  await assert.rejects(stack.seedLegalSource({ name: "wrong-source", status: "ACTIVE", documentId: fixture.documentId,
    chunks: fixture.chunks, sourceBytes: bytes, sourceSha256: digest(Buffer.from("different source bytes")) }), /sourceSha256.*source bytes/);
  assert.deepEqual(await counts(), before);
});

test("rejects missing original source bytes before writes", async () => {
  const before = await counts();
  await assert.rejects(stack.seedLegalSource({ name: "missing-bytes", status: "ACTIVE", documentId: fixture.documentId,
    chunks: fixture.chunks, sourceSha256: digest(bytes) }), /sourceBytes/);
  assert.deepEqual(await counts(), before);
});

for (const mode of ["single", "source-answerable", "human", "not-applicable", "bounded-absence", "bounded-absence-gapped", "fallback-found", "mixed"]) {
  test(`Root ${mode} fixture binds its original in-memory document bytes`, async () => {
    const material = await runPython(path.join(root, "deepagents/tests/vertical/root_semantic_fixture.py"), [mode]);
    const sourceBytes = Buffer.from(material.sourceBytesBase64, "base64");
    assert.equal(material.sourceSha256, digest(sourceBytes));
    assert.ok(material.chunks.every((chunk) => sourceBytes.toString("utf8").includes(chunk.content)));
    await verifyDocument(`root-${mode}`, material, sourceBytes, material.sourceSha256);
  });
}
