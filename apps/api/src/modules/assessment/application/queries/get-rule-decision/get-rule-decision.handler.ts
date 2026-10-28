import {
  ASSESSMENT_DECISION_SCOPE,
  getRuleDecisionResultSchema,
  type GetRuleDecisionResult,
} from "@lcsp/contracts/assessment-domain";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetRuleDecisionQuery } from "./get-rule-decision.query.js";

/**
 * Reads one immutable model decision packet from the assessment's pinned Rule Set. The Root can
 * request the newest revision or a specific earlier revision when it needs to re-evaluate prior
 * work; the query does not classify, alter, or replace any decision.
 */
@QueryHandler(GetRuleDecisionQuery)
export class GetRuleDecisionHandler implements IQueryHandler<GetRuleDecisionQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
  ) {}

  /**
   * Business purpose: Let the authorized Assessment Root reload one rule's immutable prior
   *   decision packet so resumed investigations can inspect the actual submitted revision.
   *
   * Business rules:
   * - A valid worker lease must be bound to the requested assessment before any packet is read.
   * - Only the assessment's pinned Rule Set and assessment-wide decision scope are eligible.
   * - An omitted revision selects the newest packet; a supplied revision selects only that
   *   revision, regardless of whether its stored state is ACCEPTED, SUPERSEDED, or INVALIDATED.
   * - Missing packets return an empty result and the handler makes no semantic judgment.
   *
   * Execution flow:
   * 1. Authorize the worker lease and load the assessment's immutable case pins in one transaction.
   * 2. Read at most one decision row for the requested rule, pinned Rule Set, scope, and revision.
   * 3. Project and validate the persisted packet, returning it unchanged or an empty result.
   *
   * Failure cases:
   * - Invalid or expired leases, missing runtime state, and unavailable pins propagate their
   *   existing authority errors.
   * - A malformed persisted packet fails response validation rather than being repaired or
   *   interpreted by the query.
   *
   * Side effects:
   * - Read-only database transaction; no decision, coverage, lifecycle, event, or audit state is
   *   changed.
   */
  async execute(input: GetRuleDecisionQuery): Promise<GetRuleDecisionResult> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        assessmentId: input.assessmentId,
        leaseToken: input.leaseToken,
        correlationId: input.correlationId,
        requireActive: false,
      });
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      return tx.assessmentRuleDecision.findFirst({
        where: {
          assessmentId: input.assessmentId,
          ruleSetVersionId: pins.ruleSetVersionId,
          assessmentRuleId: input.assessmentRuleId,
          scopeId: ASSESSMENT_DECISION_SCOPE,
          ...(input.revision === undefined
            ? {}
            : { decisionRevision: input.revision }),
        },
        orderBy: { decisionRevision: "desc" },
        select: {
          decisionId: true,
          assessmentId: true,
          assessmentRuleId: true,
          scopeId: true,
          decisionRevision: true,
          state: true,
          decision: true,
          createdAt: true,
        },
      });
    });

    return getRuleDecisionResultSchema.parse({
      records: row
        ? [
            {
              decisionId: row.decisionId,
              assessmentId: row.assessmentId,
              assessmentRuleId: row.assessmentRuleId,
              scopeId: row.scopeId,
              decisionRevision: row.decisionRevision,
              state: row.state,
              decision: row.decision,
              createdAt: row.createdAt.toISOString(),
            },
          ]
        : [],
    });
  }
}
