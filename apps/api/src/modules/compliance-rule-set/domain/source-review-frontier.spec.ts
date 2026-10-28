import { readFileSync } from "node:fs";
import {
  sourceReviewUnits,
  reviewReferenceOwners,
  reviewItemStateFingerprint,
  xorReviewHash,
  zeroReviewAccumulator,
  normalizeReviewPayload,
} from "./source-review-frontier.js";
import { retainedBindingCase } from "../../../../test/support/retained-reference-binding-fixture.js";
import { buildLegalDocumentGraph } from "../../legal-source/domain/document-graph.js";
import { SOURCE_REVIEW_STATES as S } from "@lcsp/contracts/legal-source";
import { inventoryHash } from "./claim-inventory.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../tests/fixtures/legal-graph/source.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { pages: string[] };
const graph = buildLegalDocumentGraph("00000000-0000-4000-8000-000000000001", [
  {
    documentId: "synthetic",
    title: "Synthetic",
    sourceSha256: "sha256:" + "a".repeat(64),
    snapshotPath: null,
    extraction: { pages: fixture.pages, pageCount: fixture.pages.length },
    chunks: [],
  },
]);
describe("Deterministic body review units", () => {
  it("derives all material relation IDs and drops stale material accounting after removal", () => {
    const { fixture, good } = retainedBindingCase();
    const payload = fixture.reviews.find(
      (r) => r.payload.relations.length,
    )!.payload;
    payload.relations = [
      good,
      { ...good, relationId: "second-canonical-binding" },
    ];
    payload.referenceAccounting = [];
    const projected = normalizeReviewPayload(payload);
    expect(projected.referenceAccounting[0].relationIds).toEqual(
      [good.relationId, "second-canonical-binding"].sort(),
    );
    expect(
      normalizeReviewPayload({ ...projected, relations: [good] })
        .referenceAccounting[0].relationIds,
    ).toEqual([good.relationId]);
    expect(
      normalizeReviewPayload({ ...projected, relations: [] })
        .referenceAccounting,
    ).toEqual([]);
  });
  it("retains Article titles as claim owners while excluding other empty structural containers", () => {
    expect(graph.nodes).toHaveLength(17);
    const units = sourceReviewUnits(graph);
    expect(units).toHaveLength(14);
    expect(units.some((n) => n.structuralPath.endsWith("/article/1"))).toBe(
      true,
    );
    expect(
      units.some((n) => n.structuralPath.endsWith("/article/6/paragraph/2")),
    ).toBe(true);
    expect(units.some((n) => n.structuralPath.endsWith("/article/6"))).toBe(
      true,
    );
    expect([...reviewReferenceOwners(graph).values()].every(Boolean)).toBe(
      true,
    );
  });
  it("does not drop an operative parent intro or a source-bearing single-line leaf", () => {
    const units = sourceReviewUnits({
      nodes: graph.nodes.map((n) =>
        n.structuralPath.endsWith("/article/6")
          ? {
              ...n,
              content:
                n.content +
                "\nA covered service is subject to both following paragraphs.",
            }
          : n,
      ),
    });
    expect(units).toHaveLength(14);
    const leaf = graph.nodes.find((n) =>
      n.structuralPath.endsWith("/article/1"),
    )!;
    expect(
      sourceReviewUnits({
        nodes: [
          {
            ...leaf,
            parentNodeId: null,
            content: "A source-bearing one-line definition",
          },
        ],
      }),
    ).toHaveLength(1);
  });
  it("state aggregation is order independent and returns to the same effective fingerprint after a cycle", () => {
    const nodes = ["a", "b", "c"];
    const values = nodes.map((sourceNodeId) =>
      reviewItemStateFingerprint({ sourceNodeId, state: S.PENDING }),
    );
    const before = values.reduce(xorReviewHash, zeroReviewAccumulator);
    expect(
      [...values].reverse().reduce(xorReviewHash, zeroReviewAccumulator),
    ).toBe(before);
    const inReview = reviewItemStateFingerprint({
      sourceNodeId: "b",
      state: S.IN_REVIEW,
    });
    const after = xorReviewHash(xorReviewHash(before, values[1]), inReview);
    expect(after).not.toBe(before);
    expect(xorReviewHash(xorReviewHash(after, inReview), values[1])).toBe(
      before,
    );
  });
  it("derives and aggregates thousands of units without repeated graph scans", () => {
    const leaf = graph.nodes.find((n) =>
      n.structuralPath.endsWith("/article/1"),
    )!;
    const nodes = Array.from({ length: 4000 }, (_, i) => ({
      ...leaf,
      nodeId: inventoryHash(i),
      parentNodeId: null,
    }));
    const start = performance.now();
    expect(sourceReviewUnits({ nodes })).toHaveLength(4000);
    expect(performance.now() - start).toBeLessThan(1000);
  });
  it("explanation wording does not alter effective review state", () => {
    const payload = {
      claims: [],
      identities: {},
      relations: [],
      referenceAccounting: [
        {
          referenceId: "a".repeat(64),
          material: false,
          relationIds: [],
          nonMaterialReason: "First explanation",
        },
      ],
    };
    const first = reviewItemStateFingerprint({
      sourceNodeId: "node",
      state: S.REVIEWED_NO_CLAIMS,
      reason: "No claim",
      payload,
    });
    payload.referenceAccounting[0].nonMaterialReason =
      "Same disposition with another explanation";
    expect(
      reviewItemStateFingerprint({
        sourceNodeId: "node",
        state: S.REVIEWED_NO_CLAIMS,
        reason: "Another reason",
        payload,
      }),
    ).toBe(first);
  });
});
