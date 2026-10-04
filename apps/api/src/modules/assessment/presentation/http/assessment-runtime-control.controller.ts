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
import { AssessmentInterviewRuntimeService } from "../../application/services/assessment-interview-runtime.service.js";

@Controller("assessments/:assessmentId/runtime")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class AssessmentRuntimeControlController {
  constructor(
    private readonly controls: AssessmentRuntimeControlService,
    private readonly interview: AssessmentInterviewRuntimeService,
  ) {}

  @Get("control")
  async current(
    @Param("assessmentId") assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.interview.assertAssessmentVisible(assessmentId, req.rbacContext);
    return resultEnvelope(await this.controls.current(assessmentId));
  }

  @Post("stop")
  async stop(
    @Param("assessmentId") assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { targetRunId?: string },
  ) {
    await this.interview.assertAssessmentVisible(assessmentId, req.rbacContext);
    return resultEnvelope(
      await this.controls.request({
        assessmentId,
        actorId: req.rbacContext.userId,
        correlationId: req.correlationId ?? assessmentId,
        action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.stop,
        targetRunId: body?.targetRunId,
      }),
    );
  }

  @Post("continue")
  async resume(
    @Param("assessmentId") assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { targetRunId?: string },
  ) {
    await this.interview.assertAssessmentVisible(assessmentId, req.rbacContext);
    return resultEnvelope(
      await this.controls.request({
        assessmentId,
        actorId: req.rbacContext.userId,
        correlationId: req.correlationId ?? assessmentId,
        action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
        targetRunId: body?.targetRunId,
      }),
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
      (body.state === ASSESSMENT_RUNTIME_CONTROL_STATES.running &&
        (!body.context ||
          typeof body.context !== "object" ||
          Array.isArray(body.context) ||
          !body.threadId ||
          !body.boundary ||
          !body.logicalRunId))
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
