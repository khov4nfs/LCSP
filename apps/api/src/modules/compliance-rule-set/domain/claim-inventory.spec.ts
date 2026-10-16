import { describe, expect, it } from "@jest/globals";
import { COMPLIANCE_RULE_SET_FAILURE_CODES as F } from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  validPacket,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import { canonicalInventoryFixture } from "../../../../test/support/canonical-claim-inventory-fixture.js";
import {
  canonicalClaimId,
  inventoryFingerprint,
  validateClaimInventory,
  validateFrozenInventory,
} from "./claim-inventory.js";
import { validateSemanticClaimGraph } from "./semantic-claim-integrity.validator.js";
const RUN = "00000000-0000-4000-8000-000000000009";
function fixture() {
  const packet = validPacket();
  const inventory = canonicalInventoryFixture(packet, RUN);
  return { packet, ...inventory, source: fixtureLegalSource() };
}
describe("Frozen Preparation claim inventory", () => {
  it("validates discovery independently of Requirements and Rule accounting", () => {
    const f = fixture();
    expect(
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures,
    ).toEqual([]);
    const discovery = validateClaimInventory(
      RUN,
      1,
      f.graph,
      f.identities,
      f.source,
    ).coverage.semanticClaims;
    expect(discovery.accounted).toBe(0);
    expect(discovery.unaccounted).toBe(discovery.relevant);
    f.packet.legalRequirements = [];
    f.packet.assessmentRules = [];
    expect(
      validateSemanticClaimGraph(f.packet, f.source).failures.some(
        (g) => g.code === F.UNACCOUNTED_SEMANTIC_CLAIM,
      ),
    ).toBe(true);
  });
  it("canonical identity survives ordering, normalization and prose edits but changes revision", () => {
    expect(canonicalClaimId(RUN, 1, ["b", "a"], "  Duty   A ")).toBe(
      canonicalClaimId(RUN, 1, ["a", "b"], "duty a"),
    );
    expect(canonicalClaimId(RUN, 1, ["a"], "duty a")).not.toBe(
      canonicalClaimId(RUN, 2, ["a"], "duty a"),
    );
    const f = fixture(),
      id = f.graph.claims[0].claimId;
    f.graph.claims[0].statement += " clarified wording";
    expect(
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures,
    ).toEqual([]);
    expect(f.graph.claims[0].claimId).toBe(id);
  });
  it("fingerprint ignores set ordering, retaining all claim and relation meaning", () => {
    const f = fixture(),
      expected = inventoryFingerprint(1, f.graph);
    f.graph.claims.reverse();
    f.graph.sourceAccounting.reverse();
    f.graph.relations.reverse();
    f.graph.claims.forEach((c) => c.sourceNodeIds.reverse());
    f.graph.sourceAccounting.forEach((r) => r.claimIds.reverse());
    expect(inventoryFingerprint(1, f.graph)).toBe(expected);
    f.graph.claims[0].statement += " changed";
    expect(inventoryFingerprint(1, f.graph)).not.toBe(expected);
  });
  it("requires every source-bearing node's explicit review", () => {
    const f = fixture();
    f.graph.sourceAccounting.pop();
    expect(
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures,
    ).toContainEqual(
      expect.objectContaining({ code: F.INCOMPLETE_STRUCTURAL_ACCOUNTING }),
    );
  });
  it("rejects unknown provenance, foreign source pins and broken relations before freezing", () => {
    const f = fixture();
    f.graph.claims[0].sourceNodeIds = ["foreign-node"];
    f.graph.legalSourceVersionId = "00000000-0000-4000-8000-000000000002";
    f.graph.relations.push({
      relationId: "broken",
      fromClaimId: "missing",
      toClaimId: f.graph.claims[0].claimId,
      kind: "CONDITION",
      referenceId: null,
    });
    const result = validateClaimInventory(
      RUN,
      1,
      f.graph,
      f.identities,
      f.source,
    );
    expect(
      result.failures.filter((g) => g.code === F.SEMANTIC_CLAIM_INVALID).length,
    ).toBeGreaterThanOrEqual(3);
  });
  it("rejects duplicate structured normative identities even under different stable keys", () => {
    const f = fixture(),
      original = f.graph.claims.find((c) => c.operative)!;
    const id = canonicalClaimId(RUN, 1, original.sourceNodeIds, "duplicate");
    f.graph.claims.push({ ...original, claimId: id });
    f.identities[id] = "duplicate";
    f.graph.sourceAccounting.forEach((r) => {
      if (original.sourceNodeIds.includes(r.sourceNodeId)) r.claimIds.push(id);
    });
    expect(
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures,
    ).toContainEqual(
      expect.objectContaining({
        detail: "Duplicate structured claim identity",
      }),
    );
  });
  it("rejects missing freeze, stale revisions, graph edits and stale Requirement bindings", () => {
    const f = fixture(),
      frozen = { ...f.binding, graph: structuredClone(f.graph) };
    expect(validateFrozenInventory(f.packet, frozen, 1)).toEqual([]);
    expect(validateFrozenInventory(f.packet, null, 1)[0].code).toBe(
      F.claimInventoryRequired,
    );
    expect(validateFrozenInventory(f.packet, frozen, 2)[0].code).toBe(
      F.staleInventoryBinding,
    );
    f.packet.legalRequirements[0].claimInventoryRevision = 2;
    expect(validateFrozenInventory(f.packet, frozen, 1)[0].code).toBe(
      F.staleInventoryBinding,
    );
    f.packet.legalRequirements[0].claimInventoryRevision = 1;
    f.graph.claims[0].claimType = "CONTEXT";
    expect(validateFrozenInventory(f.packet, frozen, 1)[0].code).toBe(
      F.staleInventoryBinding,
    );
  });
  it("validates thousands of claims and reference relations with bounded indexed passes", () => {
    const f = fixture(),
      seed = f.graph.claims[0],
      nodes = seed.sourceNodeIds;
    f.graph.claims = [];
    f.graph.relations = [];
    const identities: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {
      const key = `context.${i}`,
        id = canonicalClaimId(RUN, 1, nodes, key);
      identities[id] = key;
      f.graph.claims.push({
        ...seed,
        claimId: id,
        claimType: "CONTEXT",
        operative: null,
        statement: key,
      });
      if (i)
        f.graph.relations.push({
          relationId: `relation-${i}`,
          kind: "CONDITION",
          fromClaimId: f.graph.claims[i - 1].claimId,
          toClaimId: id,
          referenceId: null,
        });
    }
    f.graph.sourceAccounting = f.graph.sourceAccounting.map((review) => ({
      ...review,
      claimIds: nodes.includes(review.sourceNodeId)
        ? f.graph.claims.map((c) => c.claimId)
        : [],
      nonSemanticReason: nodes.includes(review.sourceNodeId)
        ? null
        : "No further semantic material in this scripted scale fixture",
    }));
    const started = performance.now();
    expect(
      validateClaimInventory(RUN, 1, f.graph, identities, f.source).failures,
    ).toEqual([]);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
