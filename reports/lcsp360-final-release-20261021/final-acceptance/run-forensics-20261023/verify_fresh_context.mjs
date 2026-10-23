// Non-paid, read-only cross-check; private key never appears in the output.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { PrismaService } from "../../../../apps/api/dist/src/infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../../../apps/api/dist/src/modules/legal-source/application/services/legal-document-graph.service.js";
import { sourceReviewUnits } from "../../../../apps/api/dist/src/modules/compliance-rule-set/domain/source-review-frontier.js";

const privateConfig = JSON.parse(readFileSync(process.env.FORENSIC_PRIVATE_CONFIG));
assert.equal(statSync(process.env.FORENSIC_PRIVATE_CONFIG).mode & 0o777, 0o600);
const context = JSON.parse(readFileSync(`${privateConfig.output}/prepared-context.json`));
assert.equal(context.database, privateConfig.database);
assert.equal(context.candidateSha, privateConfig.candidateSha);
const sha = (value) => createHash("sha256").update(value).digest("hex");
assert.equal(sha(Buffer.from(privateConfig.auditKey, "hex")), context.auditKeySha256);
const { attestation, ...unsigned } = context.proof.receipt;
const digest = sha(JSON.stringify(Object.fromEntries(Object.entries(unsigned).sort(([a], [b]) => a.localeCompare(b)))));
assert.equal(attestation, "hmac-sha256:" + createHmac("sha256", Buffer.from(privateConfig.auditKey, "hex"))
  .update(`LCSP-SEMANTIC-AUDIT-HMAC-V1\n${context.runId}\n${digest}`).digest("hex"));
const source = readFileSync(new URL("../../../../deepagents/tests/fixtures/compliance_rule_set_context/synthetic-notice-v1.txt", import.meta.url));
assert.equal(sha(source), context.sourceSha256);
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${context.dbPort}/${context.database}`;
const db = new PrismaService();
try {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const run = await tx.ruleSetPreparationRun.findUniqueOrThrow({ where: { id: context.runId } });
    assert.equal(run.executionState, "QUEUED"); assert.equal(run.startedAt, null);
    const graph = await new LegalDocumentGraphService(tx).export(context.sourceVersionId, context.materializationId);
    assert.equal(graph.parserRevision, "legal-structure-v3");
    assert.equal(graph.materializationId, context.materializationId);
    assert.equal(graph.graphDigest, context.graphDigest);
    assert.equal(graph.references.length, 8);
    assert.equal(sourceReviewUnits(graph).length, 12);
    const docs = await tx.legalSourceDocument.findMany({ where: { legalSourceVersionId: context.sourceVersionId } });
    assert.equal(docs.length, 1); assert.equal(docs[0].sourceSha256, `sha256:${sha(source)}`);
    const chunks = await tx.legalDocumentChunk.findMany({ where: { legalSourceVersionId: context.sourceVersionId } });
    assert.equal(chunks.length, 15);
    for (const c of chunks) assert.equal(c.contentSha256, `sha256:${sha(c.content)}`);
    const counts = { usage: await tx.llmUsageEvent.count(), audits: await tx.ruleSetPreparationSemanticAudit.count(),
      inventories: await tx.ruleSetPreparationClaimInventory.count(), versions: await tx.complianceRuleSetVersion.count() };
    assert.deepEqual(counts, { usage: 0, audits: 0, inventories: 0, versions: 0 });
    return { status: "PASS_FRESH_READ_ONLY_PREFLIGHT_NO_INFERENCE", candidateSha: context.candidateSha,
      runId: context.runId, database: context.database, port: context.dbPort, state: run.executionState,
      sourceVersionId: context.sourceVersionId, materializationId: graph.materializationId, parserRevision: graph.parserRevision,
      sourceByteSha256: sha(source), persistedDocumentSha256: docs[0].sourceSha256, verifiedChunks: chunks.length,
      verifiedReviewUnits: sourceReviewUnits(graph).length,
      counts, hmacIndependentRoundTrip: true, privateKeyMode: "0600_DURABLE_OWNER_CACHE", paidCalls: 0,
      semanticAcceptance: "NOT_EVALUATED" };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
  writeFileSync(new URL("fresh-postgres-preflight-108efe8.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }
