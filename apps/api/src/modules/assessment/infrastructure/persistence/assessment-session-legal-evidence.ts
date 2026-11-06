import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

type SessionRuleSetPin = {
  id?: string;
  ruleSetVersionId?: string;
  ruleSetId?: string;
  version?: string;
  ruleSetVersion?: string;
};

/**
 * Loads pinned review legal evidence from the database for session export.
 */

/**
 * Business purpose: Load pinned legal rule definitions and structure for the exported assessment session.
 * Business rules: Rules must correspond to the pinned rule set snapshot; no mutations or dynamic rule alterations.
 * Execution flow:
 * 1. Extract ruleSetId/ruleSetVersionId from pinned rule set reference.
 * 2. Fetch associated rules from assessment rule persistence.
 * 3. Format into structured legal evidence preserving official legal citations.
 * Failure cases: Missing rule set returns empty legal evidence without failing the export.
 * Side effects: Read-only query; no side effects.
 */
export async function loadPinnedReviewLegalEvidence(
  prisma: PrismaService,
  pinnedRuleSet: SessionRuleSetPin | null | undefined,
) {
  if (!pinnedRuleSet) {
    return {
      ruleSetId: null,
      version: null,
      rulesCount: 0,
      rules: [],
    };
  }

  const ruleSetVersionId =
    pinnedRuleSet.id ??
    pinnedRuleSet.ruleSetVersionId ??
    pinnedRuleSet.ruleSetId;
  const version = pinnedRuleSet.version ?? pinnedRuleSet.ruleSetVersion ?? "v1";

  if (!ruleSetVersionId) {
    return {
      ruleSetId: null,
      version,
      rulesCount: 0,
      rules: [],
    };
  }

  const rules = await prisma.assessmentRule.findMany({
    where: { ruleSetVersionId },
    orderBy: { ordinal: "asc" },
  });

  return {
    ruleSetId: ruleSetVersionId,
    version,
    rulesCount: rules.length,
    rules: rules.map((r) => ({
      assessmentRuleId: r.assessmentRuleId,
      assessmentRuleVersion: r.assessmentRuleVersion,
      concept: r.concept,
      legalIntent: r.legalIntent,
    })),
  };
}
