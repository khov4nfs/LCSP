import { describe, expect, it } from "@jest/globals";
import {
  LEGAL_APPLICABILITY_MODES,
  LEGAL_EFFECT_KINDS as K,
  LEGAL_EFFECT_TARGET_SCOPES as S,
  type LegalSemanticGraph,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_SOURCE_CHUNK_STATUSES as STATUS } from "@lcsp/contracts/legal-source";
import { validPacket, fixtureLegalSource } from "../../../../test/support/compliance-rule-set-fixtures.js";
import { canonicalInventoryFixture } from "../../../../test/support/canonical-claim-inventory-fixture.js";
import { effectiveSourceStatus } from "./source-completeness.js";
import { authoringReadinessGaps } from "./claim-inventory.js";

function fixture() {
  const packet = validPacket();
  const { graph } = canonicalInventoryFixture(packet, "00000000-0000-4000-8000-000000000009", 1);
  const source = fixtureLegalSource().documentGraph!;
  const node = source.nodes.find((n) => n.nodeType === "CLAUSE")!;
  const sibling = source.nodes.find((n) => n.documentId === node.documentId && n.nodeType === "CLAUSE" && n.nodeId !== node.nodeId)!;
  graph.targetDate = "2026-10-25";
  const effect: LegalSemanticGraph["claims"][number] = { ...graph.claims[0], claimId: "effect", sourceNodeIds: [sibling.nodeId],
    semanticFrame: { ...graph.claims[0].semanticFrame!, legalEffect: { kind: K.REPEALS, targets: [{ nodeId: node.nodeId, scope: S.EXACT }],
      unresolvedTargets: [], effectiveFrom: "2026-01-01", effectiveUntil: null, conditions: null } } };
  graph.claims.push(effect);
  return { source, graph, node, sibling, effect: effect.semanticFrame!.legalEffect! };
}

describe("dated legal effects over the existing document graph", () => {
  it("applies an exact repeal without changing the sibling or original source", () => {
    const f = fixture();
    expect(effectiveSourceStatus(f.source, f.graph, f.node.nodeId)).toBe(STATUS.REPEALED);
    expect(effectiveSourceStatus(f.source, f.graph, f.sibling.nodeId)).toBe(f.sibling.legalEffectStatus);
    expect(f.node.legalEffectStatus).toBe(STATUS.EFFECTIVE);
  });
  it("distinguishes exact and subtree effects", () => {
    const f = fixture();
    f.effect.targets = [{ nodeId: f.node.parentNodeId!, scope: S.EXACT }];
    expect(effectiveSourceStatus(f.source, f.graph, f.node.nodeId)).toBe(STATUS.EFFECTIVE);
    f.effect.targets[0].scope = S.SUBTREE;
    expect(effectiveSourceStatus(f.source, f.graph, f.node.nodeId)).toBe(STATUS.REPEALED);
  });
  it("keeps future and ended effects from changing the target-date result", () => {
    const f = fixture();
    f.effect.effectiveFrom = "2027-01-01";
    expect(effectiveSourceStatus(f.source, f.graph, f.node.nodeId)).toBe(STATUS.EFFECTIVE);
    f.effect.effectiveFrom = "2025-01-01";
    f.effect.effectiveUntil = "2026-01-01";
    expect(effectiveSourceStatus(f.source, f.graph, f.node.nodeId)).toBe(STATUS.EFFECTIVE);
  });
  it.each(["date", "condition", "external-target", "conflict"])("keeps unresolved %s explicit", (kind) => {
    const f = fixture();
    if (kind === "date") f.effect.effectiveFrom = null;
    if (kind === "condition") f.effect.conditions = "Unless the transitional cohort applies";
    if (kind === "external-target") f.effect.unresolvedTargets = [{ documentIdentifier: "missing", locator: "art-1", reason: "Document is outside the pinned corpus" }];
    if (kind === "conflict") f.graph.claims.push({ ...f.graph.claims.at(-1)!, claimId: "conflict", semanticFrame: { ...f.graph.claims.at(-1)!.semanticFrame!, legalEffect: { ...f.effect, kind: K.REPLACES } } });
    expect(effectiveSourceStatus(f.source, f.graph, f.node.nodeId)).toBe(STATUS.UNKNOWN);
  });
  it("does not accept an unchanged old text as authority after amendment", () => {
    const f = fixture();
    f.effect.kind = K.AMENDS;
    expect(effectiveSourceStatus(f.source, f.graph, f.node.nodeId, [f.node.nodeId])).toBe(STATUS.UNKNOWN);
    expect(effectiveSourceStatus(f.source, f.graph, f.node.nodeId, [f.node.nodeId, f.sibling.nodeId])).toBe(STATUS.EFFECTIVE);
  });
  it("supports an explicit unconditional duty without inventing applicability findings", () => {
    const f = fixture();
    const anchor = f.graph.claims.find((c) => c.operative)!;
    const graph: LegalSemanticGraph = { ...f.graph, claims: [{ ...anchor, semanticFrame: { ...anchor.semanticFrame!, applicabilityMode: LEGAL_APPLICABILITY_MODES.UNCONDITIONAL } }], relations: [] };
    expect(authoringReadinessGaps(graph)).toEqual([]);
    delete graph.claims[0].semanticFrame!.applicabilityMode;
    expect(authoringReadinessGaps(graph).length).toBeGreaterThan(0);
  });
});
