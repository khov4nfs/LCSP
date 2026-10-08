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
  claimAssessmentRootRequestSchema,
} from "@lcsp/contracts/assessment-domain";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { GetAssessmentReportQuery } from "../../application/queries/get-assessment-report/get-assessment-report.query.js";

function idPipe() {
  return new ZodValidationPipe(
    claimAssessmentRootRequestSchema.shape.assessmentId,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
}

@Controller("assessments/:assessmentId/artifacts")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class AssessmentArtifactController {
  constructor(private readonly queries: QueryBus) {}

  @Get(":artifactId/download")
  async download(
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
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("ETag", `"${report.contentSha256}"`);
    return new StreamableFile(report.content, {
      type: "application/json",
      disposition: `attachment; filename="assessment-${report.artifactId}.json"`,
      length: report.content.length,
    });
  }
}
