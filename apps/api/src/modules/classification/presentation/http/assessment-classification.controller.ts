import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import type { PbacRequestContext } from "../../../../platform/pbac/interfaces/pbac-request.interface.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { RerunClassificationCommand } from "../../application/commands/rerun-classification/rerun-classification.command.js";
import type { RerunClassificationRequestDto } from "../../application/contracts/classification/rerun-classification.contract.js";

interface ClassificationRequest {
  pbacContext: PbacRequestContext;
  correlationId: string;
}

@Controller("assessments/:assessmentId/classification")
export class AssessmentClassificationController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post("rerun")
  @HttpCode(201)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.classificationRun)
  async rerun(
    @Param("assessmentId") assessmentId: string,
    @Body() payload: RerunClassificationRequestDto,
    @Req() request: ClassificationRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new RerunClassificationCommand(
          assessmentId,
          request.pbacContext,
          request.correlationId,
          payload?.reason,
        ),
      ),
    );
  }
}
