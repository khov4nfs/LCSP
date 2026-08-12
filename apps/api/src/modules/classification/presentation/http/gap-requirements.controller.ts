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
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
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
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.gapRequirementsRead)
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
          request.pbacContext.organizationId,
          input,
          request.pbacContext.userId,
          request.pbacContext.policyId,
          request.pbacContext.policyVersion,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
