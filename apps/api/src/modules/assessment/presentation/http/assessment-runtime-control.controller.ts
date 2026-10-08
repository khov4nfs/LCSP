import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS,
  ASSESSMENT_RUNTIME_CONTROL_STATES,
  isAssessmentRuntimeControlState,
  type AssessmentRuntimeControlAcknowledgement,
} from "@lcsp/contracts/evidence";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import {
  problemException,
  resultEnvelope,
} from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AssessmentRuntimeControlService } from "../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";

import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import {
  claimAssessmentRootRequestSchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import { assessmentRuntimeControlRequestSchema } from "@lcsp/contracts/evidence";
import { GetRuntimeControlQuery } from "../../application/queries/get-runtime-control/get-runtime-control.query.js";
import { ControlAssessmentRuntimeCommand } from "../../application/commands/control-assessment-runtime/control-assessment-runtime.command.js";

const idPipe = () =>
  new ZodValidationPipe(
    claimAssessmentRootRequestSchema.shape.assessmentId,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
const controlPipe = () =>
  new ZodValidationPipe(
    assessmentRuntimeControlRequestSchema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );

@Controller("assessments/:assessmentId/runtime")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class AssessmentRuntimeControlController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}
  @Get("control")
  async current(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queries.execute(
        new GetRuntimeControlQuery(
          assessmentId,
          req.rbacContext,
          req.correlationId ?? assessmentId,
        ),
      ),
    );
  }
  @Post("stop")
  async stop(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Body(controlPipe()) body: { targetRunId: string },
  ) {
    return resultEnvelope(
      await this.commands.execute(
        new ControlAssessmentRuntimeCommand(
          assessmentId,
          req.rbacContext,
          ASSESSMENT_RUNTIME_CONTROL_ACTIONS.stop,
          body.targetRunId,
          req.correlationId ?? assessmentId,
        ),
      ),
    );
  }
  @Post("continue")
  async resume(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Body(controlPipe()) body: { targetRunId: string },
  ) {
    return resultEnvelope(
      await this.commands.execute(
        new ControlAssessmentRuntimeCommand(
          assessmentId,
          req.rbacContext,
          ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
          body.targetRunId,
          req.correlationId ?? assessmentId,
        ),
      ),
    );
  }
}

@Controller("internal/assessment-runtime-controls")
@UseGuards(WorkerApiKeyGuard)
export class InternalAssessmentRuntimeControlController {
  constructor(private readonly controls: AssessmentRuntimeControlService) {}

  @Post()
  acknowledge(@Body() body: AssessmentRuntimeControlAcknowledgement) {
    if (
      !body ||
      !isAssessmentRuntimeControlState(body.state) ||
      ![
        ASSESSMENT_RUNTIME_CONTROL_STATES.running,
        ASSESSMENT_RUNTIME_CONTROL_STATES.stopped,
        ASSESSMENT_RUNTIME_CONTROL_STATES.completed,
      ].includes(body.state as never) ||
      ![body.assessmentId, body.targetRunId, body.correlationId].every(
        (value) => typeof value === "string" && value.trim(),
      ) ||
      !body.threadId ||
      !body.boundary ||
      !body.logicalRunId ||
      (body.state === ASSESSMENT_RUNTIME_CONTROL_STATES.running &&
        (!body.context ||
          typeof body.context !== "object" ||
          Array.isArray(body.context))) ||
      (body.state === ASSESSMENT_RUNTIME_CONTROL_STATES.stopped &&
        (!body.checkpoint ||
          typeof body.checkpoint !== "object" ||
          Array.isArray(body.checkpoint)))
    ) {
      throw problemException(
        SHARED_ERROR_CODES.validationFailed,
        "runtime-control",
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    return this.controls.acknowledge(body).then(resultEnvelope);
  }
}
