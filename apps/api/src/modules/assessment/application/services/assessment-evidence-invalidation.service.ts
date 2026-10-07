import { DECISION_RESOLUTION_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_RECORD_STATES,
} from "@lcsp/contracts/assessment-domain";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

@Injectable()
export class AssessmentEvidenceInvalidation {
  /** Every decision carries the case revision it reasoned over; a changed case makes
   * those accepted packets stale without changing their historical semantic content. */
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
      select: { decisionId: true, engineeringRuleId: true },
    });
    for (const decision of decisions) {
      await tx.assessmentRuleDecision.update({
        where: { decisionId: decision.decisionId },
        data: {
          state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
          invalidatedAt: new Date(),
        },
      });
      await tx.assessmentDecisionCoverage.update({
        where: {
          assessmentId_engineeringRuleId: {
            assessmentId,
            engineeringRuleId: decision.engineeringRuleId,
          },
        },
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVALIDATED },
      });
    }
    return decisions.map((row) => row.decisionId);
  }

  /**
   * A pinned source changed or evidence was found invalid: mark the evidence, every fact that
   * cites it and every ACCEPTED decision that references either INVALIDATED, and send affected
   * rules back to investigation. Deterministic dependency propagation only.
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
    const needles = [input.evidenceId, ...factIds];
    const dependants = await tx.$queryRaw<
      Array<{ decisionId: string; engineeringRuleId: string }>
    >(
      Prisma.sql`SELECT "decisionId", "engineeringRuleId" FROM "AssessmentRuleDecision"
        WHERE "assessmentId" = ${input.assessmentId} AND "state" = 'ACCEPTED'
          AND (${Prisma.join(
            needles.map((id) => Prisma.sql`"decision"::text LIKE ${`%${id}%`}`),
            " OR ",
          )})`,
    );
    for (const dependant of dependants) {
      await tx.assessmentRuleDecision.update({
        where: { decisionId: dependant.decisionId },
        data: {
          state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
          invalidatedAt: now,
        },
      });
      await tx.assessmentDecisionCoverage.update({
        where: {
          assessmentId_engineeringRuleId: {
            assessmentId: input.assessmentId,
            engineeringRuleId: dependant.engineeringRuleId,
          },
        },
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVALIDATED },
      });
    }
    return { invalidatedDecisionIds: dependants.map((row) => row.decisionId) };
  }
}
