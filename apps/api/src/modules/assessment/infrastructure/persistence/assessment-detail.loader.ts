import {
  AUTHORED_LOCALIZATION_ENTITIES,
  AUTHORED_LOCALIZATION_CODES,
} from "@lcsp/contracts/assessment-domain";
import { Injectable, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { ruleDecisionSchema } from "@lcsp/contracts/assessment";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import {
  assessmentDetailSchema,
  assessmentListSchema,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { projectCanonicalAssessment } from "../../../../platform/runtime-events/canonical-assessment-projection.js";
import { LocalePresentationProjectionService } from "../presentation/locale-presentation-projection.service.js";

/** A consistent, read-only projection of persisted Assessment/Runtime/Case authorities. */
@Injectable()
export class AssessmentDetailLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectionService: LocalePresentationProjectionService,
  ) {}

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

  /**
   * Loads the full assessment detail for customer or admin view.
   *
   * Business purpose:
   * Retrieves canonical assessment state, lifecycle, domain case, and usage metrics scoped to the authenticated caller.
   *
   * Business rules:
   * - CUSTOMER callers may only access assessments they own; ownerId must be scoped directly at the persistence boundary.
   * - If no row matches or the owner does not match, a masked 404 (ASSESSMENT_NOT_FOUND) must be thrown.
   * - Preserves admin authorization checks without leaking customer operational details.
   *
   * Execution flow:
   * 1. Determine query filter based on caller role: scope by both assessmentId and sessionUserId for CUSTOMER.
   * 2. Query assessment record and related domain entities inside a transaction.
   * 3. Validate existence and owner identity; throw 404 if missing or mismatch.
   * 4. Project canonical assessment state and pinned rule set.
   * 5. Aggregate LLM token usage.
   * 6. Return composite AssessmentDetailDto.
   *
   * Failure cases:
   * - Assessment missing or owned by another user: throws NOT_FOUND with ASSESSMENT_NOT_FOUND.
   *
   * Side effects:
   * - Read-only database query; pure data projection.
   */
  async load(input: {
    assessmentId: string;
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
    locale?: string | null;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        // Explanatory comment (ASM-06 / ASM-OWNER-02):
        // Rationale (Why): BOLA prevention (OWASP API1:2023). Enforces tenant/owner isolation directly
        // at the persistence boundary instead of retrieving foreign data and checking ownership in memory.
        // Mechanism (How): For CUSTOMER role, the initial findUnique query includes ownerId in the where clause:
        // { id: input.assessmentId, ownerId: input.sessionUserId }.
        // Invariants: Strictly RBAC-scoped; foreign records are never loaded from database into application memory.
        const whereClause: Prisma.AssessmentWhereUniqueInput =
          input.subjectRole === AUTH_USER_ROLES.customer
            ? {
                id: input.assessmentId,
                ownerId: input.sessionUserId,
              }
            : { id: input.assessmentId };

        const row = await tx.assessment.findUnique({
          where: whereClause,
          include: {
            runtime: true,
            domainCase: {
              include: {
                coverage: {
                  include: { currentDecision: true },
                  orderBy: { assessmentRuleId: "asc" },
                },
                facts: {
                  include: { evidenceLinks: true },
                  orderBy: { createdAt: "asc" },
                },
                humanRequests: {
                  where: { resolvedFactId: { not: null } },
                  select: {
                    requestId: true,
                    resolvedFactId: true,
                    unresolvedFact: true,
                    answers: true,
                  },
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
        const pinnedRuleSet = domainCase?.ruleSetVersionId
          ? await tx.complianceRuleSetVersion.findUnique({
              where: { id: domainCase.ruleSetVersionId },
              include: {
                legalSourceVersion: { select: { version: true } },
                _count: { select: { rules: true, assessmentRules: true } },
              },
            })
          : null;
        const coverageRules =
          domainCase?.ruleSetVersionId && domainCase.coverage.length
            ? await tx.assessmentRule.findMany({
                where: {
                  ruleSetVersionId: domainCase.ruleSetVersionId,
                  OR: domainCase.coverage.map((item) => ({
                    assessmentRuleId: item.assessmentRuleId,
                    assessmentRuleVersion: item.assessmentRuleVersion,
                  })),
                },
                select: {
                  assessmentRuleId: true,
                  assessmentRuleVersion: true,
                  concept: true,
                  contentDigest: true,
                },
              })
            : [];
        if (
          domainCase?.ruleSetVersionId &&
          domainCase.coverage.some(
            (item) =>
              !coverageRules.some(
                (rule) =>
                  rule.assessmentRuleId === item.assessmentRuleId &&
                  rule.assessmentRuleVersion === item.assessmentRuleVersion,
              ),
          )
        )
          throw problemException(
            AUTHORED_LOCALIZATION_CODES.INCOMPLETE,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        const concepts =
          input.locale && domainCase?.ruleSetVersionId
            ? await this.projectionService.projectRuleConcepts(
                coverageRules,
                resolveResponseLanguage(input.locale),
                domainCase.ruleSetVersionId,
              )
            : new Map(
                coverageRules.map((rule) => [
                  rule.assessmentRuleId,
                  rule.concept,
                ]),
              );
        // Event history is bounded; assessment totals come from every persisted invocation.
        const usage = await tx.llmUsageEvent.aggregate({
          where: { assessmentId: row.id, userId: input.sessionUserId },
          _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
          _count: {
            id: true,
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
          },
        });
        const projectedCase = await (async () => {
          if (!domainCase) return null;
          const locale = input.locale
            ? resolveResponseLanguage(input.locale)
            : null;
          const rawDecisions = domainCase.coverage.flatMap(
            ({ currentDecision: decision }) => (decision ? [decision] : []),
          );
          let projectedDecisions = rawDecisions.map((decision) => ({
            decisionId: decision.decisionId,
            assessmentId: decision.assessmentId,
            assessmentRuleId: decision.assessmentRuleId,
            scopeId: decision.scopeId,
            decisionRevision: decision.decisionRevision,
            state: decision.state,
            decision: ruleDecisionSchema.parse(decision.decision),
            createdAt: decision.createdAt.toISOString(),
          }));
          const projectedFacts = domainCase.facts.map((fact) => ({
            factId: fact.factId,
            assessmentId: fact.assessmentId,
            caseRevision: fact.caseRevision,
            kind: fact.kind,
            authority: fact.authority,
            state: fact.state,
            statement: fact.statement,
            evidenceIds: fact.evidenceLinks.map((link) => link.evidenceId),
            createdAt: fact.createdAt.toISOString(),
          }));

          if (locale) {
            projectedDecisions = await Promise.all(
              projectedDecisions.map(async (d) => {
                const localized = await this.projectionService.projectDocument(
                  {
                    rationale: d.decision.rationale,
                    criteria: d.decision.criteria.map((c) => ({
                      rationale: c.rationale,
                    })),
                  },
                  locale,
                  input.assessmentId,
                  {
                    entityType: AUTHORED_LOCALIZATION_ENTITIES.DECISION,
                    entityId: d.decisionId,
                    canonicalRevision: String(d.decisionRevision),
                  },
                );
                return {
                  ...d,
                  decision: {
                    ...d.decision,
                    rationale: localized.rationale,
                    criteria: d.decision.criteria.map((c, index) => ({
                      ...c,
                      rationale:
                        localized.criteria[index]?.rationale ?? c.rationale,
                    })),
                  },
                };
              }),
            );
          }

          return {
            caseRevision: domainCase.caseRevision,
            auditRequestRevision: domainCase.auditRequestRevision,
            auditMode: domainCase.auditMode,
            ruleSetVersionId: domainCase.ruleSetVersionId,
            ruleSet: pinnedRuleSet
              ? {
                  ruleSetVersionId: pinnedRuleSet.id,
                  version: pinnedRuleSet.version,
                  legalSourceVersion: pinnedRuleSet.legalSourceVersion.version,
                  legalRequirementCount: pinnedRuleSet._count.rules,
                  assessmentRuleCount: pinnedRuleSet._count.assessmentRules,
                }
              : null,
            repositorySnapshotId: domainCase.repositorySnapshotId,
            repositoryScanJobId: domainCase.repositoryScanJobId,
            repositoryCommit: domainCase.repositoryCommit,
            coverage: domainCase.coverage.map((coverage) => ({
              assessmentRuleId: coverage.assessmentRuleId,
              concept:
                concepts.get(coverage.assessmentRuleId) ??
                coverage.assessmentRuleId,
              assessmentRuleVersion: coverage.assessmentRuleVersion,
              resolutionState: coverage.resolutionState,
              currentDecisionId: coverage.currentDecisionId,
              decisionRevision: coverage.decisionRevision,
            })),
            decisions: projectedDecisions,
            facts: projectedFacts,
            artifacts: domainCase.artifacts.map((artifact) => ({
              artifactId: artifact.artifactId,
              kind: artifact.kind,
              lifecycleState: artifact.lifecycleState,
              ruleSetVersionId: artifact.ruleSetVersionId,
              repositorySnapshotId: artifact.repositorySnapshotId,
              repositoryCommit: artifact.repositoryCommit,
              caseRevision: artifact.caseRevision,
              contentSha256:
                artifact.contentSha256?.replace(/^sha256:/u, "") ?? null,
              sizeBytes: artifact.sizeBytes,
              createdAt: artifact.createdAt.toISOString(),
            })),
          };
        })();

        return assessmentDetailSchema.parse({
          assessment_id: row.id,
          name: row.name,
          owner_id: row.ownerId,
          usage: {
            invocationCount: usage._count.id,
            ...Object.fromEntries(
              Object.entries(usage._sum)
                .filter(([, value]) => value !== null)
                .map(([key, value]) => [key, Number(value)]),
            ),
            partial: [
              usage._count.inputTokens,
              usage._count.outputTokens,
              usage._count.totalTokens,
            ].some((count) => count < usage._count.id),
          },
          lifecycle: projection.lifecycle,
          runtime: projection.runtime,
          case: projectedCase,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
          correlationId: input.correlationId,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
