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
 * Business purpose: Load the pinned Rule Set catalog for session export without implying that every catalog rule was executed.
 * Business rules: Rules correspond to the full pinned Rule Set catalog; selected/executed audit coverage is reported separately.
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
      coverageKind: "PINNED_RULE_SET_CATALOG",
      catalogRulesCount: 0,
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
      coverageKind: "PINNED_RULE_SET_CATALOG",
      catalogRulesCount: 0,
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
    coverageKind: "PINNED_RULE_SET_CATALOG",
    catalogRulesCount: rules.length,
    rulesCount: rules.length,
    rules: rules.map((r) => ({
      assessmentRuleId: r.assessmentRuleId,
      assessmentRuleVersion: r.assessmentRuleVersion,
      concept: r.concept,
      legalIntent: r.legalIntent,
    })),
  };
}
