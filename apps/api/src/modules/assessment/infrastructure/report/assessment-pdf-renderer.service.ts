import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION } from "@lcsp/contracts/assessment-domain";
import {
  buildAssessmentReportPresentation,
  type AssessmentFinalReportV2,
  type AssessmentReportV2Presentation,
} from "@lcsp/contracts/assessment-report";

const packagedFontPath = fileURLToPath(
  new URL("../../../../../assets/fonts/NotoSans-Regular.ttf", import.meta.url),
);
const FONT_PATH = existsSync(packagedFontPath)
  ? packagedFontPath
  : ([
      resolve(process.cwd(), "apps/api/assets/fonts/NotoSans-Regular.ttf"),
      resolve(process.cwd(), "assets/fonts/NotoSans-Regular.ttf"),
    ].find((candidate) => existsSync(candidate)) ?? packagedFontPath);

/** Pure derived-output renderer. It accepts only a validated immutable V2 artifact. */
export class AssessmentPdfRenderer {
  async render(report: AssessmentFinalReportV2): Promise<Buffer> {
    if (report.schemaVersion !== ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION)
      throw new Error("PDF rendering requires an Assessment Final Report V2");
    const model = buildAssessmentReportPresentation(report);
    if (!("summary" in model)) throw new Error("Invalid V2 presentation model");
    return this.renderPresentation(model);
  }

