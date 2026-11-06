import { createHash, randomUUID } from "node:crypto";
import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AUDIT_DECISIONS,
  AUDIT_EVENT_RESULTS,
  AUDIT_EVENT_TYPES,
  AUDIT_EXPORT_KINDS,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  claimAssessmentRootRequestSchema,
} from "@lcsp/contracts/assessment-domain";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { AssessmentSessionExportLoader } from "../../infrastructure/persistence/assessment-session-export.loader.js";

@Controller("assessments/:assessmentId/session-export")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class AssessmentSessionExportController {
  constructor(
    private readonly loader: AssessmentSessionExportLoader,
    private readonly audit: AuditWriterService,
  ) {}

  /**
   * Business purpose: Allow the assessment owner to download a single review-ready
   * JSON snapshot without changing assessment outcomes or running the agent again.
   * Business rules: Customer role, validated assessment ID and provenance ownership
   * are required; returned metrics only describe persisted evidence.
   * Execution flow: 1. Validate identity and authorization via loader.
   * 2. Serialize and checksum the exact download bytes. 3. Audit the export
   * and return a private attachment with no caching.
   * Failure cases: Missing/foreign-owned assessments, invalid provenance or
   * unrelated report errors fail closed. A canonical FINAL_REPORT_INVALID conflict
   * is represented by an unavailable report while independently verified telemetry remains exportable.
   * Side effects: Writes an export audit entry; does not mutate assessment data.
   */
  @Get("download")
  async download(
    @Param(
      "assessmentId",
      new ZodValidationPipe(
        claimAssessmentRootRequestSchema.shape.assessmentId,
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    )
    assessmentId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const content = await this.loader.load({
      assessmentId,
      sessionUserId: request.rbacContext.userId,
      subjectRole: request.rbacContext.role,
      correlationId,
    });
    const bytes = Buffer.from(JSON.stringify(content, null, 2), "utf8");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("ETag", `"${checksum}"`);
    response.setHeader("X-Checksum-Sha256", checksum);
    response.setHeader(
      "X-Content-Fingerprint-Sha256",
      content.integrity.provenanceSha256,
    );
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.sessionExported,
      actorId: request.rbacContext.userId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      decision: AUDIT_DECISIONS.allow,
      correlationId,
      result: AUDIT_EVENT_RESULTS.success,
      payload: {
        exportKind: AUDIT_EXPORT_KINDS.sessionJson,
        exportChecksumSha256: checksum,
      },
    });
    return new StreamableFile(bytes, {
      type: "application/json",
      disposition: `attachment; filename="assessment-${assessmentId}-session.json"`,
      length: bytes.length,
    });
  }
}
