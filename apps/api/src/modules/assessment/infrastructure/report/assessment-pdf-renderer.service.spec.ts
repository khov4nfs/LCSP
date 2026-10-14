import { describe, expect, it } from "@jest/globals";
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

describe("AssessmentPdfRenderer", () => {
  it("renders a valid non-empty PDF from the shared V2 projection", async () => {
    const bytes = await new AssessmentPdfRenderer().render(fixture());
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
    const text = bytes.toString("latin1");
    expect(text).toContain("/Type /Catalog");
  });

  it("preserves Vietnamese sections and canonical values in extracted PDF text", async () => {
    const report = sourceBackedFixture(3, [
      "COMPLIANT",
      "NON_COMPLIANT",
      "NOT_APPLICABLE",
    ]);
    const bytes = await new AssessmentPdfRenderer().render(report);
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    expect(extracted.total).toBeGreaterThan(1);
    expect(extracted.text).toContain("KẾT QUẢ ĐÁNH GIÁ");
    expect(extracted.text).toContain("DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG");
    expect(extracted.text).toContain("CHI TIẾT TỪNG NGHĨA VỤ");
    expect(extracted.text).toContain("rule-1");
    expect(extracted.text).toContain("rule-2");
    expect(extracted.text).toContain("article-2");
    expect(extracted.text).toContain(sha);
    expect(extracted.text).toContain("NOT_APPLICABLE");
  });

  it("renders an all-N/A source-backed fixture without implying compliance", async () => {
    const report = sourceBackedFixture(
      20,
      Array.from({ length: 20 }, () => "NOT_APPLICABLE"),
    );
    const bytes = await new AssessmentPdfRenderer().render(report);
    const parser = new PDFParse({ data: bytes });
    const extracted = await parser.getText();
    await parser.destroy();
    expect(extracted.total).toBeGreaterThan(1);
    expect(extracted.text).toContain("Total assessed rules: 20");
    expect(extracted.text).toContain("Not applicable: 20");
    expect(extracted.text).toContain("Chưa ghi nhận nghĩa");
    expect(extracted.text).not.toMatch(
      /100% compliant|Fully compliant|compliance certification/i,
    );
    expect(extracted.text.match(/Rule: rule-/g)?.length).toBeGreaterThanOrEqual(
      20,
    );
  });
});
