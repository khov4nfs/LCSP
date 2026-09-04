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
  GET_GAP_EVIDENCE_TRACE_TOOL,
  type GetGapEvidenceTraceInput,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { isRecord } from "../../../../common/utils/index.js";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { GetGapEvidenceTraceQuery } from "../../application/queries/get-gap-evidence-trace/get-gap-evidence-trace.query.js";

const ROW_REF = /^gap-row:[A-Za-z0-9:_-]{6,120}$/;
const INPUT_KEYS = new Set(["rowRef"]);

@Controller("assessments")
export class GapEvidenceTraceController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/gap-evidence-trace")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async getGapEvidenceTrace(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new GetGapEvidenceTraceQuery(
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
): GetGapEvidenceTraceInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }
  const { rowRef } = value;
  if (
    typeof rowRef !== "string" ||
    !ROW_REF.test(rowRef) ||
    GET_GAP_EVIDENCE_TRACE_TOOL.maxLayers <= 0
  ) {
    invalidRequest(correlationId);
  }
  return { rowRef };
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
