import { Injectable, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { ruleDecisionSchema } from "@lcsp/contracts/assessment";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import {
  ASSESSMENT_FACT_AUTHORITIES,
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
    private readonly projectionService: LocalePresentationProjectionService = new LocalePresentationProjectionService(),
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

  async load(input: {
    assessmentId: string;
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
    locale?: string | null;
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
                  orderBy: { assessmentRuleId: "asc" },
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
        const pinnedRuleSet = domainCase?.ruleSetVersionId
          ? await tx.complianceRuleSetVersion.findUnique({
              where: { id: domainCase.ruleSetVersionId },
              include: {
                legalSourceVersion: { select: { version: true } },
                _count: { select: { rules: true, assessmentRules: true } },
              },
            })
          : null;
        const concepts = new Map(
          domainCase?.ruleSetVersionId
            ? (
                await tx.assessmentRule.findMany({
                  where: { ruleSetVersionId: domainCase.ruleSetVersionId },
                  select: { assessmentRuleId: true, concept: true },
                })
              ).map((rule) => [rule.assessmentRuleId, rule.concept] as const)
            : [],
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
          let projectedFacts = domainCase.facts.map((fact) => ({
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
            const textsToProject: string[] = [];
            for (const d of projectedDecisions) {
              textsToProject.push(d.decision.rationale);
              for (const c of d.decision.criteria) {
                textsToProject.push(c.rationale);
              }
            }
            const humanProvidedParts = new Map<
              string,
              { prefix: string; answer: string }
            >();
            for (const f of projectedFacts) {
              if (f.authority === ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED) {
                textsToProject.push(f.statement);
              } else if (
                f.authority === ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED
              ) {
                const sepIdx = f.statement.indexOf(": ");
                if (sepIdx !== -1) {
                  const prefix = f.statement.slice(0, sepIdx);
                  const answer = f.statement.slice(sepIdx + 2);
                  humanProvidedParts.set(f.factId, { prefix, answer });
                  textsToProject.push(prefix);
                }
              }
            }
            if (textsToProject.length > 0) {
              const projections = await this.projectionService.projectBatch(
                textsToProject,
                locale,
              );
              projectedDecisions = projectedDecisions.map((d) => ({
                ...d,
                decision: {
                  ...d.decision,
                  rationale:
                    projections.get(d.decision.rationale) ??
                    d.decision.rationale,
                  criteria: d.decision.criteria.map((c) => ({
                    ...c,
                    rationale: projections.get(c.rationale) ?? c.rationale,
                  })),
                },
              }));
              projectedFacts = projectedFacts.map((f) => {
                if (f.authority === ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED) {
                  return {
                    ...f,
                    statement: projections.get(f.statement) ?? f.statement,
                  };
                }
                if (
                  f.authority === ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED
                ) {
                  const parts = humanProvidedParts.get(f.factId);
                  if (parts) {
                    const projectedPrefix =
                      projections.get(parts.prefix) ?? parts.prefix;
                    return {
                      ...f,
                      statement: `${projectedPrefix}: ${parts.answer}`,
                    };
                  }
                }
                return f;
              });
            }
          }

          return {
            caseRevision: domainCase.caseRevision,
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
