import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ProcessDocumentCallbackCommand } from "../../application/commands/process-document-callback/process-document-callback.command.js";
import type { DocumentCallbackRequest } from "../../application/contracts/document/document-callback.contract.js";
import { GetDocumentGenerationContextQuery } from "../../application/queries/get-document-generation-context/get-document-generation-context.query.js";

/**
 * Exposes worker-authenticated document artifact reads and callback endpoints.
 * Processing remains in Python; this controller is an authority/persistence boundary.
 */
@Controller("internal/document-requests")
export class InternalDocumentController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /** Return immutable, version-pinned inputs required by Python dossier/report processing. */
  @Get(":documentRequestId/generation-context")
  @UseGuards(WorkerApiKeyGuard)
  async getGenerationContext(
    @Param("documentRequestId") documentRequestId: string,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetDocumentGenerationContextQuery(documentRequestId),
      ),
    );
  }

  /**
   * Accepts a document-generation callback from the worker and dispatches it for persistence/audit processing.
   */
  @Post(":documentRequestId/callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async processCallback(
    @Param("documentRequestId") documentRequestId: string,
    @Body() payload: DocumentCallbackRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const normalizedPayload = {
      ...payload,
      document_request_id: documentRequestId,
    };
    return resultEnvelope(
      await this.commandBus.execute(
        new ProcessDocumentCallbackCommand(
          normalizedPayload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }
}
