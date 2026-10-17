import { randomUUID } from "node:crypto";
import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  claimAssessmentRootRequestSchema,
  type AssessmentProvenanceArtifact,
} from "@lcsp/contracts/assessment-domain";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { AssessmentProvenanceLoader } from "../../infrastructure/persistence/assessment-provenance.loader.js";

function idPipe() {
  return new ZodValidationPipe(
    claimAssessmentRootRequestSchema.shape.assessmentId,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

@Controller("assessments/:assessmentId/provenance")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
export class AssessmentProvenanceController {
  constructor(
    private readonly provenanceLoader: AssessmentProvenanceLoader,
    private readonly auditWriter: AuditWriterService,
  ) {}

  @Get()
  async getProvenance(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const correlationId = req.correlationId || randomUUID();
    let artifact: AssessmentProvenanceArtifact;
    try {
      artifact = await this.provenanceLoader.load({
        assessmentId,
        sessionUserId: req.rbacContext.userId,
        subjectRole: req.rbacContext.role,
        correlationId,
      });
    } catch (error) {
      await this.auditWriter.write({
        eventType: "assessment.provenance.viewed",
        actorId: req.rbacContext.userId,
        assessmentId,
        resourceType: AUDIT_RESOURCE_TYPES.assessment,
        resourceId: assessmentId,
        decision: AUDIT_DECISIONS.deny,
        correlationId,
        result: "DENIED",
        payload: {
          reason: "ACCESS_DENIED_OR_NOT_FOUND",
        },
      });
      throw error;
    }

    await this.auditWriter.write({
      eventType: "assessment.provenance.viewed",
      actorId: req.rbacContext.userId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      decision: AUDIT_DECISIONS.allow,
      correlationId,
      result: "SUCCESS",
      payload: {
        checksumSha256: artifact.checksumSha256,
      },
    });

    return resultEnvelope(artifact);
  }

  @Get("download")
  async downloadProvenance(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const correlationId = req.correlationId || randomUUID();
    let artifact: AssessmentProvenanceArtifact;
    try {
      artifact = await this.provenanceLoader.load({
        assessmentId,
        sessionUserId: req.rbacContext.userId,
        subjectRole: req.rbacContext.role,
        correlationId,
      });
    } catch (error) {
      await this.auditWriter.write({
        eventType: "assessment.provenance.exported",
        actorId: req.rbacContext.userId,
        assessmentId,
        resourceType: AUDIT_RESOURCE_TYPES.assessment,
        resourceId: assessmentId,
        decision: AUDIT_DECISIONS.deny,
        correlationId,
        result: "DENIED",
        payload: {
          reason: "ACCESS_DENIED_OR_NOT_FOUND",
        },
      });
      throw error;
    }

    await this.auditWriter.write({
      eventType: "assessment.provenance.exported",
      actorId: req.rbacContext.userId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      decision: AUDIT_DECISIONS.allow,
      correlationId,
      result: "SUCCESS",
      payload: {
        checksumSha256: artifact.checksumSha256,
      },
    });

    const fileBuffer = Buffer.from(JSON.stringify(artifact, null, 2), "utf8");

    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("ETag", `"${artifact.checksumSha256}"`);
    return new StreamableFile(fileBuffer, {
      type: "application/json",
      disposition: `attachment; filename="assessment-${assessmentId}-provenance.json"`,
      length: fileBuffer.length,
    });
  }
}
