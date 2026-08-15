import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ProcessDocumentCallbackCommand } from "../../application/commands/process-document-callback/process-document-callback.command.js";
import type { DocumentCallbackRequest } from "../../application/contracts/document/document-callback.contract.js";

/**
 * Exposes the worker-authenticated callback endpoint used to update document generation requests.
 */
@Controller("internal/document-requests")
export class InternalDocumentController {
  /**
   * Creates the internal controller with the document callback command dispatcher.
   *
   * @param commandBus - CQRS command bus used to process worker document callbacks.
   */
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Accepts a document-generation callback from the worker and dispatches it for persistence/audit processing.
   *
   * @param payload - Worker callback describing document status and optional artifact/blocked fields.
   * @param correlationId - Optional upstream correlation identifier; a UUID is generated when absent.
   * @returns The standard result envelope containing callback acknowledgement metadata.
   */
  @Post(":documentRequestId/callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async processCallback(
    @Body() payload: DocumentCallbackRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ProcessDocumentCallbackCommand(
          payload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }
}
