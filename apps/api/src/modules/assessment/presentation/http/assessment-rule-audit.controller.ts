import { randomUUID } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ruleAuditExportRequestSchema,
  ruleAuditRetryRequestSchema,
  submitRuleAuditSchema,
} from "@lcsp/contracts/assessment-domain";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AssessmentRuleAuditService } from "../../application/services/assessment-rule-audit.service.js";

const pipe = (schema: z.ZodType) =>
  new ZodValidationPipe(
    schema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
const pageSchema = z.strictObject({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Owner-scoped transport for frozen customer rule audits; all business authority stays in the assessment service. */
@Controller("assessments/:assessmentId")
@UseGuards(RbacGuard)
export class AssessmentRuleAuditController {
  constructor(private readonly audits: AssessmentRuleAuditService) {}

  @Get("rules")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async catalog(
    @Param("assessmentId", pipe(z.uuid())) assessmentId: string,
    @Query(pipe(pageSchema)) page: z.infer<typeof pageSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.audits.catalog(
        assessmentId,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
        page.offset,
        page.limit,
      ),
    );
  }

  @Post("rule-audits")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async submit(
    @Param("assessmentId", pipe(z.uuid())) assessmentId: string,
    @Body(pipe(submitRuleAuditSchema))
    body: z.infer<typeof submitRuleAuditSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.audits.submit(
        assessmentId,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
        body,
      ),
    );
  }

  @Get("rule-audits/:requestId")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async request(
    @Param("assessmentId", pipe(z.uuid())) assessmentId: string,
    @Param("requestId", pipe(z.uuid())) requestId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.audits.request(
        assessmentId,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
        requestId,
      ),
    );
  }

  @Post("rule-audits/:requestId/retry")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async retry(
    @Param("assessmentId", pipe(z.uuid())) assessmentId: string,
    @Param("requestId", pipe(z.uuid())) requestId: string,
    @Body(pipe(ruleAuditRetryRequestSchema))
    body: z.infer<typeof ruleAuditRetryRequestSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.audits.retry(
        assessmentId,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
        requestId,
        body.idempotencyKey,
      ),
    );
  }

  @Post("rule-audits/:requestId/exports")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async export(
    @Param("assessmentId", pipe(z.uuid())) assessmentId: string,
    @Param("requestId", pipe(z.uuid())) requestId: string,
    @Body(pipe(ruleAuditExportRequestSchema))
    body: z.infer<typeof ruleAuditExportRequestSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.audits.createExport(
        assessmentId,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
        requestId,
        body.idempotencyKey,
      ),
    );
  }

  @Get("rule-audits/:requestId/exports/:exportId/download")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async download(
    @Param("assessmentId", pipe(z.uuid())) assessmentId: string,
    @Param("requestId", pipe(z.uuid())) requestId: string,
    @Param("exportId", pipe(z.uuid())) exportId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.audits.downloadExport(
      assessmentId,
      req.rbacContext.userId,
      req.correlationId || randomUUID(),
      requestId,
      exportId,
    );
    response.setHeader("ETag", `"${result.contentSha256}"`);
    return new StreamableFile(result.content, {
      type: "application/json",
      disposition: `attachment; filename="selected-rule-audit-${exportId}.json"`,
      length: result.content.length,
    });
  }
}
