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
  CLASSIFICATION_REVIEW_DECISION_CODES,
  CLASSIFICATION_REVIEW_DECISIONS,
  type ClassificationReviewDecision,
  type ClassificationReviewDecisionCode,
  type ResolveClassificationReviewInput,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ResolveClassificationReviewCommand } from "../../application/commands/resolve-classification-review/resolve-classification-review.command.js";

const REVIEW_REQUEST_REF = /^classification-review:[A-Za-z0-9_-]{8,120}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INPUT_KEYS = new Set([
  "reviewRequestRef",
  "decision",
  "decisionCode",
  "idempotencyKey",
]);

@Controller("assessments")
export class ClassificationReviewResolutionController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post(":assessmentId/classification-review-resolution")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.classificationReviewResolve)
  async resolveIndependentClassificationReview(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(body, correlationId);
    return resultEnvelope(
      await this.commandBus.execute(
        new ResolveClassificationReviewCommand(
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
): ResolveClassificationReviewInput {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key))
  ) {
    invalidRequest(correlationId);
  }

  const { reviewRequestRef, decision, decisionCode, idempotencyKey } = value;
  if (
    typeof reviewRequestRef !== "string" ||
    !REVIEW_REQUEST_REF.test(reviewRequestRef) ||
    !isReviewDecision(decision) ||
    !isReviewDecisionCode(decisionCode) ||
    typeof idempotencyKey !== "string" ||
    !UUID.test(idempotencyKey)
  ) {
    invalidRequest(correlationId);
  }

  return {
    reviewRequestRef,
    decision,
    decisionCode,
    idempotencyKey,
  };
}

function isReviewDecision(
  value: unknown,
): value is ClassificationReviewDecision {
  return (
    typeof value === "string" &&
    Object.values(CLASSIFICATION_REVIEW_DECISIONS).includes(
      value as ClassificationReviewDecision,
    )
  );
}

function isReviewDecisionCode(
  value: unknown,
): value is ClassificationReviewDecisionCode {
  return (
    typeof value === "string" &&
    Object.values(CLASSIFICATION_REVIEW_DECISION_CODES).includes(
      value as ClassificationReviewDecisionCode,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
