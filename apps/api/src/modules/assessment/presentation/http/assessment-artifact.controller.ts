import { AuthoredLocalizationService } from "../../../../platform/localization/authored-localization.service.js";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { randomUUID } from "node:crypto";
import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Response } from "express";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
  claimAssessmentRootRequestSchema,
} from "@lcsp/contracts/assessment-domain";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { GetAssessmentReportQuery } from "../../application/queries/get-assessment-report/get-assessment-report.query.js";
import { AssessmentPdfRenderer } from "../../infrastructure/report/assessment-pdf-renderer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";

function idPipe() {
  return new ZodValidationPipe(
    claimAssessmentRootRequestSchema.shape.assessmentId,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
}

export function buildPdfResponseHeaders(
  artifactId: string,
  sourceArtifactSha256: string,
  contentLength: number,
): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="assessment-${artifactId}.pdf"`,
    "Content-Length": String(contentLength),
    "X-LCSP-Source-Artifact-SHA256": sourceArtifactSha256,
  };
}

@Controller("assessments/:assessmentId/artifacts")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class AssessmentArtifactController {
  constructor(
    private readonly queries: QueryBus,
    private readonly pdfRenderer: AssessmentPdfRenderer,
    private readonly localization: AuthoredLocalizationService,
  ) {}

  @Get(":artifactId/download")
  async download(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Param("artifactId", idPipe()) artifactId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const locale =
      (req.headers?.["x-lcsp-locale"] as string | undefined) ?? null;
    const report = await this.queries.execute(
      new GetAssessmentReportQuery(
        assessmentId,
        artifactId,
        req.rbacContext.userId,
        req.rbacContext.role,
        req.correlationId || randomUUID(),
        locale,
      ),
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("ETag", `"${report.contentSha256}"`);
    response.setHeader(
      "X-LCSP-Source-Artifact-SHA256",
      report.sourceArtifactSha256,
    );
    return new StreamableFile(report.content, {
      type: "application/json",
      disposition: `attachment; filename="assessment-${report.artifactId}.json"`,
      length: report.content.length,
    });
  }

  @Get(":artifactId/report.pdf")
  /**
   * Business purpose: Download the authorized immutable assessment report as a PDF with validated provider source citations.
   * Business rules: The report query verifies the pinned artifact; source links use only the exact snapshot provenance returned by that query and never Agent-supplied URLs.
   * Execution flow: 1. Load the owner-authorized report. 2. Apply approved localization and validate its versioned contract. 3. Render the corresponding PDF with safe repository source context and set integrity headers.
   * Failure cases: Missing or invalid report data returns the established API problem; unsafe source context suppresses links inside the PDF.
   * Side effects: Performs read-only database/storage operations and uses the local PDF renderer; no assessment or evidence is changed.
   */
  async downloadPdf(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Param("artifactId", idPipe()) artifactId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const report = await this.queries.execute(
      new GetAssessmentReportQuery(
        assessmentId,
        artifactId,
        req.rbacContext.userId,
        req.rbacContext.role,
        req.correlationId || randomUUID(),
      ),
    );
    const canonical: unknown = JSON.parse(report.content.toString("utf8"));
    const locale = req.headers?.["x-lcsp-locale"];
    const document: unknown =
      typeof locale === "string"
        ? await this.localization.localizedReportDocument(
            assessmentId,
            artifactId,
            report.contentSha256,
            canonical,
            resolveResponseLanguage(locale),
          )
        : canonical;
    const parsed =
      assessmentFinalReportArtifactVersionedSchema.safeParse(document);
    if (!parsed.success) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
        req.correlationId || randomUUID(),
        { status: 409 },
      );
    }
    const content =
      parsed.data.schemaVersion === ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION
        ? await this.pdfRenderer.renderLegacyV1(parsed.data)
        : parsed.data.schemaVersion ===
            ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION
          ? await this.pdfRenderer.render(parsed.data, {
              repositorySource: report.repositorySource,
            })
          : parsed.data.schemaVersion ===
              ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION
            ? await this.pdfRenderer.renderV3(parsed.data, {
                repositorySource: report.repositorySource,
              })
            : parsed.data.schemaVersion ===
                ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION
              ? await this.pdfRenderer.renderV4(parsed.data)
              : await Promise.reject(
                  new Error("Unsupported report schema version"),
                );
    for (const [name, value] of Object.entries(
      buildPdfResponseHeaders(
        report.artifactId,
        report.contentSha256,
        content.length,
      ),
    )) {
      response.setHeader(name, value);
    }
    return new StreamableFile(content, {
      type: "application/pdf",
      disposition: `attachment; filename="assessment-${artifactId}.pdf"`,
      length: content.length,
    });
  }
}
