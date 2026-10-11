import { Injectable } from "@nestjs/common";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  Prisma,
} from "@prisma/client";
import {
  RULE_SET_PREPARATION_MAX_ATTEMPTS,
  complianceRuleSetHistorySchema,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

@Injectable()
export class ComplianceRuleSetHistoryLoader {
  constructor(private readonly prisma: PrismaService) {}
  async load() {
    return this.prisma.$transaction(
      async (tx) => {
        const [ruleSets, preparations] = await Promise.all([
          tx.complianceRuleSetVersion.findMany({
            include: {
              corpusVersion: { select: { version: true } },
              _count: { select: { rules: true, assessmentRules: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
          tx.ruleSetPreparationRun.findMany({
            include: {
              ruleSet: { select: { id: true } },
              corpusVersion: { select: { version: true, status: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
        ]);
        const approved = toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        );
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
          ruleSets: ruleSets.map((row) => ({
            ruleSetVersionId: row.id,
            version: row.version,
            legalSourceVersionId: row.legalSourceVersionId,
            legalSourceVersion: row.corpusVersion.version,
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
            return {
              preparationRunId: row.id,
              legalSourceVersionId: row.legalSourceVersionId,
              legalSourceVersion: row.corpusVersion.version,
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
                attempt < RULE_SET_PREPARATION_MAX_ATTEMPTS &&
                row.corpusVersion.status === approved,
            };
          }),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
