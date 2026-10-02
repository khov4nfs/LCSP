import type { EngineeringRuleAssessment } from "@prisma/client";
import type { AcceptedRuleAssessment } from "@lcsp/contracts/evidence";

import { fromPrismaRuleAnalysisStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";

/** Rebuilds the wire body of an accepted per-rule assessment from its ledger row. */
export function rowToAcceptedRuleAssessment(
  row: EngineeringRuleAssessment,
): AcceptedRuleAssessment {
  return {
    resultId: row.resultId,
    assessmentId: row.assessmentId,
    engineeringRuleId: row.engineeringRuleId,
    engineeringRuleVersion: row.engineeringRuleVersion,
    repositoryVersion: row.repositoryVersion,
    contextRevision: row.contextRevision,
    status: fromPrismaRuleAnalysisStatus(row.status),
    criteria: row.criteria as unknown as AcceptedRuleAssessment["criteria"],
    limitations: row.limitations,
    execution: row.execution as unknown as AcceptedRuleAssessment["execution"],
  };
}
