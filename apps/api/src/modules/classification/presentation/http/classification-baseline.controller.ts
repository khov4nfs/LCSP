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
import type { GetClassificationBaselineInput } from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { GetClassificationBaselineQuery } from "../../application/queries/get-classification-baseline/get-classification-baseline.query.js";

const PROFILE_REF = /^profile_[A-Za-z0-9_-]{8,80}$/;
const RULE_MATCH_REF = /^rule-match:[A-Za-z0-9_-]{6,80}$/;
const POLICY_REF = /^policy_[A-Za-z0-9_-]{8,80}$/;
const INPUT_KEYS = new Set([
  "verifiedProfileId",
  "ruleMatchRef",
  "policyProfileVersionId",
]);

@Controller("assessments")
export class ClassificationBaselineController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/classification-baseline")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.classificationBaselineRead)
  async getClassificationBaseline(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new GetClassificationBaselineQuery(
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
): GetClassificationBaselineInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }
  const { verifiedProfileId, ruleMatchRef, policyProfileVersionId } = value;
  if (
    typeof verifiedProfileId !== "string" ||
    !PROFILE_REF.test(verifiedProfileId) ||
    typeof ruleMatchRef !== "string" ||
    !RULE_MATCH_REF.test(ruleMatchRef) ||
    typeof policyProfileVersionId !== "string" ||
    !POLICY_REF.test(policyProfileVersionId)
  ) {
    invalidRequest(correlationId);
  }
  return {
    verifiedProfileId,
    ruleMatchRef,
    policyProfileVersionId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
