import { describe, expect, it } from "@jest/globals";
import { legalSemanticGraphSchema } from "@lcsp/contracts/compliance-rule-set";
import {
  SOURCE_REVIEW_DISPOSITIONS,
  SOURCE_REVIEW_STATES,
} from "@lcsp/contracts/legal-source";

import { projectCompletedReviewInventory } from "./claim-inventory-review-projection.js";

const sourceNodeId = "a".repeat(64);
const graph = legalSemanticGraphSchema.parse({
  contractVersion: "LEGAL_GRAPH_V3",
  materializationId: "b".repeat(64),
  legalSourceVersionId: "31e042e8-6b91-4bfd-8853-108bb4436efd",
  claims: [],
  relations: [],
  sourceAccounting: [],
  referenceAccounting: [],
});
const completed = {
  sourceNodeId,
  state: SOURCE_REVIEW_STATES.REVIEWED_NO_CLAIMS,
  claimIds: [] as string[],
  disposition: SOURCE_REVIEW_DISPOSITIONS.NO_RELEVANT_SEMANTIC_CLAIMS,
  reason: "Heading contains no independent obligation",
  completionFingerprint: "c".repeat(64),
  payload: {
    claims: [],
    identities: {},
    relations: [],
    referenceAccounting: [],
  },
};

describe("Completed review inventory projection", () => {
  it("uses stored source accounting and preserves the review frontier binding", () => {
    const result = projectCompletedReviewInventory(
      graph,
      { revision: 2, fingerprint: "d".repeat(64) },
      [completed],
    );

    expect(result.persistentGraph.sourceAccounting).toEqual([
      {
        sourceNodeId,
        claimIds: [],
        nonSemanticReason: completed.reason,
      },
    ]);
    expect(result.persistentGraph.reviewFrontier).toEqual(result.reviewBinding);
    expect(result.persistentIdentities).toEqual({});
    expect(graph.sourceAccounting).toEqual([]);
  });

  it("rejects malformed persisted evidence before constructing an inventory", () => {
    expect(() =>
      projectCompletedReviewInventory(
        graph,
        { revision: 2, fingerprint: "d".repeat(64) },
        [{ ...completed, payload: { claims: [], identities: {} } }],
      ),
    ).toThrow();
  });
});
