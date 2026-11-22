import { describe, expect, it } from "@jest/globals";
import { LegalEffectStatus, LegalSourceLifecycleStatus } from "@prisma/client";
import { LEGAL_REFERENCE_RESOLUTION_STATES as ReferenceStates } from "@lcsp/contracts/legal-source";
import {
  LEGAL_RULE_REFERENCE_PREVIEW_LIMITS as ReferenceLimits,
  legalRuleSourceProvisionPageSchema,
} from "@lcsp/contracts/legal-rule-catalog";
import { buildLegalDocumentGraph } from "../../../legal-source/domain/document-graph.js";
import {
  composeLegalSourceProvisions,
  LegalRuleCatalogService,
} from "./legal-rule-catalog.service.js";

const documentId = "134-2025-QH15";
const clauseLeadIn =
  "Nhà cung cấp hệ thống trí tuệ nhân tạo có rủi ro cao có trách nhiệm sau đây:";
const hierarchy = {
  articleNumber: 14,
  articleTitle: "Quản lý hệ thống trí tuệ nhân tạo có rủi ro cao",
  clauseNumber: 1,
  clauseHeading: `1. ${clauseLeadIn}`,
  clauseLeadIn,
};

function chunk(
  locator: string,
  content: string,
  legalEffectStatus: LegalEffectStatus = LegalEffectStatus.EFFECTIVE,
) {
  return {
    id: locator,
    documentId,
    locator,
    content,
    contentSha256: `hash-${locator}`,
    hierarchy,
    legalEffectStatus,
  };
}

const principle = {
  ...chunk(
    "art-4::cl-1",
    "1. Lấy con người làm trung tâm; bảo đảm quyền con người.",
  ),
  hierarchy: { articleNumber: 4, clauseNumber: 1 },
};
const point = chunk(
  "art-14::cl-1::pt-d",
  "d) Thiết kế hệ thống bảo đảm khả năng giám sát và can thiệp của con người đối với hệ thống;",
);
const sibling = chunk("art-14::cl-1::pt-g", "g) Phối hợp trong kiểm tra.");
const article = chunk("art-14", `Điều 14. ${hierarchy.articleTitle}`);

