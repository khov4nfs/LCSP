import { describe, expect, it, jest } from "@jest/globals";
import { PDFParse } from "pdf-parse";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
} from "@lcsp/contracts/assessment-domain";
import {
  assessmentFinalReportV2Schema,
  type AssessmentFinalReportV2,
} from "@lcsp/contracts/assessment-report";
import { AssessmentPdfRenderer } from "./assessment-pdf-renderer.service.js";
import { legalLocator } from "./assessment-report-v2-pdf-presentation.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const snapshotId = "22222222-2222-4222-8222-222222222222";
const factId = "33333333-3333-4333-8333-333333333333";
const sha = `sha256:${"a".repeat(64)}`;

function fixture(): AssessmentFinalReportV2 {
  const decision = {
    assessmentRuleId: "rule-1",
    assessmentRuleVersion: "1",
    scopeId: "ASSESSMENT",
    ruleSetVersionId: uuid,
    repositorySnapshotId: snapshotId,
    repositoryCommit: "a".repeat(40),
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: "requirement-1" }],
    applicability: "APPLICABLE" as const,
    rationale: "Accepted rationale",
    references: [{ type: "CONFIRMED_FACT" as const, factId, caseRevision: 1 }],
    criteria: [
      {
        criterionId: "criterion-1",
        outcome: "MET" as const,
        rationale: "Accepted criterion rationale",
        references: [
          { type: "CONFIRMED_FACT" as const, factId, caseRevision: 1 },
        ],
      },
    ],
    compliance: "COMPLIANT" as const,
  };
  return assessmentFinalReportV2Schema.parse({
    schemaVersion: ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
    artifactId: uuid,
    assessmentId: uuid,
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    identity: {
      repositorySnapshotId: snapshotId,
      repositoryCommit: "a".repeat(40),
    },
    pins: {
      legalSourceVersionId: uuid,
      legalSourceVersion: "LAW-1",
      ruleSetVersionId: uuid,
      ruleSetVersion: "RULES-1",
      ruleSetDigest: "b".repeat(64),
      repositorySnapshotId: snapshotId,
      repositoryScanJobId: "scan-1",
      repositoryCommit: "a".repeat(40),
    },
    caseRevision: 1,
    decisionFingerprint: sha,
    legalRequirements: [
      {
        legalRequirementId: "requirement-1",
        title: "Data duty",
        proposition: "Keep data safely.",
        applicabilityConditions: ["The duty applies."],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        coverageState: "COVERED_BY_ASSESSMENT_RULES",
        sourceRefs: [
          {
            legalSourceVersionId: uuid,
            legalSourceVersion: "LAW-1",
            documentId: "doc-1",
            locator: "article-1",
            contentSha256: sha,
          },
        ],
      },
    ],
    ruleDetails: [
      {
        assessmentRuleId: "rule-1",
        assessmentRuleVersion: "1",
        legalRequirementIds: ["requirement-1"],
        concept: "Data",
        legalIntent: "Protect data",
        applicabilityGuidance: "Apply when relevant.",
        criteria: [{ criterionId: "criterion-1", statement: "Criterion" }],
        decisionId: uuid,
        decisionRevision: 1,
        decision,
        decisionReferences: [
          {
            origin: "DECISION",
            reference: { type: "CONFIRMED_FACT", factId, caseRevision: 1 },
          },
        ],
        criteriaDecisions: [
          {
            criterionId: "criterion-1",
            statement: "Criterion",
            outcome: "MET",
            rationale: "Accepted criterion rationale",
            references: [
              {
                origin: "CRITERION",
                reference: { type: "CONFIRMED_FACT", factId, caseRevision: 1 },
              },
            ],
          },
        ],
        narrative: {
          summary: "Accepted summary",
          recommendations: ["Review controls."],
        },
        factIds: [factId],
        evidenceIds: [],
        sourceRefs: [
          {
            legalSourceVersionId: uuid,
            legalSourceVersion: "LAW-1",
            documentId: "doc-1",
            locator: "article-1",
            contentSha256: sha,
          },
        ],
      },
    ],
    factIndex: [
      {
        factId,
        caseRevision: 1,
        kind: "FACT",
        authority: "HUMAN_PROVIDED",
        statement: "Accepted fact",
        evidenceIds: [],
      },
    ],
    evidenceIndex: [],
    outcomeSummary: {
      totalRules: 1,
      applicableCompliant: 1,
      applicableNonCompliant: 0,
      notApplicable: 0,
    },
    boundedNarrative: {
      summary: "Summary",
      actionPlan: [],
      scopeLimitations: [],
    },
    publicationProvenance: { sourceManifestDigest: null, publishedAt: null },
  });
}

