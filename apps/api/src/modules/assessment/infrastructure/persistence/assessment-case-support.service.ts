import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DECISION_RESOLUTION_STATES,
  RULE_DECISION_REFERENCE_TYPES,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";

import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { criterionIdsOf } from "../../domain/rule-criteria.js";

export const ROOT_AUDIT_ACTOR = {
  id: AUDIT_ACTOR_IDS.assessmentRootAgent,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

export interface PinnedCase {
  caseRevision: number;
  legalPortfolioVersionId: string;
  repositorySnapshotId: string;
  repositoryScanJobId: string;
  repositoryCommit: string;
}

export function invalid(code: string, correlationId: string) {
  return problemException(code, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}

/**
 * Prisma reads/guards shared by the Assessment Root use-case handlers: pins, rule
 * coverage rows and decision-validation context. Holds no use-case orchestration.
 */
@Injectable()
export class AssessmentCaseSupport {
  async lockCase(tx: Prisma.TransactionClient, assessmentId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT 1 FROM "AssessmentCase" WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
    );
  }

  async loadPins(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
    _forWrite = false,
  ): Promise<PinnedCase> {
    void _forWrite;
    const row = await tx.assessmentCase.findUnique({ where: { assessmentId } });
    if (
      !row ||
      !row.legalPortfolioVersionId ||
      !row.repositorySnapshotId ||
      !row.repositoryScanJobId ||
      !row.repositoryCommit
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return {
      caseRevision: row.caseRevision,
      legalPortfolioVersionId: row.legalPortfolioVersionId,
      repositorySnapshotId: row.repositorySnapshotId,
      repositoryScanJobId: row.repositoryScanJobId,
      repositoryCommit: row.repositoryCommit,
    };
  }

  async requireCoverage(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    engineeringRuleId: string,
    correlationId: string,
  ) {
    const row = await tx.assessmentDecisionCoverage.findUnique({
      where: {
        assessmentId_engineeringRuleId: { assessmentId, engineeringRuleId },
      },
    });
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RULE_NOT_IN_PORTFOLIO,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    return row;
  }

  async advanceCoverageToResolved(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      engineeringRuleId: string;
      from: string;
      decisionId: string;
      decisionRevision: number;
    },
  ) {
    const key = {
      assessmentId_engineeringRuleId: {
        assessmentId: input.assessmentId,
        engineeringRuleId: input.engineeringRuleId,
      },
    };
    // Walk the transition table (PENDING/INVALIDATED -> INVESTIGATING -> RESOLVED).
    if (
      input.from === DECISION_RESOLUTION_STATES.PENDING ||
      input.from === DECISION_RESOLUTION_STATES.INVALIDATED
    ) {
      await tx.assessmentDecisionCoverage.update({
        where: key,
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING },
      });
    }
    await tx.assessmentDecisionCoverage.update({
      where: key,
      data: {
        resolutionState: DECISION_RESOLUTION_STATES.RESOLVED,
        currentDecisionId: input.decisionId,
        decisionRevision: input.decisionRevision,
      },
    });
  }

  async moveCoverageToWaiting(
    tx: Prisma.TransactionClient,
    input: { assessmentId: string; engineeringRuleId: string; from: string },
  ) {
    const key = {
      assessmentId_engineeringRuleId: {
        assessmentId: input.assessmentId,
        engineeringRuleId: input.engineeringRuleId,
      },
    };
    if (
      input.from === DECISION_RESOLUTION_STATES.PENDING ||
      input.from === DECISION_RESOLUTION_STATES.INVALIDATED
    ) {
      await tx.assessmentDecisionCoverage.update({
        where: key,
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING },
      });
    }
    if (input.from !== DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT) {
      await tx.assessmentDecisionCoverage.update({
        where: key,
        data: { resolutionState: DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT },
      });
    }
  }

  async buildValidationContext(
    tx: Prisma.TransactionClient,
    input: { assessmentId: string; pins: PinnedCase; decision: RuleDecision },
  ) {
    const { assessmentId, pins, decision } = input;
    const rule = await tx.engineeringRule.findUnique({
      where: {
        portfolioVersionId_engineeringRuleId: {
          portfolioVersionId: pins.legalPortfolioVersionId,
          engineeringRuleId: decision.engineeringRuleId,
        },
      },
      include: {
        legalRuleLinks: {
          include: { legalRule: { select: { id: true, legalRuleId: true } } },
        },
      },
    });
    let legalContextIds = new Set<string>();
    if (rule) {
      const linkedRowIds = rule.legalRuleLinks.map((link) => link.legalRule.id);
      legalContextIds = new Set(
        rule.legalRuleLinks.map((link) => link.legalRule.legalRuleId),
      );
      const relations = await tx.legalRuleContextRelation.findMany({
        where: {
          portfolioVersionId: pins.legalPortfolioVersionId,
          fromRuleId: { in: linkedRowIds },
          toRuleId: { not: null },
        },
        select: { toRuleId: true },
      });
      const targets = relations.flatMap((r) =>
        r.toRuleId ? [r.toRuleId] : [],
      );
      if (targets.length > 0) {
        const related = await tx.legalPortfolioRule.findMany({
          where: {
            id: { in: targets },
            portfolioVersionId: pins.legalPortfolioVersionId,
          },
          select: { legalRuleId: true },
        });
        for (const row of related) legalContextIds.add(row.legalRuleId);
      }
    }
    const references = [
      ...decision.references,
      ...decision.criteria.flatMap((criterion) => criterion.references),
    ];
    const evidenceIds = [
      ...new Set(
        references.flatMap((r) =>
          r.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE
            ? [r.evidenceId]
            : [],
        ),
      ),
    ];
    const factIds = [
      ...new Set(
        references.flatMap((r) =>
          r.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT
            ? [r.factId]
            : [],
        ),
      ),
    ];
    const [evidence, facts] = await Promise.all([
      tx.assessmentEvidence.findMany({
        where: { assessmentId, evidenceId: { in: evidenceIds } },
        select: { evidenceId: true, state: true, repositoryCommit: true },
      }),
      tx.assessmentCaseFact.findMany({
        where: { assessmentId, factId: { in: factIds } },
        select: { factId: true, state: true, caseRevision: true },
      }),
    ]);
    return {
      caseRevision: pins.caseRevision,
      pins: {
        legalPortfolioVersionId: pins.legalPortfolioVersionId,
        repositorySnapshotId: pins.repositorySnapshotId,
        repositoryCommit: pins.repositoryCommit,
      },
      rule: rule
        ? {
            engineeringRuleId: rule.engineeringRuleId,
            engineeringRuleVersion: rule.engineeringRuleVersion,
            criterionIds: new Set(criterionIdsOf(rule.criteria)),
            legalContextIds,
          }
        : null,
      evidence: new Map(evidence.map((row) => [row.evidenceId, row])),
      facts: new Map(facts.map((row) => [row.factId, row])),
    };
  }

  async portfolioIdentifiers(
    tx: Prisma.TransactionClient,
    portfolioVersionId: string,
  ): Promise<string[]> {
    const [rules, legal] = await Promise.all([
      tx.engineeringRule.findMany({
        where: { portfolioVersionId },
        select: { engineeringRuleId: true },
      }),
      tx.legalPortfolioRule.findMany({
        where: { portfolioVersionId },
        select: { legalRuleId: true },
      }),
    ]);
    return [
      ...rules.map((r) => r.engineeringRuleId),
      ...legal.map((r) => r.legalRuleId),
    ];
  }
}
