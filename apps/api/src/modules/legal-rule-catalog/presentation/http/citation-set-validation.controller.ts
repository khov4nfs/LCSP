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
  VALIDATE_CITATION_SET_TOOL,
  type ValidateCitationSetInput,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { isRecord } from "../../../../common/utils/index.js";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ValidateCitationSetQuery } from "../../application/queries/validate-citation-set/validate-citation-set.query.js";

const CORPUS_REF = /^corpus_[A-Za-z0-9_-]{8,80}$/;
const MATCH_REF = /^legal_rule_match_[A-Za-z0-9_-]{6,80}$/;
const CITATION_REF = /^citation:chunk_[A-Za-z0-9_-]{6,80}$/;
const INPUT_KEYS = new Set([
  "corpusVersionId",
  "legalRuleMatchId",
  "citationRefs",
]);

@Controller("assessments")
export class CitationSetValidationController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/citation-set-validation")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async validateCitationSet(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new ValidateCitationSetQuery(
          assessmentId,
          input,
          request.rbacContext.userId,
          correlationId,
        ),
      ),
    );
  }
}

function parseInput(
  value: unknown,
  correlationId: string,
): ValidateCitationSetInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  )
    invalidRequest(correlationId);
  const { corpusVersionId, legalRuleMatchId, citationRefs } = value;
  if (
    typeof corpusVersionId !== "string" ||
    !CORPUS_REF.test(corpusVersionId) ||
    typeof legalRuleMatchId !== "string" ||
    !MATCH_REF.test(legalRuleMatchId) ||
    !Array.isArray(citationRefs) ||
    citationRefs.length === 0 ||
    citationRefs.length > VALIDATE_CITATION_SET_TOOL.maxCitationRefs ||
    citationRefs.some(
      (ref) => typeof ref !== "string" || !CITATION_REF.test(ref),
    ) ||
    new Set(citationRefs).size !== citationRefs.length
  )
    invalidRequest(correlationId);
  return {
    corpusVersionId,
    legalRuleMatchId,
    citationRefs: citationRefs.filter(
      (ref): ref is string => typeof ref === "string",
    ),
  };
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
