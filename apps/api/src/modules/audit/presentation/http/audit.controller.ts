import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUDIT_ERROR_CODES } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { Response } from "express";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import type { AuditExportArtifact } from "../../application/contracts/audit/audit-export.contract.js";
import { ExportAuditTrailCommand } from "../../application/commands/export-audit-trail/export-audit-trail.command.js";
import { GetAuditExportArtifactQuery } from "../../application/queries/get-audit-export-artifact/get-audit-export-artifact.query.js";
import { GetAuditExportQuery } from "../../application/queries/get-audit-export/get-audit-export.query.js";
import { ListAuditEventsQuery } from "../../application/queries/list-audit-events/list-audit-events.query.js";
import { AuditExportStorageService } from "../../infrastructure/storage/audit-export-storage.service.js";

interface AuditExportBody {
  from_date: string;
  to_date: string;
}

/**
 * Exposes audit browsing, export generation/status, and signed artifact download endpoints.
 */
@Controller("audit-events")
export class AuditController {
  /**
   * Creates the controller with CQRS dispatch and signed-download verification support.
   *
   * @param commandBus - CQRS command bus used to generate audit exports.
   * @param queryBus - CQRS query bus used for audit listing and export reads.
   * @param storage - Service used to verify signed audit-export download tokens.
   */
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly storage: AuditExportStorageService,
  ) {}

  /**
   * Lists redacted audit events using optional event, actor, date, and pagination filters.
   *
   * @param eventType - Optional event-type filter.
   * @param actorId - Optional actor identifier filter.
   * @param fromDate - Optional inclusive date-range start.
   * @param toDate - Optional inclusive date-range end.
   * @param page - Optional page number query value.
   * @param pageSize - Optional page-size query value.
   * @param request - Authenticated request containing RBAC and correlation context.
   * @returns The standard result envelope containing a paginated audit event list.
   */
  @Get()
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async listAuditEvents(
    @Query("event_type") eventType: string | undefined,
    @Query("actor_id") actorId: string | undefined,
    @Query("from_date") fromDate: string | undefined,
    @Query("to_date") toDate: string | undefined,
    @Query("page") page: string | undefined,
    @Query("page_size") pageSize: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new ListAuditEventsQuery(
          eventType,
          actorId,
          fromDate,
          toDate,
          page === undefined ? undefined : Number(page),
          pageSize === undefined ? undefined : Number(pageSize),
          request.correlationId as string,
        ),
      ),
    );
  }

  /**
   * Generates a versioned audit export for the requested date range.
   *
   * @param body - Required export date range.
   * @param request - Authenticated request containing user and correlation context.
   * @returns The standard result envelope containing generated export request metadata.
   */
  @Post("export")
  @HttpCode(202)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async exportAuditTrail(
    @Body() body: AuditExportBody,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId =
      typeof request.correlationId === "string"
        ? request.correlationId
        : crypto.randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new ExportAuditTrailCommand(
          request.rbacContext.userId,
          body.from_date,
          body.to_date,
          correlationId,
        ),
      ),
    );
  }

  /**
   * Returns export lifecycle and signed-download metadata for one audit export request.
   *
   * @param exportRequestId - Audit export request identifier.
   * @param request - Authenticated request containing correlation context.
   * @returns The standard result envelope containing export status metadata.
   */
  @Get("export/:exportRequestId")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async getAuditExport(
    @Param("exportRequestId") exportRequestId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetAuditExportQuery(
          exportRequestId,
          request.correlationId as string,
        ),
      ),
    );
  }

  /**
   * Verifies a signed download token and streams the persisted audit artifact as a JSON attachment.
   *
   * @param exportRequestId - Export request identifier bound into the signed token.
   * @param token - Signed, expiring download token from the query string.
   * @param response - Express response used to send the JSON attachment.
   * @returns A promise that resolves after the attachment response is sent.
   * @throws A download-url-invalid problem when the token is missing, forged, mismatched, or expired.
   */
  @Get("export/:exportRequestId/download")
  async downloadAuditExport(
    @Param("exportRequestId") exportRequestId: string,
    @Query("token") token: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const correlationId = crypto.randomUUID();
    if (!token) {
      throw problemException(
        AUDIT_ERROR_CODES.downloadUrlInvalid,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const payload = this.storage.verifySignedDownloadToken(
      token,
      exportRequestId,
    );
    if (!payload) {
      throw problemException(
        AUDIT_ERROR_CODES.downloadUrlInvalid,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const artifact: AuditExportArtifact = await this.queryBus.execute(
      new GetAuditExportArtifactQuery(exportRequestId, crypto.randomUUID()),
    );

    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-trail-export-${exportRequestId}.json"`,
    );
    response.send(JSON.stringify(artifact, null, 2));
  }
}
