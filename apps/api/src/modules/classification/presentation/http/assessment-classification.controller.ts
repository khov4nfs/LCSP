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
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RerunClassificationCommand } from "../../application/commands/rerun-classification/rerun-classification.command.js";
import type { RerunClassificationRequestDto } from "../../application/contracts/classification/rerun-classification.contract.js";

interface ClassificationRequest {
  rbacContext: RbacRequestContext;
  correlationId: string;
}

@Controller("assessments/:assessmentId/classification")
export class AssessmentClassificationController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post("rerun")
  @HttpCode(201)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async rerun(
    @Param("assessmentId") assessmentId: string,
    @Body() payload: RerunClassificationRequestDto,
    @Req() request: ClassificationRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new RerunClassificationCommand(
          assessmentId,
          request.rbacContext,
          request.correlationId,
          payload?.reason,
        ),
      ),
    );
  }
}
