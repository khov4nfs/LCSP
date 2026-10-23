/** Pure full-source replay; no persistence, agents, model calls or semantic verdicts. */
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildLegalDocumentGraph } from "../../../../apps/api/src/modules/legal-source/domain/document-graph.js";
import { sourceReviewUnits } from "../../../../apps/api/src/modules/compliance-rule-set/domain/source-review-frontier.js";

const snapshot = JSON.parse(readFileSync(new URL("postgres-read-only-snapshot.json", import.meta.url), "utf8"));
const before = snapshot.bundle.documentGraph;
const after = buildLegalDocumentGraph(snapshot.bundle.legalSourceVersionId, snapshot.bundle.documents);
assert.notEqual(after.materializationId, before.materializationId);
assert.equal(after.parserRevision, "legal-structure-v3");
assert.deepEqual(Object.fromEntries(after.nodes.map((n) => [n.nodeId, n])), Object.fromEntries(before.nodes.map((n) => [n.nodeId, n])));
const mappings = (graph) => graph.chunkMappings.map((m) => JSON.stringify(m)).sort();
assert.deepEqual(mappings(after), mappings(before));
assert.deepEqual(sourceReviewUnits(after).map((n) => n.nodeId), snapshot.reviews.map((r) => r.sourceNodeId));
const retained = new Set(after.references.map((r) => r.referenceId));
const removed = before.references.filter((r) => !retained.has(r.referenceId));
assert.equal(removed.length, 1);
for (const ref of removed) {
  const source = before.nodes.find((n) => n.nodeId === ref.fromNodeId).content;
  assert.match(source.slice(Math.max(0, ref.charStart - 1), ref.charStart), /[\p{L}\p{N}_]/u);
}
const refs = (rows) => Object.fromEntries(rows.map((r) => [r.referenceId, r]));
assert.deepEqual(refs(after.references), refs(before.references.filter((r) => retained.has(r.referenceId))));
writeFileSync(new URL("parser-replay.json", import.meta.url), JSON.stringify({
  status: "PASS_FULL_PINNED_SOURCE_STRUCTURAL_REPLAY", sourceVersion: snapshot.bundle.legalSourceVersionId,
  before: { parserRevision: before.parserRevision, materializationId: before.materializationId, references: before.references.length },
  after: { parserRevision: after.parserRevision, materializationId: after.materializationId, references: after.references.length },
  removed, unchangedNodes: after.nodes.length, unchangedChunks: after.chunkMappings.length,
  unchangedReviewUnits: sourceReviewUnits(after).length, historicalDatabaseModified: false, providerDispatches: 0,
}, null, 2) + "\n");
console.log("PASS: full pinned source, node identities, review units and genuine citations preserved");
