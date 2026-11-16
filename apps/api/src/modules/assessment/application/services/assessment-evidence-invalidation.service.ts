import { DECISION_RESOLUTION_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_RECORD_STATES,
} from "@lcsp/contracts/assessment-domain";
import { Injectable } from "@nestjs/common";
import { ArtifactLifecycleState, Prisma } from "@prisma/client";

@Injectable()
export class AssessmentEvidenceInvalidation {
  /**
   * Business purpose: Fail closed when a new fact has no complete rule dependency scope.
   *
   * Business rules:
   * - Generic Root-accepted facts do not declare which rules they affect, so every older accepted decision is potentially stale.
   * - Historical decision packets remain immutable and are invalidated rather than rewritten to the new case revision.
   *
   * Execution flow:
   * 1. Find accepted decisions authored before the new case revision.
   * 2. Invalidate each decision and only the coverage row that still points to it.
   * 3. Invalidate the current final report when any supporting decision changed.
   *
   * Failure cases:
   * - Database errors abort the caller's transaction; uncertain dependency scope never preserves an older conclusion.
   *
   * Side effects:
   * - Updates accepted decision state, current decision coverage, and an active final-report lifecycle; history is retained.
   */
  async invalidateCaseRevisionInTx(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    caseRevision: number,
  ) {
    const decisions = await tx.assessmentRuleDecision.findMany({
      where: {
        assessmentId,
        caseRevision: { lt: caseRevision },
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
      },
      select: { decisionId: true, assessmentRuleId: true },
    });
    for (const decision of decisions) {
      await tx.assessmentRuleDecision.update({
        where: { decisionId: decision.decisionId },
        data: {
          state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
          invalidatedAt: new Date(),
        },
      });
      await tx.assessmentDecisionCoverage.updateMany({
        where: {
          assessmentId,
          assessmentRuleId: decision.assessmentRuleId,
          currentDecisionId: decision.decisionId,
        },
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVALIDATED },
      });
    }
    if (decisions.length > 0) {
      await this.invalidateFinalReportInTx(tx, assessmentId);
    }
    return decisions.map((row) => row.decisionId);
  }

  /**
   * Business purpose: Propagate invalid source support through direct and indirect decision dependencies without discarding unrelated verified work.
   *
   * Business rules:
   * - Direct evidence references and fact references whose supporting evidence changed both invalidate a decision.
   * - Accepted historical decisions without a complete normalized dependency graph fail closed and are invalidated.
   * - JSON text matching is not dependency authority and is never used to preserve or invalidate a legal conclusion.
   *
   * Execution flow:
   * 1. Invalidate the evidence and each accepted fact linked to it.
   * 2. Resolve direct evidence edges, indirect fact edges, and incomplete historical accepted decisions.
   * 3. Invalidate the affected immutable decisions, their current coverage, and a derived active final report.
   *
   * Failure cases:
   * - Missing or incomplete dependency metadata expands invalidation rather than preserving a potentially stale decision; database errors roll back the transaction.
   *
   * Side effects:
   * - Updates evidence, facts, decision states, coverage, and report lifecycle while retaining all historical records and dependency rows.
   */
  async invalidateEvidenceInTx(
    tx: Prisma.TransactionClient,
    input: { assessmentId: string; evidenceId: string },
  ): Promise<{ invalidatedDecisionIds: string[] }> {
    const now = new Date();
    await tx.assessmentEvidence.updateMany({
      where: {
        assessmentId: input.assessmentId,
        evidenceId: input.evidenceId,
        state: ASSESSMENT_RECORD_STATES.ACCEPTED,
      },
      data: { state: ASSESSMENT_RECORD_STATES.INVALIDATED, invalidatedAt: now },
    });
    const links = await tx.assessmentCaseFactEvidence.findMany({
      where: { assessmentId: input.assessmentId, evidenceId: input.evidenceId },
      select: { factId: true },
    });
    const factIds = links.map((link) => link.factId);
    if (factIds.length > 0) {
      await tx.assessmentCaseFact.updateMany({
        where: {
          assessmentId: input.assessmentId,
          factId: { in: factIds },
          state: ASSESSMENT_RECORD_STATES.ACCEPTED,
        },
        data: {
          state: ASSESSMENT_RECORD_STATES.INVALIDATED,
          invalidatedAt: now,
        },
      });
    }
    const [direct, indirect, incomplete] = await Promise.all([
      tx.assessmentRuleDecision.findMany({
        where: {
          assessmentId: input.assessmentId,
          state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
          evidenceDependencies: {
            some: { evidenceId: input.evidenceId },
          },
        },
        select: { decisionId: true, assessmentRuleId: true },
      }),
      factIds.length > 0
        ? tx.assessmentRuleDecision.findMany({
            where: {
              assessmentId: input.assessmentId,
              state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
              factDependencies: {
                some: { factId: { in: factIds } },
              },
            },
            select: { decisionId: true, assessmentRuleId: true },
          })
        : Promise.resolve(
            [] as Array<{ decisionId: string; assessmentRuleId: string }>,
          ),
      tx.assessmentRuleDecision.findMany({
        where: {
          assessmentId: input.assessmentId,
          state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
          dependencyGraphComplete: false,
        },
        select: { decisionId: true, assessmentRuleId: true },
      }),
    ]);
    const dependantsById = new Map(
      [...direct, ...indirect, ...incomplete].map((row) => [
        row.decisionId,
        row,
      ]),
    );
    const dependants = [...dependantsById.values()].sort((a, b) =>
      a.decisionId.localeCompare(b.decisionId),
    );
    for (const dependant of dependants) {
      await tx.assessmentRuleDecision.update({
        where: { decisionId: dependant.decisionId },
        data: {
          state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
          invalidatedAt: now,
        },
      });
      await tx.assessmentDecisionCoverage.updateMany({
        where: {
          assessmentId: input.assessmentId,
          assessmentRuleId: dependant.assessmentRuleId,
          currentDecisionId: dependant.decisionId,
        },
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVALIDATED },
      });
    }
    if (dependants.length > 0) {
      await this.invalidateFinalReportInTx(tx, input.assessmentId);
    }
    return { invalidatedDecisionIds: dependants.map((row) => row.decisionId) };
  }

  /**
   * Business purpose: Prevent an immutable final report from remaining active after its assessment basis changes.
   *
   * Business rules:
   * - Only the active final report is changed; historical bytes, digest, pins, and artifact identity remain immutable.
   *
   * Execution flow:
   * 1. Mark the assessment's active FINAL_REPORT artifact INVALID inside the caller's transaction.
   *
   * Failure cases:
   * - Missing reports are a no-op; persistence errors abort the surrounding transaction.
   *
   * Side effects:
   * - Updates only AssessmentArtifact.lifecycleState from ACTIVE to INVALID.
   */
  async invalidateFinalReportInTx(
    tx: Prisma.TransactionClient,
    assessmentId: string,
  ): Promise<void> {
    await tx.assessmentArtifact.updateMany({
      where: {
        assessmentId,
        kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
        lifecycleState: ArtifactLifecycleState.ACTIVE,
      },
      data: { lifecycleState: ArtifactLifecycleState.INVALID },
    });
  }
}
