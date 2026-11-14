import { describe, expect, it } from "@jest/globals";
import {
  preparationSourceUnitsRequestSchema,
  preparationSourceUnitsResponseSchema,
} from "../src/compliance-rule-set/preparation-source-units.ts";
import { LEGAL_DOCUMENT_NODE_TYPES } from "../src/legal-source/document-graph.ts";
import { SOURCE_REVIEW_STATES } from "../src/legal-source/review-frontier.ts";

const id = "31e042e8-6b91-4bfd-8853-108bb4436efd";
const hash = "a".repeat(64);

describe("Preparation Source Analysis contracts", () => {
  it("normalizes valid bounded query values and accepts the response projection", () => {
    expect(
      preparationSourceUnitsRequestSchema.parse({
        inventoryRevision: "3",
        limit: "20",
        search: " Điều 1 ",
      }),
    ).toMatchObject({ inventoryRevision: 3, limit: 20, search: "Điều 1" });

    const response = preparationSourceUnitsResponseSchema.parse({
      preparationRunId: id,
      legalSourceVersionId: id,
      inventoryRevision: 3,
      materializationId: hash,
      frontier: {
        revision: 2,
        fingerprint: "frontier-fingerprint",
        stateFingerprint: "state-fingerprint",
        stateAccumulator: "state-accumulator",
        frozenAt: null,
        coverage: {
          total: 1,
          pending: 1,
          inReview: 0,
          reviewedWithClaims: 0,
          reviewedNoClaims: 0,
          blockedReferences: 0,
          persistedClaims: 0,
        },
      },
      units: [
        {
          sourceNodeId: hash,
          legalSourceVersionId: id,
          materializationId: hash,
          documentId: "doc-1",
          nodeType: Object.values(LEGAL_DOCUMENT_NODE_TYPES)[0],
          parentNodeId: null,
          structuralPath: "document/section-1",
          ordinal: 0,
          label: "Section 1",
          title: "Example title",
          ancestors: [],
          state: Object.values(SOURCE_REVIEW_STATES)[0],
          disposition: null,
          claimCount: 0,
          claimIds: [],
          claimIdsTruncated: false,
          referenceCount: 0,
          blockedReferenceCount: 0,
          referencesBlocked: false,
          completedAt: null,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    expect(response.units).toHaveLength(1);
  });

  it.each([
    { inventoryRevision: "0" },
    { inventoryRevision: "1", limit: "101" },
    { inventoryRevision: "1", state: "UNRECOGNIZED" },
    { inventoryRevision: "1", cursor: "not a cursor" },
    { inventoryRevision: "1", search: "x".repeat(129) },
  ])("rejects malformed or out-of-bound queries %#", (query) => {
    expect(preparationSourceUnitsRequestSchema.safeParse(query).success).toBe(
      false,
    );
  });
});
