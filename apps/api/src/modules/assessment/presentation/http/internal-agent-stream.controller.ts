import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import {
  workerAgentStreamEventRequestSchema,
  type WorkerAgentStreamEventRequest,
} from "@lcsp/contracts/evidence";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { PublishAgentStreamEventCommand } from "../../application/commands/publish-agent-stream-event/publish-agent-stream-event.command.js";

@Controller("internal/assessment-runtime")
@UseGuards(WorkerApiKeyGuard)
export class InternalAgentStreamController {
  constructor(private readonly commands: CommandBus) {}

  @Post("agent-stream-events")
  @HttpCode(202)
  async recordAgentStreamEvent(
    @Body(
      new ZodValidationPipe(
        workerAgentStreamEventRequestSchema,
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        422,
      ),
    )
    payload: WorkerAgentStreamEventRequest,
    @Headers("x-correlation-id") correlationId?: string,
    @Headers("x-assessment-lease") leaseToken?: string,
  ) {
    return resultEnvelope(
      await this.commands.execute(
        new PublishAgentStreamEventCommand(payload, correlationId, leaseToken),
      ),
    );
  }
}
