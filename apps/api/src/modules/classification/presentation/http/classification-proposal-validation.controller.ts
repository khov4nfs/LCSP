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
  VALIDATE_CLASSIFICATION_PROPOSAL_TOOL,
  type ValidateClassificationProposalInput,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ValidateClassificationProposalQuery } from "../../application/queries/validate-classification-proposal/validate-classification-proposal.query.js";

const BASELINE_REF = /^baseline:[A-Za-z0-9_-]{6,80}$/;
const CANDIDATE_LABEL = /^CLASSIFICATION_[A-Z0-9_]{3,64}$/;
const CITATION_REF = /^citation:chunk_[A-Za-z0-9_-]{6,80}$/;
const INPUT_KEYS = new Set(["baselineRef", "candidateLabel", "citationRefs"]);

@Controller("assessments")
export class ClassificationProposalValidationController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post(":assessmentId/classification-proposal-validation")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.classificationProposalValidate)
  async validateClassificationProposal(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new ValidateClassificationProposalQuery(
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
): ValidateClassificationProposalInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }
  const { baselineRef, candidateLabel, citationRefs } = value;
  if (
    typeof baselineRef !== "string" ||
    !BASELINE_REF.test(baselineRef) ||
    typeof candidateLabel !== "string" ||
    !CANDIDATE_LABEL.test(candidateLabel) ||
    !Array.isArray(citationRefs) ||
    citationRefs.length === 0 ||
    citationRefs.length >
      VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.maxCitationRefs ||
    citationRefs.some(
      (ref) => typeof ref !== "string" || !CITATION_REF.test(ref),
    ) ||
    new Set(citationRefs).size !== citationRefs.length
  ) {
    invalidRequest(correlationId);
  }
  return {
    baselineRef,
    candidateLabel,
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
