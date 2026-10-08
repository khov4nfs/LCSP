import { randomUUID } from "node:crypto";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  LEGACY_MIGRATION_ERROR_CODES,
  legacyArchiveListQuerySchema,
  type LegacyArchiveList,
} from "@lcsp/contracts/legacy-migration";
import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { DownloadLegacyArchiveReportQuery } from "../../application/queries/download-legacy-archive-report/download-legacy-archive-report.query.js";
import { GetLegacyArchiveQuery } from "../../application/queries/get-legacy-archive/get-legacy-archive.query.js";
import { ListLegacyArchivesQuery } from "../../application/queries/list-legacy-archives/list-legacy-archives.query.js";

const pipe = (schema: z.ZodType) =>
  new ZodValidationPipe(
    schema,
    LEGACY_MIGRATION_ERROR_CODES.REQUEST_INVALID,
    422,
  );
const idPipe = () => pipe(z.string().min(1).max(128));

/**
 * Read-only access to archived V1 assessments and their report records. Customers only ever see
 * their own archive; nothing here starts work or reaches a V1 table.
 */
@Controller("legacy-archive/assessments")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class LegacyArchiveController {
  constructor(private readonly queries: QueryBus) {}

  @Get()
  async list(
    @Query(pipe(legacyArchiveListQuerySchema))
    query: z.infer<typeof legacyArchiveListQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queries.execute<ListLegacyArchivesQuery, LegacyArchiveList>(
        new ListLegacyArchivesQuery(
          request.rbacContext.userId,
          query.page,
          query.page_size,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Get(":assessmentId")
  async detail(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queries.execute(
        new GetLegacyArchiveQuery(
          request.rbacContext.userId,
          assessmentId,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Get(":assessmentId/reports/:recordId/download")
  async download(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Param("recordId", pipe(z.guid())) recordId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.queries.execute(
      new DownloadLegacyArchiveReportQuery(
        request.rbacContext.userId,
        assessmentId,
        recordId,
        request.correlationId || randomUUID(),
      ),
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("ETag", `"${file.sha256}"`);
    return new StreamableFile(file.content, {
      type: file.mediaType,
      disposition: `attachment; filename="${file.filename}"`,
      length: file.content.length,
    });
  }
}
