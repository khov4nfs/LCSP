import { describe, expect, it, jest } from "@jest/globals";
import { PDFParse } from "pdf-parse";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
} from "@lcsp/contracts/assessment-domain";
import {
  buildAssessmentReportPresentation,
  assessmentFinalReportV2Schema,
  type AssessmentFinalReportV2,
} from "@lcsp/contracts/assessment-report";
import { AssessmentPdfRenderer } from "./assessment-pdf-renderer.service.js";
import { assessmentReportV2Html } from "./assessment-report-v2-pdf-html.js";
import {
  legalDocumentName,
  legalLocator,
} from "./assessment-report-v2-pdf-presentation.js";

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
    expect(mainContent).not.toMatch(/\b(?:QT|PL|TC|DK|BC|ND)-\d+\b/u);
    expect(mainContent.replace(/\s+/gu, " ")).toContain(
      "Nội dung giải thích pháp lý đầy đủ chưa được xác minh từ dữ liệu báo cáo hiện có.",
    );
    expect(mainContent).toContain("Nghĩa vụ và căn cứ pháp lý");
    expect(mainContent).toContain("Phạm vi áp dụng");
    expect(mainContent).toContain("Giải thích kết quả");
    expect(mainContent).toContain("Hạng mục");
    expect(mainContent).toContain("Nội dung");
    expect(mainContent).not.toContain("Mã đối chiếu");
    expect(mainContent).not.toContain("Mã tiêu chí [TC-");
    expect(extracted.text).toContain("Mã tiêu chí gốc");
    expect(extracted.text.replace(/\s+/gu, "")).toContain(sha);
    expect(extracted.text).toContain("Nguyên văn cần đối chiếu");
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
    const mainContent = extracted.text.split(
      "Phụ lục — Bảng truy vết kỹ thuật",
    )[0];
    const normalizedPdfText = extracted.text
      .normalize("NFC")
      .replace(/\s+/gu, "")
      .toLocaleUpperCase("vi-VN");
    const normalizeExpected = (value: string) =>
      value.normalize("NFC").replace(/\s+/gu, "").toLocaleUpperCase("vi-VN");
    expect(extracted.total).toBeGreaterThan(1);
    expect(normalizedPdfText).toContain(
      normalizeExpected("ĐÁNH GIÁ DỰA TRÊN NGUỒN VÀ BẰNG CHỨNG"),
    );
    expect(normalizedPdfText).toContain(
      normalizeExpected("Không áp dụng không đồng nghĩa với Đáp ứng."),
    );
    expect(normalizedPdfText).toContain(normalizeExpected("KẾT QUẢ ĐÁNH GIÁ"));
    expect(normalizedPdfText).toContain(
      normalizeExpected("Kho mã nguồn được đánh giá"),
    );
    expect(normalizedPdfText).toContain(normalizeExpected("Phiên bản báo cáo"));
    expect(normalizedPdfText).toContain(normalizeExpected("Mã đánh giá:"));
    expect(normalizedPdfText).not.toContain(
      normalizeExpected("Publication state"),
    );
    expect(normalizedPdfText).not.toContain(
      normalizeExpected("Traceability IDs"),
    );
    expect(normalizedPdfText).toContain(
      normalizeExpected("DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG"),
    );
    expect(normalizedPdfText).toContain(
      normalizeExpected("CHI TIẾT TỪNG NGHĨA VỤ"),
    );
    expect(normalizedPdfText).toContain(normalizeExpected("rule-1"));
    expect(normalizedPdfText).toContain(normalizeExpected("rule-2"));
    expect(normalizedPdfText).toContain(normalizeExpected("article-2"));
    expect(extracted.text.replace(/\s+/gu, "")).toContain(sha);
    expect(
      mainContent
        .normalize("NFC")
        .replace(/\s+/gu, "")
        .toLocaleUpperCase("vi-VN"),
    ).not.toContain(
      normalizeExpected("Áp dụng chung theo định nghĩa nghĩa vụ"),
    );
    expect(extracted.text).toContain("Apply when relevant.");
    expect(normalizedPdfText).toContain(normalizeExpected("Không áp dụng"));
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
    expect(mainContent).toContain("Hạng mục");
    expect(mainContent).toContain("Nội dung");
    expect(mainContent).not.toContain("Mã đối chiếu");
    expect(mainContent.replace(/\s+/gu, " ")).toContain(
      "biện pháp đã được ghi nhận",
    );
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

  it("uses verified Vietnamese legal titles and preserves a truthful fallback", () => {
    expect(
      legalDocumentName("luat-so-91-2025-qh15-luat-bao-ve-du-lieu-ca-nhan"),
    ).toBe("Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15");
    expect(legalDocumentName("luat-so-116-2025-qh15-luat-an-ninh-mang")).toBe(
      "Luật An ninh mạng số 116/2025/QH15",
    );
    expect(legalDocumentName("luat-so-7-2025-qh1-unknown")).toBe(
      "Luật số 7/2025/QH1",
    );
  });

  it("omits an absent case revision from appendix metadata", () => {
    const model = buildAssessmentReportPresentation(fixture());
    if (!("scopeTraceability" in model)) {
      throw new Error("The V2 fixture must produce a V2 presentation model");
    }
    expect(
      Reflect.set(model.scopeTraceability, "caseRevision", undefined),
    ).toBe(true);

    expect(assessmentReportV2Html(model)).not.toContain("Lần hiệu chỉnh hồ sơ");
  });

  it("keeps applicability condition rows together across PDF page breaks", () => {
    const model = buildAssessmentReportPresentation(fixture());
    if (!("scopeTraceability" in model)) {
      throw new Error("The V2 fixture must produce a V2 presentation model");
    }
    const html = assessmentReportV2Html(model);
    expect(html).toContain(
      `<tr class="keep-together"><td>\u0110i\u1ec1u ki\u1ec7n \u00e1p d\u1ee5ng</td>`,
    );
  });
  it("deduplicates a legal basis in the customer-facing catalog", async () => {
    const report = fixture();
    report.legalRequirements[0].sourceRefs[0].locator = "art-1";
    report.ruleDetails[0].sourceRefs[0].locator = "art-1";
    const duplicateRequirement = structuredClone(report.legalRequirements[0]);
    duplicateRequirement.legalRequirementId = "requirement-2";
    report.legalRequirements.push(duplicateRequirement);
    report.ruleDetails[0].legalRequirementIds.push("requirement-2");

    const bytes = await render(report);
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const catalog = extracted.text
      .split("03 — DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ")[1]
      ?.split("04 — CHI TIẾT TỪNG NGHĨA VỤ")[0]
      ?.normalize("NFC")
      .replace(/\s+/gu, "")
      .toLocaleUpperCase("vi-VN");
    const legalBasis = "Tài liệu pháp lý — Điều 1."
      .normalize("NFC")
      .replace(/\s+/gu, "")
      .toLocaleUpperCase("vi-VN");

    expect(catalog).toBeDefined();
    expect(catalog?.split(legalBasis)).toHaveLength(2);
  });

  it("keeps definition mode out of the accepted NOT_APPLICABLE explanation", async () => {
    const report = sourceBackedFixture(1, ["NOT_APPLICABLE"]);
    report.ruleDetails[0].applicabilityGuidance =
      "Applicability mode: UNCONDITIONAL\nOperative proposition: Applies to a defined regulated operator.";
    const bytes = await render(report, {
      translations: {
        "Accepted rationale":
          "Dữ kiện được chấp nhận cho thấy chủ thể không thuộc nhóm đối tượng được quy định.",
        "Accepted fact":
          "Đơn vị vận hành là nhóm nghiên cứu mã nguồn mở do cá nhân thực hiện.",
      },
    });
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const main = extracted.text.split("Phụ lục — Bảng truy vết kỹ thuật")[0];

    expect(main).toContain("Không áp dụng");
    expect(main).toContain("Vì sao không áp dụng?");
    expect(main.replace(/\s+/gu, " ")).toContain("không thuộc nhóm đối tượng");
    expect(main).not.toContain("Áp dụng chung theo định nghĩa nghĩa vụ");
    expect(extracted.text).toContain("UNCONDITIONAL");
  });

  it("groups legal points by law, article and clause without losing cross-article sources", async () => {
    const report = fixture();
    const law = "luat-so-91-2025-qh15-luat-bao-ve-du-lieu-ca-nhan";
    const base = report.ruleDetails[0].sourceRefs[0];
    const makeSource = (locator: string) => ({
      ...base,
      documentId: law,
      locator,
    });
    report.ruleDetails[0].sourceRefs = [
      makeSource("art-16::cl-2::pt-b"),
      makeSource("art-16::cl-2::pt-c"),
      makeSource("art-16::cl-2::pt-đ"),
      makeSource("art-16::cl-2::pt-c"),
      makeSource("art-19::cl-1::pt-b"),
      {
        ...makeSource("art-17::cl-1::pt-đ"),
        documentId: "luat-so-116-2025-qh15-luat-an-ninh-mang",
      },
    ];
    const bytes = await render(report);
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const catalog = extracted.text
      .split("03 — DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ")[1]
      ?.split("04 — CHI TIẾT TỪNG NGHĨA VỤ")[0]
      ?.normalize("NFC")
      .replace(/\s+/gu, "")
      .toLocaleUpperCase("vi-VN");
    const normalize = (value: string) =>
      value.normalize("NFC").replace(/\s+/gu, "").toLocaleUpperCase("vi-VN");

    expect(catalog).toContain(normalize("Điều 16, khoản 2, điểm b, c và đ"));
    expect(catalog).toContain(normalize("Điều 19, khoản 1, điểm b"));
    expect(catalog).toContain(
      normalize("Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15"),
    );
    expect(catalog).toContain(normalize("Luật An ninh mạng số 116/2025/QH15"));
    expect(catalog?.match(/LUẬTBẢOVỆDỮLIỆUCÁNHÂN/g)).toHaveLength(1);
    expect(catalog?.match(/LUẬTANNINHMẠNG/g)).toHaveLength(1);
    expect(extracted.text).toContain("Mã tài liệu");
  });

  it("shows accepted evidence once with a single repository-scope limitation", async () => {
    const report = sourceBackedFixture(1, ["NON_COMPLIANT"]);
    const evidenceIds = [idFor(80), idFor(81), idFor(82)];
    const locators = ["src/guard.py:1-10", "src/api.ts:20-40", "README.md:1-8"];
    report.evidenceIndex = evidenceIds.map((evidenceId, index) => ({
      evidenceId,
      type: "REPOSITORY_FILE",
      contentSha256: sha,
      repositoryCommit: "a".repeat(40),
      safeLocator: locators[index],
    }));
    report.ruleDetails[0].evidenceIds = evidenceIds;

    const bytes = await render(report, {
      translations: {
        "Accepted rationale":
          "Trong repository được kiểm tra chưa thấy biện pháp tương ứng; tiêu chí chưa đạt.",
        "Accepted criterion rationale":
          "Trong repository được kiểm tra chưa thấy biện pháp tương ứng.",
      },
    });
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const main = extracted.text.split("Phụ lục — Bảng truy vết kỹ thuật")[0];

    expect(main).toContain("Nguồn đã kiểm tra");
    expect(main).not.toContain("<code>");
    for (const locator of locators) expect(main).toContain(locator);
    expect(main.match(/Bằng chứng đã được ghi nhận/gu)).toHaveLength(1);
    expect(
      main
        .replace(/\s+/gu, " ")
        .match(/không xác nhận biện pháp vận hành bên ngoài repository/giu),
    ).toHaveLength(1);
    expect(main).not.toContain(
      "đường dẫn hoặc loại nguồn tự nó không chứng minh",
    );
  });

  it("keeps the accepted decision explanation and limitation in one continuation block", async () => {
    const report = sourceBackedFixture(1, ["NON_COMPLIANT"]);
    const rationale =
      "Kết luận đã chấp nhận dựa trên tiêu chí chưa đạt trong phạm vi kho mã được kiểm tra.";
    const bytes = await render(report, {
      translations: { "Accepted rationale": rationale },
    });
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const explanationPage = extracted.pages.find((page) =>
      page.text.includes("Giải thích kết luận"),
    );

    expect(explanationPage).toBeDefined();
    expect(explanationPage?.text.replace(/\s+/gu, " ")).toContain(rationale);
    expect(explanationPage?.text).toContain("Giới hạn của kết luận");
  });

  it("distinguishes permitted legal circumstances from exceptions invoked by the decision", async () => {
    const report = fixture();
    report.legalRequirements[0].exceptions = [
      "A permitted circumstance listed in the legal provision.",
    ];
    const bytes = await render(report, {
      translations: {
        "A permitted circumstance listed in the legal provision.":
          "Trường hợp được quy định cho phép công khai dữ liệu.",
        "Accepted rationale":
          "Không có trường hợp ngoại lệ nào được viện dẫn trong quyết định đã chấp nhận.",
      },
    });
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    const main = extracted.text.split("Phụ lục — Bảng truy vết kỹ thuật")[0];

    expect(main).toContain("Ngoại lệ được nêu trong quy định");
    const normalizedMain = main.replace(/\s+/gu, " ");
    expect(normalizedMain).toContain(
      "Trường hợp được quy định cho phép công khai dữ liệu",
    );
    expect(normalizedMain).toContain(
      "Không có trường hợp ngoại lệ nào được viện dẫn",
    );
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
    expect(mainContent.replace(/\s+/gu, " ")).toContain(
      "Không đánh giá do nghĩa vụ không áp dụng",
    );
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
