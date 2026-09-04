import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import type { GetGapRequirementsInput } from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { isRecord } from "../../../../common/utils/index.js";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { GetGapRequirementsQuery } from "../../application/queries/get-gap-requirements/get-gap-requirements.query.js";

const CLASSIFICATION_REF = /^classification:[A-Za-z0-9_-]{6,80}$/;
const POLICY_REF = /^policy_[A-Za-z0-9_-]{8,80}$/;
const INPUT_KEYS = new Set(["classificationRef", "policyProfileVersionId"]);

@Controller("assessments")
export class GapRequirementsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/gap-requirements")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async getGapRequirements(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new GetGapRequirementsQuery(
          assessmentId,
          input,
          request.rbacContext.userId,
          request.rbacContext.role,
          correlationId,
        ),
      ),
    );
  }
}

function parseInput(
  value: unknown,
  correlationId: string,
): GetGapRequirementsInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }
  const { classificationRef, policyProfileVersionId } = value;
  if (
    typeof classificationRef !== "string" ||
    !CLASSIFICATION_REF.test(classificationRef) ||
    typeof policyProfileVersionId !== "string" ||
    !POLICY_REF.test(policyProfileVersionId)
  ) {
    invalidRequest(correlationId);
  }
  return { classificationRef, policyProfileVersionId };
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