describe("source provisions for selected preparation", () => {
  it("adds resolved, ambiguous and missing reference previews while keeping import citations exact", async () => {
    // Use extracted pages and the real resolver so the test covers chunk-to-node mapping.
    const sourceVersionId = "00000000-0000-4000-8000-000000000001";
    const referencedLeadIn = "Áp dụng Điều 21 theo các yêu cầu sau:";
    const sourcePoint = {
      ...point,
      content:
        "d) Áp dụng khoản 1 Điều 18; xem Điều 99; xem Điều 20; áp dụng khoản 9 Điều 3 của Luật số 71/2025/QH15.",
      hierarchy: {
        ...hierarchy,
        clauseLeadIn: referencedLeadIn,
        clauseHeading: `1. ${referencedLeadIn}`,
      },
      pageStart: null,
      pageEnd: null,
    };
    const title = "Luật Trí tuệ nhân tạo";
    const foreignTitle = "Luật số 71/2025/QH15";
    const foreignId = "71-2025-QH15";
    const graph = buildLegalDocumentGraph(sourceVersionId, [
      {
        documentId,
        title,
        sourceSha256: "fixture",
        snapshotPath: "fixture.txt",
        extraction: {
          pages: [
            `${article.content}\n1. ${referencedLeadIn}\n${sourcePoint.content}\nĐiều 18. Giám sát\n1. Thực hiện như sau:\na) Lưu hồ sơ giám sát.\nĐiều 20. Quy định thứ nhất\nNội dung thứ nhất.\nĐiều 20. Quy định thứ hai\nNội dung thứ hai.\nĐiều 21. Hồ sơ\nLưu hồ sơ theo hướng dẫn.`,
          ],
        },
        chunks: [sourcePoint],
      },
      {
        documentId: foreignId,
        title: foreignTitle,
        sourceSha256: "foreign-fixture",
        snapshotPath: "foreign.txt",
        extraction: {
          pages: [
            `Điều 3. Quy định đích\n9. ${"Nội dung nguồn. ".repeat(120)}`,
          ],
        },
        chunks: [],
      },
    ]);
    // Resolve the fixtures as promises to match the Prisma query contract.
    const prisma = {
      legalSourceVersion: {
        findUnique: () =>
          Promise.resolve({
            id: sourceVersionId,
            status: LegalSourceLifecycleStatus.ACTIVE,
            retrievalIndexes: [{}],
          }),
      },
      legalSourceDocument: {
        findUnique: () => Promise.resolve({ documentId, title }),
      },
      legalDocumentChunk: { findMany: () => Promise.resolve([sourcePoint]) },
    };
    const service = Reflect.construct(LegalRuleCatalogService, [
      prisma,
      {},
      {
        // Check the requested identifiers before resolving the graph fixture.
        referenceEvidence: (
          version: string,
          document: string,
          chunkIds: string[],
        ) => {
          expect([version, document, chunkIds]).toEqual([
            sourceVersionId,
            documentId,
            [sourcePoint.id],
          ]);
          return Promise.resolve(graph);
        },
      },
    ]) as LegalRuleCatalogService;
    const page = await service.sourceProvisions(
      { sourceVersionId, documentId, page: 1, pageSize: 1 },
      "test",
    );
    expect(legalRuleSourceProvisionPageSchema.safeParse(page).success).toBe(
      true,
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        locator: sourcePoint.locator,
        citationLocatorRefs: [{ documentId, locator: sourcePoint.locator }],
        referenceContext: [
          expect.objectContaining({
            resolutionState: ReferenceStates.RESOLVED,
            target: expect.objectContaining({
              documentId,
              excerpt: expect.stringContaining("Lưu hồ sơ giám sát."),
            }),
          }),
          expect.objectContaining({
            resolutionState: ReferenceStates.UNRESOLVED,
            target: null,
          }),
          expect.objectContaining({
            resolutionState: ReferenceStates.AMBIGUOUS,
            target: null,
          }),
          expect.objectContaining({
            resolutionState: ReferenceStates.RESOLVED,
            target: expect.objectContaining({
              documentId: foreignId,
              documentTitle: foreignTitle,
              locator: expect.stringContaining("/article/3/clause/9"),
              truncated: true,
            }),
          }),
          expect.objectContaining({
            text: "Điều 21",
            resolutionState: ReferenceStates.RESOLVED,
            target: expect.objectContaining({
              excerpt: expect.stringContaining("Lưu hồ sơ theo hướng dẫn."),
            }),
          }),
        ],
      }),
    ]);
    expect(page.items[0].referenceContext?.[3].target?.excerpt.length).toBe(
      ReferenceLimits.excerptCharacters,
    );
  });

  it("pins the selected point and exact effective ancestor chunks only", () => {
    const { items } = composeLegalSourceProvisions({
      sourceVersionId: "source",
      documentId,
      documentTitle: "Luật Trí tuệ nhân tạo",
      chunks: [
        principle,
        article,
        chunk("art-14::cl-1", `1. ${clauseLeadIn}`),
        point,
        sibling,
      ],
    });
    expect(
      items.find((item) => item.locator === point.locator)?.citationLocatorRefs,
    ).toEqual(
      [point.locator, "art-14::cl-1", article.locator].map((locator) => ({
        documentId,
        locator,
      })),
    );
    expect(
      items.find((item) => item.locator === principle.locator)
        ?.citationLocatorRefs,
    ).toEqual([{ documentId, locator: principle.locator }]);
  });

  it("does not use an absent or non-effective lead-in as a pinned citation", () => {
    for (const chunks of [
      [point],
      [
        point,
        chunk("art-14::cl-1", `1. ${clauseLeadIn}`, LegalEffectStatus.UNKNOWN),
      ],
    ]) {
      const { items } = composeLegalSourceProvisions({
        sourceVersionId: "source",
        documentId,
        documentTitle: "Luật Trí tuệ nhân tạo",
        chunks,
      });
      expect(
        items.find((item) => item.locator === point.locator)
          ?.citationLocatorRefs,
      ).toEqual([{ documentId, locator: point.locator }]);
    }
  });
});
