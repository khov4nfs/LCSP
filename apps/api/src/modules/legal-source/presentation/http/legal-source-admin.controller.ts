import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type { z } from "zod";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  createLegalSourceRequestSchema,
  createLegalSourceVersionRequestSchema,
  importLegalSourceDocumentRequestSchema,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES as Errors,
  legalSourceChunkQuerySchema,
  updateLegalSourceRequestSchema,
  updateLegalSourceDocumentEffectSchema,
  updateLegalSourceDocumentCorpusRoleSchema,
  type UpdateLegalSourceDocumentCorpusRole,
  uploadLegalSourceDocumentMetadataSchema,
  type CreateLegalSourceRequest,
  type CreateLegalSourceVersionRequest,
  type ImportLegalSourceDocumentRequest,
  type LegalSourceChunkQuery,
  type UpdateLegalSourceRequest,
  type UpdateLegalSourceDocumentEffect,
  type UploadLegalSourceDocumentMetadata,
} from "@lcsp/contracts/legal-source";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { LegalSourceDocumentService } from "../../application/services/legal-source-document.service.js";
import { LegalSourceManagementService } from "../../application/services/legal-source-management.service.js";

const validated = (schema: z.ZodTypeAny) =>
  new ZodValidationPipe(
    schema,
    Errors.requestInvalid,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
const uuid = () => new ParseUUIDPipe();

/**
 * Administration of Legal Sources: the parent a family of immutable versions hangs from, the
 * documents of a draft version, and the explicit activation. Controllers only transport; every
 * rule (immutability, SSRF guard, ingestion states) lives in the services.
 */
@Controller("admin")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class LegalSourceAdminController {
  constructor(
    private readonly management: LegalSourceManagementService,
    private readonly documents: LegalSourceDocumentService,
  ) {}

  private correlation(req: AuthenticatedRequest): string {
    return req.correlationId || randomUUID();
  }

  @Get("legal-sources")
  list() {
    return this.management.listSources().then(resultEnvelope);
  }

  @Post("legal-sources")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(validated(createLegalSourceRequestSchema))
    request: CreateLegalSourceRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.management
      .createSource({
        actorId: req.rbacContext.userId,
        correlationId: this.correlation(req),
        request,
      })
      .then(resultEnvelope);
  }

  @Get("legal-sources/:sourceId")
  detail(
    @Param("sourceId", uuid()) sourceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.management
      .getSource(sourceId, this.correlation(req))
      .then(resultEnvelope);
  }

  @Patch("legal-sources/:sourceId")
  update(
    @Param("sourceId", uuid()) sourceId: string,
    @Body(validated(updateLegalSourceRequestSchema))
    request: UpdateLegalSourceRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.management
      .updateSource({
        sourceId,
        actorId: req.rbacContext.userId,
        correlationId: this.correlation(req),
        request,
      })
      .then(resultEnvelope);
  }

  @Post("legal-sources/:sourceId/versions")
  @HttpCode(HttpStatus.CREATED)
  createVersion(
    @Param("sourceId", uuid()) sourceId: string,
    @Body(validated(createLegalSourceVersionRequestSchema))
    request: CreateLegalSourceVersionRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.management
      .createVersion({
        sourceId,
        actorId: req.rbacContext.userId,
        correlationId: this.correlation(req),
        request,
      })
      .then(resultEnvelope);
  }

  @Get("legal-source-versions/:versionId")
  version(
    @Param("versionId", uuid()) versionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.management
      .getVersion(versionId, this.correlation(req))
      .then(resultEnvelope);
  }

  /** The request body is the file's raw bytes; its metadata travels in the query string. */
  @Post("legal-source-versions/:versionId/documents/upload")
  @HttpCode(HttpStatus.CREATED)
  upload(
    @Param("versionId", uuid()) versionId: string,
    @Query(validated(uploadLegalSourceDocumentMetadataSchema))
    metadata: UploadLegalSourceDocumentMetadata,
    @Body() body: unknown,
    @Headers("content-type") declaredType: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const correlationId = this.correlation(req);
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw problemException(Errors.documentEmpty, correlationId, {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    return this.documents
      .addUpload({
        versionId,
        actorId: req.rbacContext.userId,
        correlationId,
        bytes: body,
        declaredType: declaredType ?? null,
        metadata,
      })
      .then(resultEnvelope);
  }

  @Post("legal-source-versions/:versionId/documents/import")
  @HttpCode(HttpStatus.CREATED)
  importDocument(
    @Param("versionId", uuid()) versionId: string,
    @Body(validated(importLegalSourceDocumentRequestSchema))
    request: ImportLegalSourceDocumentRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents
      .importFromUrl({
        versionId,
        actorId: req.rbacContext.userId,
        correlationId: this.correlation(req),
        request,
      })
      .then(resultEnvelope);
  }

  @Post("legal-source-versions/:versionId/documents/:documentRowId/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  retry(
    @Param("versionId", uuid()) versionId: string,
    @Param("documentRowId", uuid()) documentRowId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents
      .retry({
        versionId,
        documentRowId,
        actorId: req.rbacContext.userId,
        correlationId: this.correlation(req),
      })
      .then(resultEnvelope);
  }

  @Delete("legal-source-versions/:versionId/documents/:documentRowId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDocument(
    @Param("versionId", uuid()) versionId: string,
    @Param("documentRowId", uuid()) documentRowId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.documents.remove({
      versionId,
      documentRowId,
      actorId: req.rbacContext.userId,
      correlationId: this.correlation(req),
    });
  }

  @Patch(
    "legal-source-versions/:versionId/documents/:documentRowId/corpus-role",
  )
  updateDocumentCorpusRole(
    @Param("versionId", uuid()) versionId: string,
    @Param("documentRowId", uuid()) documentRowId: string,
    @Body(validated(updateLegalSourceDocumentCorpusRoleSchema))
    request: UpdateLegalSourceDocumentCorpusRole,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents
      .updateCorpusRole({
        versionId,
        documentRowId,
        actorId: req.rbacContext.userId,
        correlationId: this.correlation(req),
        request,
      })
      .then(resultEnvelope);
  }

  @Patch("legal-source-versions/:versionId/documents/:documentRowId/effect")
  updateDocumentEffect(
    @Param("versionId", uuid()) versionId: string,
    @Param("documentRowId", uuid()) documentRowId: string,
    @Body(validated(updateLegalSourceDocumentEffectSchema))
    request: UpdateLegalSourceDocumentEffect,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents
      .updateEffect({
        versionId,
        documentRowId,
        actorId: req.rbacContext.userId,
        correlationId: this.correlation(req),
        request,
      })
      .then(resultEnvelope);
  }

  @Get("legal-source-versions/:versionId/documents/:documentRowId/chunks")
  chunks(
    @Param("versionId", uuid()) versionId: string,
    @Param("documentRowId", uuid()) documentRowId: string,
    @Query(validated(legalSourceChunkQuerySchema)) query: LegalSourceChunkQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents
      .listChunks({
        documentRowId,
        versionId,
        query,
        correlationId: this.correlation(req),
      })
      .then(resultEnvelope);
  }

  @Get("legal-source-versions/:versionId/documents/:documentRowId/original")
  async original(
    @Param("versionId", uuid()) versionId: string,
    @Param("documentRowId", uuid()) documentRowId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const original = await this.documents.readOriginal(
      documentRowId,
      { versionId },
      this.correlation(req),
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("ETag", `"${original.sha256}"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    return new StreamableFile(original.bytes, {
      type: original.mediaType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(original.fileName)}`,
      length: original.bytes.length,
    });
  }

  @Post("legal-source-versions/:versionId/activate")
  @HttpCode(HttpStatus.OK)
  activate(
    @Param("versionId", uuid()) versionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.management
      .activate({
        versionId,
        actorId: req.rbacContext.userId,
        correlationId: this.correlation(req),
      })
      .then(resultEnvelope);
  }

  @Delete("legal-source-versions/:versionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async discard(
    @Param("versionId", uuid()) versionId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.management.discard({
      versionId,
      actorId: req.rbacContext.userId,
      correlationId: this.correlation(req),
    });
  }
}
