import { HUMAN_RESOLUTION_REQUEST_STATUSES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  assessmentRootContextSchema,
  type AssessmentRootContext,
} from "@lcsp/contracts/assessment-domain";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetRootContextQuery } from "./get-root-context.query.js";

@QueryHandler(GetRootContextQuery)
export class GetRootContextHandler implements IQueryHandler<GetRootContextQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
  ) {}

  async execute(input: GetRootContextQuery): Promise<AssessmentRootContext> {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const [coverage, facts, evidence, openRequests] = await Promise.all([
        tx.assessmentDecisionCoverage.findMany({
          where: { assessmentId: input.assessmentId },
          orderBy: { engineeringRuleId: "asc" },
        }),
        tx.assessmentCaseFact.findMany({
          where: { assessmentId: input.assessmentId },
          orderBy: { caseRevision: "asc" },
          include: { evidenceLinks: { select: { evidenceId: true } } },
        }),
        tx.assessmentEvidence.findMany({
          where: { assessmentId: input.assessmentId },
          orderBy: { createdAt: "asc" },
        }),
        tx.assessmentHumanRequest.findMany({
          where: {
            assessmentId: input.assessmentId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
          select: { requestId: true },
        }),
      ]);
      return assessmentRootContextSchema.parse({
        assessmentId: input.assessmentId,
        threadId: run.threadId,
        lifecycleState: run.lifecycleState,
        lifecycleRevision: run.lifecycleRevision,
        caseRevision: pins.caseRevision,
        legalPortfolioVersionId: pins.legalPortfolioVersionId,
        repositorySnapshotId: pins.repositorySnapshotId,
        repositoryScanJobId: pins.repositoryScanJobId,
        repositoryCommit: pins.repositoryCommit,
        decisionScopeId: ASSESSMENT_DECISION_SCOPE,
        coverage: coverage.map((row) => ({
          engineeringRuleId: row.engineeringRuleId,
          engineeringRuleVersion: row.engineeringRuleVersion,
          resolutionState: row.resolutionState,
          currentDecisionId: row.currentDecisionId,
          decisionRevision: row.decisionRevision,
        })),
        facts: facts.map((fact) => ({
          factId: fact.factId,
          assessmentId: fact.assessmentId,
          caseRevision: fact.caseRevision,
          kind: fact.kind,
          authority: fact.authority,
          state: fact.state,
          statement: fact.statement,
          evidenceIds: fact.evidenceLinks.map((link) => link.evidenceId),
          createdAt: fact.createdAt.toISOString(),
        })),
        evidence: evidence.map((row) => ({
          evidenceId: row.evidenceId,
          assessmentId: row.assessmentId,
          type: row.type,
          state: row.state,
          repositoryCommit: row.repositoryCommit,
          contentSha256: row.contentSha256,
          payload: row.payload as Record<string, unknown>,
          createdAt: row.createdAt.toISOString(),
        })),
        openHumanRequestIds: openRequests.map((row) => row.requestId),
      });
    });
  }
}
