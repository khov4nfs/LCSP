import { randomUUID } from "node:crypto";

import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES as Errors,
  legalSourceChunkQuerySchema,
  type LegalSourceChunkQuery,
} from "@lcsp/contracts/legal-source";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { LegalSourceDocumentService } from "../../application/services/legal-source-document.service.js";
import { LegalSourceManagementService } from "../../application/services/legal-source-management.service.js";

/** What signed-in users may read of the one active Legal Source Version. */
@Controller("legal-library")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
export class LegalLibraryController {
  constructor(
    private readonly management: LegalSourceManagementService,
    private readonly documents: LegalSourceDocumentService,
  ) {}

  private correlation(req: AuthenticatedRequest): string {
    return req.correlationId || randomUUID();
  }

  @Get()
  library(@Req() req: AuthenticatedRequest) {
    return this.management
      .getActiveLibrary(this.correlation(req))
      .then(resultEnvelope);
  }

  @Get("documents/:documentRowId/chunks")
  chunks(
    @Param("documentRowId", new ParseUUIDPipe()) documentRowId: string,
    @Query(
      new ZodValidationPipe(
        legalSourceChunkQuerySchema,
        Errors.requestInvalid,
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    )
    query: LegalSourceChunkQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents
      .listChunks({
        documentRowId,
        activeOnly: true,
        query,
        correlationId: this.correlation(req),
      })
      .then(resultEnvelope);
  }

  @Get("documents/:documentRowId/original")
  async original(
    @Param("documentRowId", new ParseUUIDPipe()) documentRowId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const original = await this.documents.readOriginal(
      documentRowId,
      { activeOnly: true },
      this.correlation(req),
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("ETag", `"${original.sha256}"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    return new StreamableFile(original.bytes, {
      type: original.mediaType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(original.fileName)}`,
      length: original.bytes.length,
    });
  }
}
