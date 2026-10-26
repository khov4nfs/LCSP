import { Injectable } from "@nestjs/common";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  Prisma,
  SourceReviewState,
  ArtifactLifecycleState,
} from "@prisma/client";
import {
  complianceRuleSetHistorySchema,
  complianceRuleSetValidateResultSchema,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as OUTCOME,
  RULE_SET_PREPARATION_STAGES as STAGE,
  RULE_SET_PREPARATION_FAILURE_REASONS as FAILURE,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import { toPrismaLegalSourceLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { loadRuleSetPreparationAvailability } from "./rule-set-preparation-availability.loader.js";

@Injectable()
export class ComplianceRuleSetHistoryLoader {
  constructor(private readonly prisma: PrismaService) {}
  async load() {
    return this.prisma.$transaction(
      async (tx) => {
        const [ruleSets, preparations, preparation] = await Promise.all([
          tx.complianceRuleSetVersion.findMany({
            include: {
              legalSourceVersion: { select: { version: true } },
              _count: { select: { rules: true, assessmentRules: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
          tx.ruleSetPreparationRun.findMany({
            include: {
              ruleSet: { select: { id: true } },
              legalSourceVersion: { select: { version: true, status: true } },
              reviewFrontiers: {
                orderBy: { inventoryRevision: "desc" },
                take: 1,
                select: {
                  unitCount: true,
                  reviewedWithClaimsCount: true,
                  reviewedNoClaimsCount: true,
                  blockedCount: true,
                  items: {
                    where: { state: SourceReviewState.BLOCKED_REFERENCE },
                    take: 20,
                    select: {
                      sourceNodeId: true,
                      blockedReferenceIds: true,
                      reason: true,
                    },
                  },
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
          loadRuleSetPreparationAvailability(tx),
        ]);
        const approved = toPrismaLegalSourceLifecycleStatus(
          LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        );
        const documents = await tx.legalSourceDocument.findMany({
          where: {
            legalSourceVersionId: {
              in: preparations.map((r) => r.legalSourceVersionId),
            },
          },
          select: { legalSourceVersionId: true, documentId: true, title: true },
        });
        const drafts = preparations.length
          ? await tx.$queryRaw<
              Array<{
                preparationRunId: string;
                requirementCount: number;
                assessmentRuleCount: number;
                requirements: unknown;
                assessmentRules: unknown;
              }>
            >(Prisma.sql`
          SELECT d."preparationRunId",
            (SELECT count(*)::int FROM jsonb_each(d.draft->'legalRequirements')) AS "requirementCount",
            (SELECT count(*)::int FROM jsonb_each(d.draft->'assessmentRules')) AS "assessmentRuleCount",
            COALESCE((SELECT jsonb_agg(jsonb_build_object('legalRequirementId', e.key, 'title', e.value->>'title')) FROM (SELECT * FROM jsonb_each(d.draft->'legalRequirements') ORDER BY key LIMIT 20) e), '[]') AS requirements,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('assessmentRuleId', e.key, 'concept', e.value->>'concept')) FROM (SELECT * FROM jsonb_each(d.draft->'assessmentRules') ORDER BY key LIMIT 20) e), '[]') AS "assessmentRules"
          FROM "RuleSetPreparationAuthoringDraft" d JOIN "RuleSetPreparationRun" r ON r.id=d."preparationRunId" AND r."claimInventoryRevision"=d.revision
          WHERE r.id IN (${Prisma.join(preparations.map((r) => r.id))})
        `)
          : [];
        // Attempts are numbered per Legal Source Version in creation order.
        const attemptOf = new Map<string, number>();
        const latestOf = new Map<string, string>();
        const bySource = new Map<string, typeof preparations>();
        for (const run of preparations) {
          const group = bySource.get(run.legalSourceVersionId) ?? [];
          group.push(run);
          bySource.set(run.legalSourceVersionId, group);
        }
        for (const group of bySource.values()) {
          const oldestFirst = [...group].sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime(),
          );
          oldestFirst.forEach((run, index) => attemptOf.set(run.id, index + 1));
          latestOf.set(group[0].legalSourceVersionId, group[0].id);
        }
        return complianceRuleSetHistorySchema.parse({
          preparation,
          ruleSets: ruleSets.map((row) => ({
            ruleSetVersionId: row.id,
            version: row.version,
            legalSourceVersionId: row.legalSourceVersionId,
            legalSourceVersion: row.legalSourceVersion.version,
            ruleSetDigest: row.ruleSetDigest,
            lifecycleState: row.lifecycleState,
            activatedAt: row.activatedAt?.toISOString() ?? null,
            supersededAt: row.supersededAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            legalRequirementCount: row._count.rules,
            assessmentRuleCount: row._count.assessmentRules,
          })),
          preparations: preparations.map((row) => {
            const attempt = attemptOf.get(row.id) ?? 1;
            const frontier = row.reviewFrontiers[0];
            const completed =
              (frontier?.reviewedWithClaimsCount ?? 0) +
              (frontier?.reviewedNoClaimsCount ?? 0);
            const saved = drafts.find((d) => d.preparationRunId === row.id);
            const validation = complianceRuleSetValidateResultSchema.safeParse(
              row.draftValidation,
            );
            const active = ruleSets.some(
              (r) =>
                r.id === row.ruleSet?.id &&
                r.lifecycleState === ArtifactLifecycleState.ACTIVE,
            );
            const stage = active
              ? STAGE.ACTIVE
              : row.executionState === PrismaAgentExecutionState.SUCCEEDED
                ? STAGE.RULE_SET_READY
                : validation.success
                  ? validation.data.outcome === OUTCOME.PASSED
                    ? STAGE.RULE_SET_READY
                    : STAGE.VALIDATION_FAILED
                  : frontier && completed === frontier.unitCount
                    ? STAGE.VALIDATION_REQUIRED
                    : row.executionState === PrismaAgentExecutionState.QUEUED
                      ? STAGE.CORPUS_READY
                      : STAGE.PREPARING_RULE_SET;
            return {
              executionContract: row.executionContract,
              resumable:
                row.ruleSet === null &&
                row.legalSourceVersion.status === approved &&
                ((row.executionState === PrismaAgentExecutionState.PAUSED &&
                  row.failureReason === FAILURE.AGENT_BUDGET_REACHED) ||
                  (row.executionState === PrismaAgentExecutionState.FAILED &&
                    [FAILURE.MODEL_ERROR, FAILURE.RUNTIME_ERROR].includes(
                      row.failureReason as never,
                    ))),
              draft: {
                stage,
                sourceDocuments: documents
                  .filter(
                    (d) => d.legalSourceVersionId === row.legalSourceVersionId,
                  )
                  .map(({ documentId, title }) => ({ documentId, title })),
                coverage: {
                  total: frontier?.unitCount ?? 0,
                  completed,
                  blocked: frontier?.blockedCount ?? 0,
                },
                unresolvedReferences: (frontier?.items ?? [])
                  .flatMap((item) =>
                    item.blockedReferenceIds.map((referenceId) => ({
                      referenceId,
                      sourceNodeId: item.sourceNodeId,
                      reason: item.reason,
                    })),
                  )
                  .slice(0, 20),
                requirementCount: saved?.requirementCount ?? 0,
                assessmentRuleCount: saved?.assessmentRuleCount ?? 0,
                requirements: saved?.requirements ?? [],
                assessmentRules: saved?.assessmentRules ?? [],
                validation: validation.success ? validation.data : null,
                assessmentsCanUseRuleSet: active,
              },
              preparationRunId: row.id,
              legalSourceVersionId: row.legalSourceVersionId,
              legalSourceVersion: row.legalSourceVersion.version,
              executionState: row.executionState,
              ruleSetVersionId: row.ruleSet?.id ?? null,
              failureReason: row.failureReason,
              attempt,
              requestedBy: row.requestedBy,
              createdAt: row.createdAt.toISOString(),
              completedAt: row.completedAt?.toISOString() ?? null,
              retryable:
                row.executionState === PrismaAgentExecutionState.FAILED &&
                latestOf.get(row.legalSourceVersionId) === row.id &&
                row.legalSourceVersion.status === approved &&
                row.ruleSet === null &&
                preparation.legalSourceVersionId === row.legalSourceVersionId &&
                (preparation.canStart || preparation.canReplace),
            };
          }),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
