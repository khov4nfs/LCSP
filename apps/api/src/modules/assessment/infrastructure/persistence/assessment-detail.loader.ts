import { Injectable, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  assessmentDetailSchema,
  assessmentListSchema,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { projectCanonicalAssessment } from "../../../../platform/runtime-events/canonical-assessment-projection.js";

/** A consistent, read-only projection of persisted Assessment/Runtime/Case authorities. */
@Injectable()
export class AssessmentDetailLoader {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: {
    sessionUserId: string;
    subjectRole: AuthUserRole;
    page: number;
    pageSize: number;
    lifecycleState?: import("@lcsp/contracts/assessment").AssessmentLifecycleState;
    correlationId: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const where = {
          ownerId: input.sessionUserId,
          ...(input.lifecycleState
            ? { lifecycleState: input.lifecycleState }
            : {}),
        };
        if (input.subjectRole !== AUTH_USER_ROLES.customer)
          return assessmentListSchema.parse({
            assessments: [],
            total: 0,
            page: input.page,
            page_size: input.pageSize,
            correlationId: input.correlationId,
          });
        const [rows, total] = await Promise.all([
          tx.assessment.findMany({
            where,
            include: { runtime: true },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            skip: (input.page - 1) * input.pageSize,
            take: input.pageSize,
          }),
          tx.assessment.count({ where }),
        ]);
        return assessmentListSchema.parse({
          assessments: rows.map((row) => {
            const projection = projectCanonicalAssessment(
              row.id,
              row,
              input.correlationId,
            );
            return {
              assessment_id: row.id,
              name: row.name,
              lifecycle: projection.lifecycle,
              runtime: projection.runtime,
              created_at: row.createdAt.toISOString(),
              updated_at: row.updatedAt.toISOString(),
            };
          }),
          total,
          page: input.page,
          page_size: input.pageSize,
          correlationId: input.correlationId,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async load(input: {
    assessmentId: string;
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.assessment.findUnique({
          where: { id: input.assessmentId },
          include: {
            runtime: true,
            domainCase: {
              include: {
                coverage: {
                  include: { currentDecision: true },
                  orderBy: { engineeringRuleId: "asc" },
                },
                facts: {
                  include: { evidenceLinks: true },
                  orderBy: { createdAt: "asc" },
                },
                artifacts: { orderBy: { createdAt: "asc" } },
              },
            },
          },
        });
        if (
          !row ||
          input.subjectRole !== AUTH_USER_ROLES.customer ||
          row.ownerId !== input.sessionUserId
        ) {
          throw problemException(
            ASSESSMENT_ERROR_CODES.notFound,
            input.correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }
        const projection = projectCanonicalAssessment(
          row.id,
          row,
          input.correlationId,
        );
        const domainCase = row.domainCase;
        return assessmentDetailSchema.parse({
          assessment_id: row.id,
          name: row.name,
          owner_id: row.ownerId,
          lifecycle: projection.lifecycle,
          runtime: projection.runtime,
          case: domainCase
            ? {
                caseRevision: domainCase.caseRevision,
                legalPortfolioVersionId: domainCase.legalPortfolioVersionId,
                repositorySnapshotId: domainCase.repositorySnapshotId,
                repositoryScanJobId: domainCase.repositoryScanJobId,
                repositoryCommit: domainCase.repositoryCommit,
                coverage: domainCase.coverage.map((coverage) => ({
                  engineeringRuleId: coverage.engineeringRuleId,
                  engineeringRuleVersion: coverage.engineeringRuleVersion,
                  resolutionState: coverage.resolutionState,
                  currentDecisionId: coverage.currentDecisionId,
                  decisionRevision: coverage.decisionRevision,
                })),
                decisions: domainCase.coverage.flatMap(
                  ({ currentDecision: decision }) =>
                    decision
                      ? [
                          {
                            decisionId: decision.decisionId,
                            assessmentId: decision.assessmentId,
                            engineeringRuleId: decision.engineeringRuleId,
                            scopeId: decision.scopeId,
                            decisionRevision: decision.decisionRevision,
                            state: decision.state,
                            decision: decision.decision,
                            createdAt: decision.createdAt.toISOString(),
                          },
                        ]
                      : [],
                ),
                facts: domainCase.facts.map((fact) => ({
                  factId: fact.factId,
                  assessmentId: fact.assessmentId,
                  caseRevision: fact.caseRevision,
                  kind: fact.kind,
                  authority: fact.authority,
                  state: fact.state,
                  statement: fact.statement,
                  evidenceIds: fact.evidenceLinks.map(
                    (link) => link.evidenceId,
                  ),
                  createdAt: fact.createdAt.toISOString(),
                })),
                artifacts: domainCase.artifacts.map((artifact) => ({
                  artifactId: artifact.artifactId,
                  kind: artifact.kind,
                  lifecycleState: artifact.lifecycleState,
                  legalPortfolioVersionId: artifact.legalPortfolioVersionId,
                  repositorySnapshotId: artifact.repositorySnapshotId,
                  repositoryCommit: artifact.repositoryCommit,
                  caseRevision: artifact.caseRevision,
                  contentSha256:
                    artifact.contentSha256?.replace(/^sha256:/u, "") ?? null,
                  sizeBytes: artifact.sizeBytes,
                  createdAt: artifact.createdAt.toISOString(),
                })),
              }
            : null,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
          correlationId: input.correlationId,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
