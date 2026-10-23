import { describe, expect, it } from "@jest/globals";
import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_SEMANTIC_GRAPH_VERSION,
  type LegalSemanticGraph,
} from "@lcsp/contracts/compliance-rule-set";
import { retainedBindingCase } from "../../../../test/support/retained-reference-binding-fixture.js";
import {
  semanticReferenceBindings,
  materialReferenceAccounting,
} from "./semantic-reference-binding.js";
import { validateSemanticClaimGraph } from "./semantic-claim-integrity.validator.js";

describe("retained structural reference binding authority", () => {
  it("rejects the exact live relation and supplies bounded canonical repair candidates", () => {
    const { fixture, bad, claims } = retainedBindingCase();
    const failure = semanticReferenceBindings(fixture.graph).failure(
      bad,
      new Map(claims.map((c) => [c.claimId, c])),
    )!;
    expect(failure.code).toBe(F.SEMANTIC_DEPENDENCY_DETACHED);
    expect(failure.targetClaimIds).toEqual([
      "12ff1db191f504d0aaca9f8fc0cd7088e2c3b2973aa8ec26b5726901e30b188a",
    ]);
    expect(failure.requiredAction).toBe("inspect_semantic_reference_binding");
  });

  it("shares exact direction and subtree semantics with final integrity", () => {
    const { fixture, good, bad, claims } = retainedBindingCase();
    const unrelated = claims.find(
      (c) =>
        ![good.fromClaimId, good.toClaimId, bad.toClaimId].includes(c.claimId),
    )!;
    const cases = [
      [good.fromClaimId, good.toClaimId, true],
      [good.toClaimId, good.fromClaimId, false],
      [good.fromClaimId, bad.toClaimId, false],
      [good.toClaimId, good.toClaimId, false],
      [unrelated.claimId, good.toClaimId, false],
      [good.fromClaimId, unrelated.claimId, false],
    ] as const;
    for (const descendant of [false, true]) {
      if (descendant)
        for (const [index, cid] of [
          good.fromClaimId,
          good.toClaimId,
        ].entries()) {
          const claim = claims.find((c) => c.claimId === cid)!;
          const parent = fixture.graph.nodes.find(
            (n) => n.nodeId === claim.sourceNodeIds[0],
          )!;
          const nodeId = (index ? "b" : "a").repeat(64);
          fixture.graph.nodes.push({
            ...parent,
            nodeId,
            parentNodeId: parent.nodeId,
            structuralPath: parent.structuralPath + "/paragraph/2",
            content: "",
            label: "2",
          });
          claim.sourceNodeIds = [nodeId, parent.nodeId];
        }
      for (const [fromClaimId, toClaimId, valid] of cases) {
        const relation = { ...good, fromClaimId, toClaimId };
        const semantic: LegalSemanticGraph = {
          contractVersion: LEGAL_SEMANTIC_GRAPH_VERSION,
          legalSourceVersionId: fixture.graph.legalSourceVersionId,
          materializationId: fixture.graph.materializationId,
          claims,
          relations: [relation],
          sourceAccounting: fixture.reviews.map((r) => ({
            sourceNodeId: r.sourceNodeId,
            claimIds: r.claimIds,
            nonSemanticReason: r.claimIds.length ? null : r.reason,
          })),
          referenceAccounting: fixture.graph.references.map(
            (r) =>
              materialReferenceAccounting(r.referenceId, [relation]) ?? {
                referenceId: r.referenceId,
                material: false,
                relationIds: [],
                nonMaterialReason: "No scripted semantic dependency",
              },
          ),
        };
        const result = validateSemanticClaimGraph(
          {
            semanticGraph: semantic,
            legalRequirements: [],
            assessmentRules: [],
            contextRelations: [],
          },
          {
            legalSourceVersionId: fixture.graph.legalSourceVersionId,
            chunks: [],
            retrievalIndexValid: true,
            documentGraph: fixture.graph,
          },
          true,
        );
        expect(
          semanticReferenceBindings(fixture.graph).failure(
            relation,
            new Map(claims.map((c) => [c.claimId, c])),
          ) === null,
        ).toBe(valid);
        expect(
          result.failures.some(
            (f) => f.code === F.SEMANTIC_DEPENDENCY_DETACHED,
          ),
        ).toBe(!valid);
      }
    }
  });
});