function idFor(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function sourceBackedFixture(
  count: number,
  outcomes: Array<"COMPLIANT" | "NON_COMPLIANT" | "NOT_APPLICABLE">,
): AssessmentFinalReportV2 {
  const base = fixture();
  const requirementIds = Array.from(
    { length: count },
    (_, index) => `requirement-${index + 1}`,
  );
  const ruleDetails = requirementIds.map((requirementId, index) => {
    const detail = structuredClone(base.ruleDetails[0]);
    const ruleId = `rule-${index + 1}`;
    const outcome = outcomes[index] ?? "COMPLIANT";
    detail.assessmentRuleId = ruleId;
    detail.decisionId = idFor(index + 10);
    detail.legalRequirementIds = [requirementId];
    detail.sourceRefs[0].documentId = `doc-${index + 1}`;
    detail.sourceRefs[0].locator = `article-${index + 1}`;
    detail.decision.assessmentRuleId = ruleId;
    detail.decision.legalContextRefs = [{ legalContextId: requirementId }];
    detail.decision.applicability =
      outcome === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "APPLICABLE";
    detail.decision.compliance = outcome === "NOT_APPLICABLE" ? null : outcome;
    detail.decision.criteria =
      outcome === "NOT_APPLICABLE" ? [] : detail.decision.criteria;
    if (outcome === "NON_COMPLIANT") {
      detail.decision.criteria[0].outcome = "NOT_MET";
      detail.criteriaDecisions[0].outcome = "NOT_MET";
    }
    detail.criteriaDecisions =
      outcome === "NOT_APPLICABLE" ? [] : detail.criteriaDecisions;
    return detail;
  });
  const legalRequirements = requirementIds.map((requirementId, index) => {
    const requirement = structuredClone(base.legalRequirements[0]);
    requirement.legalRequirementId = requirementId;
    requirement.title = `Source-backed obligation ${index + 1}`;
    requirement.proposition = `Source-backed proposition ${index + 1}`;
    requirement.sourceRefs[0].documentId = `doc-${index + 1}`;
    requirement.sourceRefs[0].locator = `article-${index + 1}`;
    return requirement;
  });
  const report = structuredClone(base);
  report.legalRequirements = legalRequirements;
  report.ruleDetails = ruleDetails;
  report.outcomeSummary = {
    totalRules: count,
    applicableCompliant: outcomes.filter((item) => item === "COMPLIANT").length,
    applicableNonCompliant: outcomes.filter((item) => item === "NON_COMPLIANT")
      .length,
    notApplicable: outcomes.filter((item) => item === "NOT_APPLICABLE").length,
  };
  return assessmentFinalReportV2Schema.parse(report);
}

async function assertFooterPagination(bytes: Buffer): Promise<void> {
  const parser = new PDFParse({ data: bytes });
  const extracted = await parser.getText();
  await parser.destroy();

  expect(extracted.pages).toHaveLength(extracted.total);
  // The renderer labels every physical page in Vietnamese and reports the
  // same total page count in the footer.
  const footerPattern = /Trang (\d+) trên (\d+)/g;
  const footerMatches = extracted.pages.flatMap((page) => [
    ...page.text.matchAll(footerPattern),
  ]);
  expect(footerMatches).toHaveLength(extracted.total);

  extracted.pages.forEach((page, index) => {
    expect(page.text).toMatch(
      new RegExp(`Trang ${index + 1} trên ${extracted.total}`),
    );
    const withoutFooter = page.text.replace(footerPattern, "").trim();
    expect(withoutFooter.length).toBeGreaterThan(0);
  });
}

describe("AssessmentPdfRenderer", () => {
  jest.setTimeout(30_000);

  const render = async (
    report: ReturnType<typeof fixture>,
    options: {
      preview?: boolean;
      translations?: Readonly<Record<string, string>>;
    } = {},
  ) => {
    const renderer = new AssessmentPdfRenderer();
    try {
      return await renderer.render(report, options);
    } finally {
      await renderer.onModuleDestroy();
    }
  };

  it("renders a valid non-empty PDF from the shared V2 projection", async () => {
    const bytes = await render(fixture());
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
    const text = bytes.toString("latin1");
    expect(text).toContain("/Type /Catalog");
  });

  it("localizes the three authoritative outcomes and labels preview data", async () => {
    const report = sourceBackedFixture(3, [
      "COMPLIANT",
      "NON_COMPLIANT",
      "NOT_APPLICABLE",
    ]);
    const bytes = await render(report, { preview: true });
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const mainContent = extracted.text.split(
      "Phụ lục — Bảng truy vết kỹ thuật",
    )[0];

    expect(extracted.text).toContain("BẢN XEM TRƯỚC — DỮ LIỆU MINH HỌA");
    expect(mainContent).toContain("Áp dụng");
    expect(mainContent).toContain("Đáp ứng");
    expect(mainContent).toContain("Chưa đáp ứng");
    expect(mainContent).toContain("Không áp dụng");
    expect(mainContent).toContain("Không đánh giá do nghĩa vụ không áp dụng");
    expect(mainContent).not.toContain("COMPLIANT");
    expect(mainContent).not.toContain("NON_COMPLIANT");
    expect(mainContent).not.toContain("NOT_APPLICABLE");
    expect(mainContent).not.toContain("LegalRequirement:");
    expect(mainContent).not.toMatch(/criterion_[a-f0-9]{8,}/iu);
    expect(mainContent).toContain("Mã tiêu chí [TC-01]");
    expect(extracted.text).toContain("Mã tiêu chí gốc");
    expect(extracted.text.replace(/\s+/gu, "")).toContain(sha);
    expect(extracted.pages.at(-1)?.text.length).toBeGreaterThan(100);
  });

  it("preserves Vietnamese sections and canonical values in extracted PDF text", async () => {
    const report = sourceBackedFixture(3, [
      "COMPLIANT",
      "NON_COMPLIANT",
      "NOT_APPLICABLE",
    ]);
    const bytes = await render(report);
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    expect(extracted.total).toBeGreaterThan(1);
    expect(extracted.text).toContain("ĐÁNH GIÁ DỰA TRÊN NGUỒN VÀ BẰNG CHỨNG");
    expect(extracted.text).toContain(
      "Không áp dụng không đồng nghĩa với Đáp ứng.",
    );
    expect(extracted.text).toContain("KẾT QUẢ ĐÁNH GIÁ");
    expect(extracted.text).toContain("Kho mã nguồn được đánh giá");
    expect(extracted.text).toContain("Phiên bản báo cáo");
    expect(extracted.text).toContain("Mã đánh giá:");
    expect(extracted.text).not.toContain("Publication state");
    expect(extracted.text).not.toContain("Traceability IDs");
    expect(extracted.text).toContain("DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG");
    expect(extracted.text).toContain("CHI TIẾT TỪNG NGHĨA VỤ");
    expect(extracted.text).toMatch(/rul(?:e|\u1eb9)-1/);
    expect(extracted.text).toMatch(/rul(?:e|\u1eb9)-2/);
    expect(extracted.text).toMatch(/art(?:icle|.{1,4})-2/);
    expect(extracted.text.replace(/\s+/gu, "")).toContain(sha);
    expect(extracted.text).toContain(
      "Chưa xác định được chế độ áp dụng trong định nghĩa quy tắc",
    );
    expect(extracted.text).toMatch(/Kh.ng áp d/);
    await assertFooterPagination(bytes);
  });

  it("shows reviewed Vietnamese title, criterion, rationale and fact in the main report", async () => {
    const report = fixture();
    const translations = {
      "Data duty": "Nghĩa vụ bảo vệ dữ liệu",
      "Keep data safely.": "Bảo vệ dữ liệu theo yêu cầu pháp lý.",
      Criterion: "Có biện pháp bảo vệ dữ liệu phù hợp",
      "Accepted rationale":
        "Dữ kiện được chấp nhận cho thấy biện pháp đã được ghi nhận.",
      "Accepted criterion rationale":
        "Hồ sơ đã chấp nhận ghi nhận kết quả đạt tiêu chí.",
      "Accepted fact": "Thông tin về biện pháp do khách hàng cung cấp.",
    };
    const decisionFingerprint = report.decisionFingerprint;
    const bytes = await render(report, { preview: true, translations });
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const mainContent = extracted.text.split(
      "Phụ lục — Bảng truy vết kỹ thuật",
    )[0];

    expect(mainContent).toContain("Nghĩa vụ bảo vệ dữ liệu");
    expect(mainContent).toContain("Có biện pháp bảo vệ dữ liệu phù hợp");
    expect(mainContent).toContain("biện pháp đã được ghi nhận");
    expect(mainContent).toContain(
      "Thông tin về biện pháp do khách hàng cung cấp",
    );
    expect(mainContent.replace(/\s+/gu, " ")).toContain(
      "không phải bằng chứng độc lập từ mã nguồn",
    );
    expect(extracted.text).toContain("Accepted criterion rationale");
    expect(report.decisionFingerprint).toBe(decisionFingerprint);
    expect(report.outcomeSummary).toEqual({
      totalRules: 1,
      applicableCompliant: 1,
      applicableNonCompliant: 0,
      notApplicable: 0,
    });
  });

  it("formats Vietnamese legal point locators including đ", () => {
    expect(legalLocator("art-11::cl-1::pt-đ")).toBe("Điều 11, khoản 1, điểm đ");
  });

  it("projects the proposition from structured criterion source metadata", async () => {
    const report = fixture();
    report.ruleDetails[0].criteriaDecisions[0].statement =
      'LegalRequirement: requirement-1\nProposition: Cơ quan, tổ chức chỉ được công khai dữ liệu cá nhân trong trường hợp được phép.\nApplicability mode: UNCONDITIONAL\nSource binding: ["doc-1", "sha256:abc"]';
    const bytes = await render(report);
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const mainContent = extracted.text.split(
      "Phụ lục — Bảng truy vết kỹ thuật",
    )[0];

    expect(mainContent.replace(/\s+/gu, " ")).toContain(
      "Cơ quan, tổ chức chỉ được công khai dữ liệu cá nhân trong trường hợp được phép.",
    );
    expect(mainContent).not.toContain("LegalRequirement:");
    expect(extracted.text).toContain("Mã tiêu chí gốc");
  });

  it("shows the accepted reason for a not-applicable rule in the overview", async () => {
    const report = sourceBackedFixture(1, ["NOT_APPLICABLE"]);
    const bytes = await render(report, {
      translations: {
        "Accepted rationale":
          "Dữ kiện đã chấp nhận cho thấy chủ thể không thuộc nhóm đối tượng điều chỉnh.",
      },
    });
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const mainContent = extracted.text.split(
      "Phụ lục — Bảng truy vết kỹ thuật",
    )[0];

    expect(mainContent.replace(/\s+/gu, " ")).toContain(
      "Căn cứ không áp dụng: Dữ kiện đã chấp nhận cho thấy chủ thể không thuộc nhóm đối tượng điều chỉnh.",
    );
    expect(mainContent).not.toContain(
      "Không có điều kiện riêng được ghi nhận.",
    );
    expect(mainContent).toContain("Không đánh giá do nghĩa vụ không áp dụng");
  });

  it("keeps publication-like fact text distinct from the publication label", async () => {
    const report = fixture();
    report.factIndex[0].statement = "Accepted fact: Đã phát hành nội bộ";
    const bytes = await render(report);
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    expect(extracted.text).toContain("Đã phát hành nội bộ");
    expect(extracted.text).toContain("Đã phát hành");
  });

  it("renders an all-N/A source-backed fixture without implying compliance", async () => {
    const report = sourceBackedFixture(
      20,
      Array.from({ length: 20 }, () => "NOT_APPLICABLE"),
    );
    const bytes = await render(report);
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    expect(extracted.total).toBeGreaterThan(1);
    expect(extracted.text).toContain("20");
    expect(extracted.text).toMatch(/Kh.ng áp d/);
    expect(extracted.text).toContain("CHƯA GHI NHẬN NGHĨA VỤ KHÔNG ĐÁP ỨNG");
    expect(extracted.text).not.toMatch(
      /100% compliant|Fully compliant|compliance certification/i,
    );
    expect(
      extracted.text.match(/rul(?:e|\u1eb9)-\d+/g)?.length,
    ).toBeGreaterThanOrEqual(20);
    await assertFooterPagination(bytes);
  });

  it("keeps mixed-outcome and permuted reports free of footer-only pages", async () => {
    const mixed = sourceBackedFixture(3, [
      "COMPLIANT",
      "NON_COMPLIANT",
      "NOT_APPLICABLE",
    ]);
    const permuted = structuredClone(mixed);
    permuted.ruleDetails = [...permuted.ruleDetails].reverse();

    for (const report of [mixed, permuted]) {
      const bytes = await render(report);
      await assertFooterPagination(bytes);
    }
  });
});
