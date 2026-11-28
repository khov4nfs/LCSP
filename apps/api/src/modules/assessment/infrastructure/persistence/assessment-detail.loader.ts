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
  assessmentAdminMetadataListSchema,
  assessmentAdminMetadataSchema,
  assessmentDetailSchema,
  assessmentListSchema,
  type AssessmentAdminMetadata,
  type AssessmentDetail,
  type AssessmentReadDetail,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { projectCanonicalAssessment } from "../../../../platform/runtime-events/canonical-assessment-projection.js";
import { LocalePresentationProjectionService } from "../presentation/locale-presentation-projection.service.js";

type AssessmentDetailLoadInput = {
  assessmentId: string;
  sessionUserId: string;
  subjectRole: AuthUserRole;
  correlationId: string;
  locale?: string | null;
};

/** A consistent, read-only projection of persisted Assessment/Runtime/Case authorities. */
@Injectable()
export class AssessmentDetailLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectionService: LocalePresentationProjectionService,
  ) {}

  /**
   * Business purpose:
   * Lists assessments using the data projection authorized for the caller's RBAC role.
   *
   * Business rules:
   * CUSTOMER sees only owned assessments with the customer projection; ADMIN sees all
   * assessments through the strict operational-metadata allowlist and never impersonates an owner.
   *
   * Execution flow:
   * 1. Build the role-appropriate persistence predicate.
   * 2. Select the ADMIN metadata allowlist or load the CUSTOMER canonical runtime projection.
   * 3. Count rows in the same repeatable-read transaction and return a validated page.
   *
   * Failure cases:
   * Invalid persisted values fail strict contract parsing; database failures roll back the read transaction.
   *
   * Side effects:
   * Read-only database access and response projection; no assessment state is changed.
   */
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
        const lifecycleWhere = {
          ...(input.lifecycleState
            ? { lifecycleState: input.lifecycleState }
            : {}),
        };

        if (input.subjectRole === AUTH_USER_ROLES.admin) {
          // Why: ADMIN needs fleet-level operations metadata, but loading relations would
          // expose customer content before response validation. How: Prisma selects only
          // the approved scalar fields plus the runtime execution-state scalar.
          const [rows, total] = await Promise.all([
            tx.assessment.findMany({
              where: lifecycleWhere,
              select: {
                id: true,
                ownerId: true,
                name: true,
                lifecycleState: true,
                runtime: { select: { executionState: true } },
                createdAt: true,
                updatedAt: true,
              },
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              skip: (input.page - 1) * input.pageSize,
              take: input.pageSize,
            }),
            tx.assessment.count({ where: lifecycleWhere }),
          ]);
          return assessmentAdminMetadataListSchema.parse({
            assessments: rows.map((row) => ({
              assessment_id: row.id,
              owner_id: row.ownerId,
              name: row.name,
              lifecycle_state: row.lifecycleState,
              execution_state: row.runtime?.executionState ?? null,
              created_at: row.createdAt.toISOString(),
              updated_at: row.updatedAt.toISOString(),
            })),
            total,
            page: input.page,
            page_size: input.pageSize,
            correlationId: input.correlationId,
          });
        }

        // Customer ownership is part of the database predicate, preserving the BOLA boundary.
        const where = { ownerId: input.sessionUserId, ...lifecycleWhere };
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
   * Loads the assessment view authorized for the caller's RBAC role.
   *
   * Business purpose:
   * Retrieves customer-owned canonical content or ADMIN operational metadata without crossing the customer-content boundary.
   *
   * Business rules:
   * - CUSTOMER callers may only access assessments they own; ownerId is scoped directly at the persistence boundary.
   * - ADMIN callers receive only the dedicated metadata allowlist and never hydrate case, evidence, report, provenance, usage, or runtime payloads.
   * - If no row matches or the owner does not match, a masked 404 (ASSESSMENT_NOT_FOUND) must be thrown.
   * - Both roles use strict response contracts; ADMIN metadata permission never grants mutation authority.
   *
   * Execution flow:
   * 1. For ADMIN, select and return only the metadata allowlist.
   * 2. For CUSTOMER, query by assessmentId and ownerId with related domain entities.
   * 3. Validate existence and project canonical assessment state and pinned rule set.
   * 4. Aggregate owner-scoped LLM token usage and return the customer detail contract.
   *
   * Failure cases:
   * - Assessment missing or foreign-owned for CUSTOMER: throws masked NOT_FOUND with ASSESSMENT_NOT_FOUND.
   * - Invalid persisted canonical state fails closed through the existing conflict contract.
   *
   * Side effects:
   * - Read-only database query; pure data projection.
   */
  // Literal-role overloads retain precise result types for internal callers while
  // controllers with a runtime role correctly receive the RBAC read union.
  async load(
    input: AssessmentDetailLoadInput & {
      subjectRole: typeof AUTH_USER_ROLES.customer;
    },
  ): Promise<AssessmentDetail>;
  async load(
    input: AssessmentDetailLoadInput & {
      subjectRole: typeof AUTH_USER_ROLES.admin;
    },
  ): Promise<AssessmentAdminMetadata>;
  async load(input: AssessmentDetailLoadInput): Promise<AssessmentReadDetail>;
  async load(input: AssessmentDetailLoadInput): Promise<AssessmentReadDetail> {
    return this.prisma.$transaction(
      async (tx) => {
        if (input.subjectRole === AUTH_USER_ROLES.admin) {
          // Why: a response-level omit is too late because sensitive relations would already
          // be hydrated. How: this branch ends before the customer query and uses a strict
          // persistence allowlist, preserving metadata-only access as a data-minimization invariant.
          const row = await tx.assessment.findUnique({
            where: { id: input.assessmentId },
            select: {
              id: true,
              ownerId: true,
              name: true,
              lifecycleState: true,
              runtime: { select: { executionState: true } },
              createdAt: true,
              updatedAt: true,
            },
          });
          if (!row) {
            throw problemException(
              ASSESSMENT_ERROR_CODES.notFound,
              input.correlationId,
              { status: HttpStatus.NOT_FOUND },
            );
          }
          return assessmentAdminMetadataSchema.parse({
            assessment_id: row.id,
            owner_id: row.ownerId,
            name: row.name,
            lifecycle_state: row.lifecycleState,
            execution_state: row.runtime?.executionState ?? null,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
            correlationId: input.correlationId,
          });
        }

        // Explanatory comment (ASM-06 / ASM-OWNER-02):
        // Rationale (Why): BOLA prevention (OWASP API1:2023). Enforces tenant/owner isolation directly
        // at the persistence boundary instead of retrieving foreign data and checking ownership in memory.
        // Mechanism (How): For CUSTOMER role, the initial findUnique query includes ownerId in the where clause:
        // { id: input.assessmentId, ownerId: input.sessionUserId }.
        // Invariants: Strictly RBAC-scoped; foreign records are never loaded from database into application memory.
        const whereClause: Prisma.AssessmentWhereUniqueInput = {
          id: input.assessmentId,
          ownerId: input.sessionUserId,
        };

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
        if (!row || row.ownerId !== input.sessionUserId) {
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