  private renderPresentation(
    model: AssessmentReportV2Presentation,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size: "A4",
        margin: 48,
        bufferPages: true,
        compress: true,
        info: { Title: "LCSP Assessment Report", Author: "LCSP" },
      });
      document.registerFont("NotoSans", FONT_PATH);
      document.font("NotoSans").fontSize(9).fillColor("#172033");
      const chunks: Buffer[] = [];
      document.on("data", (chunk: Buffer) => chunks.push(chunk));
      document.on("error", reject);
      document.on("end", () => resolve(Buffer.concat(chunks)));

      const heading = (text: string, level = 1) => {
        document.moveDown(level === 1 ? 0.8 : 0.35);
        document
          .fontSize(level === 1 ? 15 : 11)
          .font("NotoSans")
          .text(text, {
            continued: false,
          });
        document.moveDown(0.25).fontSize(9);
      };
      const label = (name: string, value: string | number | null) => {
        document.font("NotoSans").text(`${name}: ${value ?? "N/A"}`, {
          width: 500,
        });
      };
      const list = (items: string[]) => {
        if (!items.length) return label("—", "N/A");
        for (const item of items) document.text(`• ${item}`, { indent: 8 });
      };

      document.fontSize(18).text("LCSP — Final Assessment Report", {
        align: "center",
      });
      document.fontSize(9).moveDown(0.5);
      label("Assessment ID", model.header.assessmentId);
      label("Artifact ID", model.header.artifactId);
      label("Schema", model.header.schemaVersion);
      label("Repository snapshot", model.header.repositorySnapshotId);
      label("Repository commit", model.header.repositoryCommit);
      label(
        "Legal source",
        `${model.header.legalSourceVersion} (${model.header.legalSourceVersionId})`,
      );
      label(
        "Rule set",
        `${model.header.ruleSetVersion} (${model.header.ruleSetVersionId})`,
      );
      label("Publication", model.header.publicationState);

      heading("01 — KẾT QUẢ ĐÁNH GIÁ");
      label("Total assessed rules", model.summary.totalRules);
      label("Applicable and compliant", model.summary.applicableCompliant);
      label(
        "Applicable and non-compliant",
        model.summary.applicableNonCompliant,
      );
      label("Not applicable", model.summary.notApplicable);
      document.text(
        model.summary.statement === "NO_NON_COMPLIANT_FINDINGS"
          ? "Chưa ghi nhận nghĩa vụ không đáp ứng trong phạm vi đã kiểm tra."
          : "Applicable non-compliant findings are listed below.",
      );
      for (const issue of model.summary.priorityIssues) {
        heading(issue.obligation, 2);
        label("Rule", issue.assessmentRuleId);
        label("Finding", issue.issue);
        label("Action", issue.action || "N/A");
      }

      heading("02 — DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG");
      for (const item of model.applicabilityFacts) {
        heading(item.assessmentRuleId, 2);
        label("Conditions", item.conditions.join(" | ") || "N/A");
        label("Accepted facts", item.acceptedFactIds.join(", ") || "N/A");
        label(
          "Accepted evidence",
          item.acceptedEvidenceIds.join(", ") || "N/A",
        );
      }

      heading("03 — DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ");
      for (const item of model.obligationCatalog) {
        label("Rule", item.assessmentRuleId);
        label("Legal requirements", item.legalRequirementIds.join(", "));
        label("Applicability", item.applicability);
        label("Compliance", item.compliance ?? "N/A");
      }

      heading("04 — CHI TIẾT TỪNG NGHĨA VỤ");
      for (const detail of model.obligationDetails) {
        heading(detail.assessmentRuleId, 2);
        label(
          "Legal obligation",
          detail.legalRequirements
            .map(
              (requirement) =>
                `${requirement.title}: ${requirement.proposition}`,
            )
            .join(" | "),
        );
        label("Applicability", detail.applicability);
        label("Compliance", detail.compliance ?? "N/A");
        label(
          "Applicability conditions",
          detail.conditions.join(" | ") || "N/A",
        );
        label("Guidance", detail.applicabilityGuidance);
        label("Observed fact IDs", detail.observedFactIds.join(", ") || "N/A");
        label("Decision rationale", detail.rationale);
        label(
          "Legal basis",
          detail.legalReferences
            .map(
              (reference) =>
                `${reference.documentId} · ${reference.locator} · ${reference.contentSha256}`,
            )
            .join(" | "),
        );
        label(
          "Decision references",
          detail.decisionReferences
            .map((item) => JSON.stringify(item.reference))
            .join(" | ") || "N/A",
        );
        for (const criterion of detail.criterionDecisions) {
          label(
            `Criterion ${criterion.criterionId}`,
            `${criterion.outcome}: ${criterion.rationale}`,
          );
          label(
            "Criterion references",
            criterion.references
              .map((item) => JSON.stringify(item.reference))
              .join(" | ") || "N/A",
          );
        }
        label("Evidence IDs", detail.evidenceIds.join(", ") || "N/A");
        label("Supported actions", detail.recommendations.join(" | ") || "N/A");
      }

      heading("05 — KẾ HOẠCH HÀNH ĐỘNG");
      if (!model.actionPlan.length)
        document.text("Không có hành động được hỗ trợ nào được ghi nhận.");
      for (const item of model.actionPlan) {
        heading(item.obligation, 2);
        label("Rule", item.assessmentRuleId);
        list(item.actions);
      }

      heading("06 — PHẠM VI, GIỚI HẠN VÀ NGUỒN TRUY VẾT");
      label("Assessment ID", model.scopeTraceability.assessmentId);
      label("Artifact ID", model.scopeTraceability.artifactId);
      label("Schema", model.scopeTraceability.schemaVersion);
      label("Case revision", model.scopeTraceability.caseRevision);
      label(
        "Legal source",
        `${model.scopeTraceability.legalSourceVersion} (${model.scopeTraceability.legalSourceVersionId})`,
      );
      label(
        "Rule set",
        `${model.scopeTraceability.ruleSetVersion} (${model.scopeTraceability.ruleSetVersionId})`,
      );
      label(
        "Repository snapshot",
        model.scopeTraceability.repositorySnapshotId,
      );
      label("Repository commit", model.scopeTraceability.repositoryCommit);
      label(
        "LegalRequirement IDs",
        model.scopeTraceability.legalRequirementIds.join(", "),
      );
      label(
        "AssessmentRule IDs",
        model.scopeTraceability.assessmentRuleIds.join(", "),
      );
      label("Fact IDs", model.scopeTraceability.factIds.join(", "));
      label("Evidence IDs", model.scopeTraceability.evidenceIds.join(", "));

      const range = document.bufferedPageRange();
      for (
        let index = range.start;
        index < range.start + range.count;
        index += 1
      ) {
        document.switchToPage(index);
        document
          .fontSize(8)
          .text(`LCSP · Page ${index + 1} of ${range.count}`, 48, 806, {
            align: "center",
          });
      }
      document.end();
    });
  }
}
