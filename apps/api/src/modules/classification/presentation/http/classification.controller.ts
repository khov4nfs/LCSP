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
import { AcceptClassificationCommand } from "../../application/commands/accept-classification/accept-classification.command.js";
import type { AcceptClassificationDto } from "../../application/contracts/classification/classification-result-callback.contract.js";

@Controller("internal/classification")
export class ClassificationController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post("result-callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async acceptClassificationResult(
    @Body() payload: AcceptClassificationDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptClassificationCommand(
          payload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }
}
