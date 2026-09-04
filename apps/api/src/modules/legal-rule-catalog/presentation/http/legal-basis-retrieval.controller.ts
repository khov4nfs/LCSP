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
  RETRIEVE_LEGAL_BASIS_TOOL,
  type RetrieveLegalBasisInput,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { isRecord } from "../../../../common/utils/index.js";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { RetrieveLegalBasisQuery } from "../../application/queries/retrieve-legal-basis/retrieve-legal-basis.query.js";

const CORPUS_REF = /^corpus_[A-Za-z0-9_-]{8,80}$/;
const RULE_REF = /^rule_[A-Za-z0-9_-]{6,80}$/;
const CHUNK_REF = /^chunk_[A-Za-z0-9_-]{6,80}$/;
const INPUT_KEYS = new Set(["corpusVersionId", "selectors", "includeContext"]);
const SELECTOR_KEYS = new Set(["ruleIds", "chunkIds"]);

@Controller("assessments")
export class LegalBasisRetrievalController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/legal-basis")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async retrieveLegalBasis(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new RetrieveLegalBasisQuery(
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
): RetrieveLegalBasisInput {
  if (!isRecord(value) || hasUnexpectedKeys(value, INPUT_KEYS)) {
    invalidRequest(correlationId);
  }
  const corpusVersionId = value.corpusVersionId;
  const includeContext = value.includeContext;
  if (
    typeof corpusVersionId !== "string" ||
    !CORPUS_REF.test(corpusVersionId)
  ) {
    invalidRequest(correlationId);
  }
  if (typeof includeContext !== "boolean") invalidRequest(correlationId);

  const selectors = value.selectors;
  if (!isRecord(selectors) || hasUnexpectedKeys(selectors, SELECTOR_KEYS)) {
    invalidRequest(correlationId);
  }
  const ruleIds = selectorIds(selectors.ruleIds, RULE_REF, correlationId);
  const chunkIds = selectorIds(selectors.chunkIds, CHUNK_REF, correlationId);
  if (
    ruleIds.length + chunkIds.length === 0 ||
    ruleIds.length + chunkIds.length > RETRIEVE_LEGAL_BASIS_TOOL.maxSelectors
  ) {
    invalidRequest(correlationId);
  }
  return {
    corpusVersionId,
    selectors: {
      ...(ruleIds.length > 0 ? { ruleIds } : {}),
      ...(chunkIds.length > 0 ? { chunkIds } : {}),
    },
    includeContext,
  };
}

function selectorIds(
  value: unknown,
  pattern: RegExp,
  correlationId: string,
): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > RETRIEVE_LEGAL_BASIS_TOOL.maxSelectors ||
    value.some((item) => typeof item !== "string" || !pattern.test(item)) ||
    new Set(value).size !== value.length
  ) {
    invalidRequest(correlationId);
  }
  return value.filter((item): item is string => typeof item === "string");
}

function hasUnexpectedKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
): boolean {
  return Object.keys(value).some((key) => !allowedKeys.has(key));
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
