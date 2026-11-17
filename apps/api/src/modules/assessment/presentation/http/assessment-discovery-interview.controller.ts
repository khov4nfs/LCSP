import { randomUUID } from "node:crypto";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  discoveryInterviewPageQuerySchema,
  reviewDiscoveryInterviewAnswerSchema,
  submitDiscoveryInterviewAnswerSchema,
  type ReviewDiscoveryInterviewAnswer,
  type SubmitDiscoveryInterviewAnswer,
} from "@lcsp/contracts/assessment-domain";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AssessmentDiscoveryInterviewService } from "../../application/services/assessment-discovery-interview.service.js";

const parse = (schema: z.ZodType) =>
  new ZodValidationPipe(
    schema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
const uuid = () => parse(z.uuid());

/** Owner-only pre-scope Discovery context proposals; no Assessment Root lease or rule authorization. */
@Controller("assessments/:assessmentId/discovery-runs/:runId/context-answers")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class AssessmentDiscoveryInterviewController {
  constructor(
    private readonly interview: AssessmentDiscoveryInterviewService,
  ) {}

  /**
   * Business purpose: Give the customer a bounded review ledger of source-backed operational answers.
   * Business rules:
   * - RBAC plus assessment owner and current source pins authorize every read.
   * Execution flow:
   * 1. Validate identity, pagination and forward the owner-scoped request.
   * Failure cases:
   * - Missing ownership, invalid pages, or stale source coordinates reject.
   * Side effects:
   * - Read-only database projection.
   */
  @Get()
  async list(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Param("runId", uuid()) runId: string,
    @Query(parse(discoveryInterviewPageQuerySchema))
    page: z.infer<typeof discoveryInterviewPageQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interview.list({
        assessmentId,
        runId,
        ownerId: req.rbacContext.userId,
        correlationId: req.correlationId || randomUUID(),
        ...page,
      }),
    );
  }

  /**
   * Business purpose: Save an explicit user answer as a review-only proposal before selecting rules.
   * Business rules:
   * - Client-provided question/use-case must match an exact pinned Discovery question.
   * - This endpoint cannot grant legal authority or accept a fact.
   * Execution flow:
   * 1. Validate typed input and delegate source-authorized proposal persistence.
   * Failure cases:
   * - Cross-assessment questions, active audits and malformed input reject atomically.
   * Side effects:
   * - Appends a pending context proposal and, if missing, a canonical FactNeed.
   */
  @Post()
  @HttpCode(200)
  async submit(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Param("runId", uuid()) runId: string,
    @Body(parse(submitDiscoveryInterviewAnswerSchema))
    body: SubmitDiscoveryInterviewAnswer,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interview.submit({
        assessmentId,
        runId,
        ownerId: req.rbacContext.userId,
        correlationId: req.correlationId || randomUUID(),
        answer: body,
      }),
    );
  }

  /**
   * Business purpose: Explicitly confirm or reject one previously proposed operational answer.
   * Business rules:
   * - The owner must hold the current case revision and cannot approve an ambiguous answer.
   * - Only confirmation creates an evidence-backed HUMAN_PROVIDED fact; it never selects an AssessmentRule.
   * Execution flow:
   * 1. Validate identifiers, action and expected revision, then enforce the pre-scope review transaction.
   * Failure cases:
   * - Pending conflicts, stale revisions, invalid content, or foreign ownership reject without mutation.
   * Side effects:
   * - Marks the proposal reviewed; acceptance also creates case evidence, fact and FactNeed resolution.
   */
  @Post(":proposalId/review")
  @HttpCode(200)
  async review(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Param("runId", uuid()) runId: string,
    @Param("proposalId", uuid()) proposalId: string,
    @Body(parse(reviewDiscoveryInterviewAnswerSchema))
    body: ReviewDiscoveryInterviewAnswer,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interview.review({
        assessmentId,
        runId,
        proposalId,
        ownerId: req.rbacContext.userId,
        correlationId: req.correlationId || randomUUID(),
        review: body,
      }),
    );
  }
}
