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
  GAP_REMEDIATION_TEMPLATE_IDS,
  type GapRemediationTemplateId,
  type ProposeGapRemediationInput,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ProposeGapRemediationQuery } from "../../application/queries/propose-gap-remediation/propose-gap-remediation.query.js";

const ROW_REF = /^gap-row:[A-Za-z0-9:_-]{6,120}$/;
const INPUT_KEYS = new Set(["rowRef", "templateId"]);
const TEMPLATE_IDS = new Set<GapRemediationTemplateId>(
  Object.values(GAP_REMEDIATION_TEMPLATE_IDS),
);

@Controller("assessments")
export class GapRemediationController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/gap-remediation")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.gapRemediationPropose)
  async proposeGapRemediation(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new ProposeGapRemediationQuery(
          assessmentId,
          request.pbacContext.organizationId,
          input,
          request.pbacContext.userId,
          correlationId,
        ),
      ),
    );
  }
}

function parseInput(
  value: unknown,
  correlationId: string,
): ProposeGapRemediationInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }
  const { rowRef, templateId } = value;
  if (
    typeof rowRef !== "string" ||
    !ROW_REF.test(rowRef) ||
    !isGapRemediationTemplateId(templateId)
  ) {
    invalidRequest(correlationId);
  }
  return { rowRef, templateId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isGapRemediationTemplateId(
  value: unknown,
): value is GapRemediationTemplateId {
  return (
    typeof value === "string" &&
    TEMPLATE_IDS.has(value as GapRemediationTemplateId)
  );
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
