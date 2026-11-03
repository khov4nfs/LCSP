import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ROOT_CAPACITY_ERROR_CODES,
  rootCapacityRegisterSchema,
  rootCapacityReportSchema,
  rootCapacityReserveSchema,
  rootCapacityReleaseSchema,
  rootCapacityControlSchema,
} from "@lcsp/contracts/assessment-domain";
import type { z } from "zod";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { AssessmentRootCapacityService } from "../../application/services/assessment-root-capacity.service.js";

const body = (schema: z.ZodTypeAny) =>
  new ZodValidationPipe(schema, ROOT_CAPACITY_ERROR_CODES.invalid, 422);

/** Worker protocol: bounded, authenticated operational measurements and physical receipts. */
@Controller("internal/assessment-root-capacity")
@UseGuards(WorkerApiKeyGuard)
export class AssessmentRootCapacityController {
  constructor(private readonly capacity: AssessmentRootCapacityService) {}

  @Get("registration")
  async registration() {
    return resultEnvelope(await this.capacity.registration());
  }

  @Post("register")
  @HttpCode(200)
  async register(
    @Body(body(rootCapacityRegisterSchema))
    input: z.infer<typeof rootCapacityRegisterSchema>,
  ) {
    return resultEnvelope(await this.capacity.register(input));
  }
  @Post("report")
  @HttpCode(200)
  async report(
    @Body(body(rootCapacityReportSchema))
    input: z.infer<typeof rootCapacityReportSchema>,
  ) {
    return resultEnvelope(await this.capacity.report(input));
  }
  @Post("reserve")
  @HttpCode(200)
  async reserve(
    @Body(body(rootCapacityReserveSchema))
    input: z.infer<typeof rootCapacityReserveSchema>,
  ) {
    return resultEnvelope(await this.capacity.reserve(input));
  }
  @Post("quiesce")
  @HttpCode(200)
  async quiesce(
    @Body(body(rootCapacityReleaseSchema))
    input: z.infer<typeof rootCapacityReleaseSchema>,
  ) {
    return resultEnvelope(await this.capacity.release(input));
  }
}

/** Existing administrator authorization protects operational controls and their audit. */
@Controller("admin/assessment-root-capacity")
@UseGuards(RbacGuard)
export class AdminAssessmentRootCapacityController {
  constructor(private readonly capacity: AssessmentRootCapacityService) {}

  @Get()
  @RequireRoles(AUTH_USER_ROLES.admin)
  async status() {
    return resultEnvelope(await this.capacity.status());
  }

  @Post()
  @HttpCode(200)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async control(
    @Body(body(rootCapacityControlSchema))
    input: z.infer<typeof rootCapacityControlSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.capacity.control(input, request.rbacContext.userId),
    );
  }
}
