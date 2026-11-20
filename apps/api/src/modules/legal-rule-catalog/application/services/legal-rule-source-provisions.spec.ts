import { describe, expect, it } from "@jest/globals";
import { LegalEffectStatus } from "@prisma/client";
import { composeLegalSourceProvisions } from "./legal-rule-catalog.service.js";

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
