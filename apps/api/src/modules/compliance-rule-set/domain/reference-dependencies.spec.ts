import { describe, expect, it } from "@jest/globals";
import {
  SOURCE_REVIEW_STATES as S,
  REFERENCE_DEPENDENCY_STATES as D,
} from "@lcsp/contracts/legal-source";
import {
  dependencyModel,
  exploreDependencyModel,
  type ModelEdge,
} from "../../../../test/support/reference-dependency-model.js";
import {
  claimEndpointFingerprint,
  referenceDependencyView,
  invalidateDependentPayload,
} from "./reference-dependencies.js";
import { inventoryHash } from "./claim-inventory.js";
import {
  LEGAL_CLAIM_STATES as CS,
  LEGAL_SEMANTIC_RELATION_KINDS as RK,
  LEGAL_SEMANTIC_CLAIM_TYPES as CT,
  sourceReviewPayloadSchema,
} from "@lcsp/contracts/compliance-rule-set";

describe("reference dependency state space", () => {
  it("enumerates every directed simple topology through four units and every reachable acquisition ordering", () => {
    let graphs = 0,
      states = 0,
      transitions = 0,
      terminals = 0;
    for (let n = 1; n <= 4; n++) {
      const possible: ModelEdge[] = [];
      for (let from = 0; from < n; from++)
        for (let to = 0; to < n; to++)
          if (from !== to) possible.push({ from, to });
      for (let mask = 0; mask < 2 ** possible.length; mask++) {
        const result = exploreDependencyModel(
          n,
          possible.filter((_, index) => mask & (1 << index)),
        );
        graphs++;
        states += result.states;
        transitions += result.transitions;
        terminals += result.terminals;
        expect(result.terminals).toBeGreaterThan(0);
      }
    }
    console.log(
      JSON.stringify({
        STATE_SPACE_LIVENESS: "PASS",
        graphs,
        states,
        transitions,
        terminals,
        falseDeadlocks: 0,
      }),
    );
  }, 300000);

  it.each([
    [{ from: 0, to: 0 }],
    [
      { from: 0, to: 1 },
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ],
    [
      { from: 0, to: 1 },
      { from: 1, to: 0 },
      { from: 1, to: 2, material: false },
      { from: 2, to: 3 },
      { from: 3, to: 2 },
    ],
  ])(
    "handles self references, parallel edges and fixed mixed material decisions: %j",
    (...edges) => {
      expect(
        exploreDependencyModel(4, edges as ModelEdge[]).terminals,
      ).toBeGreaterThan(0);
    },
  );

  it("separates durable endpoint authority from review state, pins, identity and uncommitted drafts", () => {
    const m = dependencyModel(2, [{ from: 0, to: 1 }]);
    const target = m.rows[1];
    target.claimIds = m.claims[1].map((c) => c.claimId);
    const view = () =>
      referenceDependencyView(m.graph, m.rows, m.runId, 1).target(
        m.graph.references[0].referenceId,
      );
    expect(view().bindingCanProceed).toBe(false);
    target.state = S.BLOCKED_REFERENCE;
    target.completionFingerprint = inventoryHash(target.payload);
    expect(view()).toMatchObject({
      bindingCanProceed: true,
      targetReviewComplete: false,
      targetReviewState: S.BLOCKED_REFERENCE,
    });
    for (const state of [S.REOPENED, S.IN_REVIEW, S.REVIEWED_WITH_CLAIMS]) {
      target.state = state;
      expect(view().bindingCanProceed).toBe(true);
    }
    target.inventoryRevision++;
    expect(view().bindingCanProceed).toBe(false);
    target.inventoryRevision--;
    target.materializationId = "stale";
    expect(view().bindingCanProceed).toBe(false);
    target.materializationId = m.graph.materializationId;
    const payload = sourceReviewPayloadSchema.parse(target.payload);
    payload.identities[m.claims[1][0].claimId] = "wrong";
    payload.identities[m.claims[1][1].claimId] = "wrong";
    target.payload = payload;
    expect(view().bindingCanProceed).toBe(false);
  });

  it("keeps unresolved and unavailable targets truthful and reports a compact deadlock witness", () => {
    const m = dependencyModel(2, [{ from: 0, to: 1, resolved: false }]);
    const status = referenceDependencyView(m.graph, m.rows, m.runId, 1).target(
      m.graph.references[0].referenceId,
    );
    expect(status.classification).toBe(D.UNRESOLVED);
    expect(
      exploreDependencyModel(2, [{ from: 0, to: 1, resolved: false }])
        .prerequisiteWaits,
    ).toBeGreaterThan(0);
    expect(() =>
      exploreDependencyModel(
        2,
        [
          { from: 0, to: 1 },
          { from: 1, to: 0 },
        ],
        true,
      ),
    ).toThrow(/FALSE_DEADLOCK.*trace/u);
  });

  it("fingerprints semantic changes but ignores cosmetic whitespace and row lifecycle changes", () => {
    const m = dependencyModel(2, [{ from: 0, to: 1 }]);
    const claim = m.claims[1][0];
    const before = claimEndpointFingerprint(claim);
    expect(
      claimEndpointFingerprint({
        ...claim,
        statement: "  " + claim.statement.replaceAll(" ", "\n ") + " ",
      }),
    ).toBe(before);
    const operative = {
      ...claim,
      claimType: CT.DUTY,
      operative: {
        actor: "operator",
        modality: CT.DUTY,
        action: "keep records",
      },
    };
    for (const mutation of [
      { actor: "delegate" },
      { modality: CT.PROHIBITION },
      { action: "delete records" },
    ])
      expect(
        claimEndpointFingerprint({
          ...operative,
          operative: { ...operative.operative, ...mutation },
        }),
      ).not.toBe(claimEndpointFingerprint(operative));
    for (const mutation of [
      { statement: "Changed meaning" },
      {
        claimType: m.claims[0][0].claimType,
        state: CS.INTENTIONALLY_NON_OPERATIVE,
        nonOperativeReason: "Explicit exclusion",
      },
      { sourceNodeIds: [m.rows[0].sourceNodeId] },
    ])
      expect(claimEndpointFingerprint({ ...claim, ...mutation })).not.toBe(
        before,
      );
    const relation = {
      relationId: "r",
      fromClaimId: m.claims[0][0].claimId,
      toClaimId: claim.claimId,
      kind: RK.CROSS_REFERENCE,
      referenceId: m.graph.references[0].referenceId,
    } as const;
    const payload = {
      ...sourceReviewPayloadSchema.parse(m.rows[0].payload),
      relations: [relation],
    };
    const invalid = invalidateDependentPayload(
      payload,
      new Set([claim.claimId]),
    )!;
    expect(invalid.relations).toEqual([relation]);
    expect(invalid.invalidatedRelationIds).toEqual(["r"]);
    expect(invalid.referenceAccounting).toEqual([]);
    expect(
      invalidateDependentPayload(invalid, new Set([claim.claimId])),
    ).toEqual(invalid);
  });
});
