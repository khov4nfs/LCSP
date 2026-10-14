import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import {
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES as Errors,
  legalSourceIngestionResultSchema,
  type LegalSourceIngestionResult,
} from "@lcsp/contracts/legal-source";

import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { LegalSourceDocumentService } from "../../application/services/legal-source-document.service.js";

const attemptQuery = z.strictObject({
  attempt: z.coerce.number().int().min(1),
});

/** Worker-authenticated hand-off between the API and the document ingestion runtime. */
@Controller("internal/legal-sources/documents")
@UseGuards(WorkerApiKeyGuard)
export class LegalSourceIngestionController {
  constructor(private readonly documents: LegalSourceDocumentService) {}

  /** The runtime reads the stored original for one attempt (and the attempt starts running). */
  @Get(":documentRowId/original")
  async original(
    @Param("documentRowId", new ParseUUIDPipe()) documentRowId: string,
    @Query(
      new ZodValidationPipe(
        attemptQuery,
        Errors.requestInvalid,
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    )
    query: z.infer<typeof attemptQuery>,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const started = await this.documents.beginIngestion({
      documentRowId,
      attempt: query.attempt,
      correlationId: req.correlationId || randomUUID(),
    });
    response.setHeader("X-Lcsp-Structure-Profile", started.structureProfile);
    response.setHeader("X-Lcsp-Content-Sha256", started.sha256);
    return new StreamableFile(started.bytes, {
      type: started.mediaType,
      length: started.bytes.length,
    });
  }

  @Post(":documentRowId/ingestion-result")
  @HttpCode(HttpStatus.OK)
  result(
    @Param("documentRowId", new ParseUUIDPipe()) documentRowId: string,
    @Body(
      new ZodValidationPipe(
        legalSourceIngestionResultSchema,
        Errors.requestInvalid,
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    )
    result: LegalSourceIngestionResult,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents
      .recordIngestionResult({
        documentRowId,
        result,
        correlationId: req.correlationId || randomUUID(),
      })
      .then(resultEnvelope);
  }
}
