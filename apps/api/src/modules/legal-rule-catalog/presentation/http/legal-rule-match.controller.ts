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
import {
  GET_LEGAL_RULE_MATCH_TOOL,
  type GetLegalRuleMatchInput,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { GetLegalRuleMatchQuery } from "../../application/queries/get-legal-rule-match/get-legal-rule-match.query.js";

const PROFILE_REF = /^profile_[A-Za-z0-9_-]{8,80}$/;
const RULE_REF = /^rule_[A-Za-z0-9_-]{6,80}$/;
const CITATION_REF = /^citation:chunk_[A-Za-z0-9_-]{6,80}$/;
const INPUT_KEYS = new Set(["verifiedProfileId", "ruleId", "citationRefs"]);

@Controller("assessments")
export class LegalRuleMatchController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/legal-rule-match")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.legalRuleMatchRead)
  async getLegalRuleMatch(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new GetLegalRuleMatchQuery(
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
): GetLegalRuleMatchInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }
  const { verifiedProfileId, ruleId, citationRefs } = value;
  if (
    typeof verifiedProfileId !== "string" ||
    !PROFILE_REF.test(verifiedProfileId) ||
    typeof ruleId !== "string" ||
    !RULE_REF.test(ruleId) ||
    !Array.isArray(citationRefs) ||
    citationRefs.length === 0 ||
    citationRefs.length > GET_LEGAL_RULE_MATCH_TOOL.maxCitationRefs ||
    citationRefs.some(
      (ref) => typeof ref !== "string" || !CITATION_REF.test(ref),
    ) ||
    new Set(citationRefs).size !== citationRefs.length
  ) {
    invalidRequest(correlationId);
  }
  return {
    verifiedProfileId,
    ruleId,
    citationRefs: citationRefs.filter(
      (ref): ref is string => typeof ref === "string",
    ),
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
