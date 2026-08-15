import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DOCUMENT_ERROR_CODES } from "@lcsp/contracts/document";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAnyAction } from "../../../../platform/pbac/decorators/require-any-action.decorator.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { RequestFinalReportCommand } from "../../application/commands/request-final-report/request-final-report.command.js";
import { RequestGapAnalysisCommand } from "../../application/commands/request-gap-analysis/request-gap-analysis.command.js";
import { GetDocumentQuery } from "../../application/queries/get-document/get-document.query.js";
import { ListDocumentsQuery } from "../../application/queries/list-documents/list-documents.query.js";
import { DocumentStorageService } from "../../infrastructure/storage/document-storage.service.js";

/**
 * Exposes PBAC-protected document generation/read endpoints and verifies signed document download redirects.
 */
@Controller("assessments")
export class DocumentController {
  /**
   * Creates the controller with command/query dispatch and download-token verification support.
   *
   * @param commandBus - CQRS command bus used to request generated documents.
   * @param queryBus - CQRS query bus used to read document status/list views.
   * @param storage - Service used to verify signed document download tokens.
   */
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly storage: DocumentStorageService,
  ) {}

  /**
   * Queues final-report generation for an assessment.
   *
   * @param assessmentId - Assessment identifier from the route.
   * @param request - Authenticated request containing organization/user and correlation context.
   * @returns The standard result envelope containing queued final-report request metadata.
   */
  @Post(":assessmentId/documents/final-report")
  @HttpCode(202)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.documentGenerate)
  async requestFinalReport(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId =
      typeof request.correlationId === "string"
        ? request.correlationId
        : crypto.randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new RequestFinalReportCommand(
          assessmentId,
          request.pbacContext.organizationId,
          request.pbacContext.userId,
          correlationId,
        ),
      ),
    );
  }

  /**
   * Queues gap-analysis document generation for an assessment.
   *
   * @param assessmentId - Assessment identifier from the route.
   * @param request - Authenticated request containing organization/user and correlation context.
   * @returns The standard result envelope containing queued gap-analysis request metadata.
   */
  @Post(":assessmentId/documents/gap-analysis")
  @HttpCode(202)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.documentGenerate)
  async requestGapAnalysis(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId =
      typeof request.correlationId === "string"
        ? request.correlationId
        : crypto.randomUUID();

    return resultEnvelope(
      await this.commandBus.execute(
        new RequestGapAnalysisCommand(
          assessmentId,
          request.pbacContext.organizationId,
          request.pbacContext.userId,
          correlationId,
        ),
      ),
    );
  }

  /**
   * Retrieves one document status view using the full or redacted PBAC read mode selected by the guard.
   *
   * @param assessmentId - Assessment identifier from the route.
   * @param documentRequestId - Document request identifier from the route.
   * @param request - Authenticated request containing tenant, scope, selected action, and correlation context.
   * @returns The standard result envelope containing document status/download metadata.
   */
  @Get(":assessmentId/documents/:documentRequestId")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.documentRead,
    PBAC_ACTIONS.documentReadRedacted,
  )
  async getDocument(
    @Param("assessmentId") assessmentId: string,
    @Param("documentRequestId") documentRequestId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.pbacContext;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetDocumentQuery(
          assessmentId,
          documentRequestId,
          context.organizationId,
          context.scope,
          context.selectedAction,
          request.correlationId as string,
        ),
      ),
    );
  }

  /**
   * Lists document status views visible to the caller for one assessment.
   *
   * @param assessmentId - Assessment identifier from the route.
   * @param request - Authenticated request containing tenant, scope, selected action, and correlation context.
   * @returns The standard result envelope containing visible document request records.
   */
  @Get(":assessmentId/documents")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.documentRead,
    PBAC_ACTIONS.documentReadRedacted,
  )
  async listDocuments(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.pbacContext;
    return resultEnvelope(
      await this.queryBus.execute(
        new ListDocumentsQuery(
          assessmentId,
          context.organizationId,
          context.scope,
          context.selectedAction,
          request.correlationId as string,
        ),
      ),
    );
  }

  /**
   * Verifies an expiring signed token and redirects the client to the backing document artifact URL.
   *
   * @param assessmentId - Assessment identifier bound into the signed token.
   * @param documentRequestId - Document request identifier bound into the signed token.
   * @param token - Signed document download token.
   * @returns Redirect target containing the verified backing document URL.
   * @throws A download-url-invalid problem when the token is missing, forged, mismatched, malformed, or expired.
   */
  @Get(":assessmentId/documents/:documentRequestId/download")
  @Redirect(undefined, 302)
  downloadDocument(
    @Param("assessmentId") assessmentId: string,
    @Param("documentRequestId") documentRequestId: string,
    @Query("token") token?: string,
  ): { url: string } {
    const correlationId = crypto.randomUUID();
    if (!token) {
      throw problemException(
        DOCUMENT_ERROR_CODES.downloadUrlInvalid,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const payload = this.storage.verifySignedDownloadToken(
      token,
      assessmentId,
      documentRequestId,
    );
    if (!payload) {
      throw problemException(
        DOCUMENT_ERROR_CODES.downloadUrlInvalid,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    return { url: payload.documentUrl };
  }
}
