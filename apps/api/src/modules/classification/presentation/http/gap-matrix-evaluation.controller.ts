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
  EVALUATE_GAP_MATRIX_TOOL,
  type EvaluateGapMatrixInput,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { EvaluateGapMatrixQuery } from "../../application/queries/evaluate-gap-matrix/evaluate-gap-matrix.query.js";

const MATRIX_REF = /^matrix:[A-Za-z0-9_-]{6,80}$/;
const EVIDENCE_REF = /^(evidence|citation|coverage):[A-Za-z0-9:_-]{6,100}$/;
const INPUT_KEYS = new Set(["matrixRef", "evidenceRefs"]);

@Controller("assessments")
export class GapMatrixEvaluationController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/gap-matrix-evaluation")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async evaluateGapMatrix(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new EvaluateGapMatrixQuery(
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
): EvaluateGapMatrixInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }
  const { matrixRef, evidenceRefs } = value;
  if (
    typeof matrixRef !== "string" ||
    !MATRIX_REF.test(matrixRef) ||
    !Array.isArray(evidenceRefs) ||
    evidenceRefs.length === 0 ||
    evidenceRefs.length > EVALUATE_GAP_MATRIX_TOOL.maxEvidenceRefs ||
    evidenceRefs.some(
      (ref) => typeof ref !== "string" || !EVIDENCE_REF.test(ref),
    ) ||
    new Set(evidenceRefs).size !== evidenceRefs.length
  ) {
    invalidRequest(correlationId);
  }
  return {
    matrixRef,
    evidenceRefs: evidenceRefs.filter(
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
