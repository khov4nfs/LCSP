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
import { CommandBus } from "@nestjs/cqrs";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  CLASSIFICATION_REVIEW_SUBMISSION_TOOL,
  type SubmitClassificationReviewInput,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { SubmitClassificationReviewCommand } from "../../application/commands/submit-classification-review/submit-classification-review.command.js";

const PROPOSAL_GATE_REF = /^classification-gate:[A-Za-z0-9_-]{8,120}$/;
const BASELINE_REF = /^baseline:[A-Za-z0-9_-]{6,80}$/;
const CANDIDATE_LABEL = /^CLASSIFICATION_[A-Z0-9_]{3,64}$/;
const CITATION_REF = /^citation:chunk_[A-Za-z0-9_-]{6,80}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INPUT_KEYS = new Set([
  "proposalGateRef",
  "baselineRef",
  "candidateLabel",
  "citationRefs",
  "idempotencyKey",
]);

@Controller("assessments")
export class ClassificationReviewSubmissionController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post(":assessmentId/classification-review-submission")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.classificationReviewSubmit)
  async submitClassificationForIndependentReview(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.commandBus.execute(
        new SubmitClassificationReviewCommand(
          assessmentId,
          request.pbacContext.organizationId,
          input,
          request.pbacContext.userId,
          request.pbacContext.policyId ?? "policy:unknown",
          request.pbacContext.policyVersion ?? "version:unknown",
          correlationId,
        ),
      ),
    );
  }
}

function parseInput(
  value: unknown,
  correlationId: string,
): SubmitClassificationReviewInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }
  const {
    proposalGateRef,
    baselineRef,
    candidateLabel,
    citationRefs,
    idempotencyKey,
  } = value;
  if (
    typeof proposalGateRef !== "string" ||
    !PROPOSAL_GATE_REF.test(proposalGateRef) ||
    typeof baselineRef !== "string" ||
    !BASELINE_REF.test(baselineRef) ||
    typeof candidateLabel !== "string" ||
    !CANDIDATE_LABEL.test(candidateLabel) ||
    !Array.isArray(citationRefs) ||
    citationRefs.length === 0 ||
    citationRefs.length >
      CLASSIFICATION_REVIEW_SUBMISSION_TOOL.maxCitationRefs ||
    citationRefs.some(
      (ref) => typeof ref !== "string" || !CITATION_REF.test(ref),
    ) ||
    new Set(citationRefs).size !== citationRefs.length ||
    typeof idempotencyKey !== "string" ||
    !UUID.test(idempotencyKey)
  ) {
    invalidRequest(correlationId);
  }
  return {
    proposalGateRef,
    baselineRef,
    candidateLabel,
    citationRefs: citationRefs.filter(
      (ref): ref is string => typeof ref === "string",
    ),
    idempotencyKey,
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
