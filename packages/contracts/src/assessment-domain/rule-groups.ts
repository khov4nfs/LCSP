import { z } from "zod";

export const RULE_CATALOG_GROUP_IDS = {
  ARCHITECTURE_SAFETY_BY_DESIGN: "ARCHITECTURE_SAFETY_BY_DESIGN",
  DATA_MODEL_LIFECYCLE: "DATA_MODEL_LIFECYCLE",
  CYBERSECURITY_TECHNICAL_CONTROLS: "CYBERSECURITY_TECHNICAL_CONTROLS",
  TESTING_CHANGE_ASSURANCE: "TESTING_CHANGE_ASSURANCE",
  USER_FACING_TRANSPARENCY: "USER_FACING_TRANSPARENCY",
  HUMAN_OVERSIGHT_INTERVENTION: "HUMAN_OVERSIGHT_INTERVENTION",
} as const;
export const RULE_CATALOG_REVIEW_STATES = { DRAFT: "DRAFT", APPROVED: "APPROVED", REVIEW_REQUIRED: "REVIEW_REQUIRED" } as const;
export const ruleCatalogGroupSchema = z.strictObject({
  groupId: z.enum(RULE_CATALOG_GROUP_IDS), taxonomyVersion: z.string().min(1),
  nameEn: z.string().min(1), nameVi: z.string().min(1), descriptionEn: z.string().min(1), descriptionVi: z.string().min(1),
  count: z.number().int().nonnegative(), ruleIds: z.array(z.string().min(1)),
});
export const ruleCatalogMembershipSchema = z.strictObject({
  groupId: z.enum(RULE_CATALOG_GROUP_IDS), ordinal: z.number().int().nonnegative(),
  taxonomyVersion: z.string().min(1), rationaleEn: z.string().min(1), rationaleVi: z.string().min(1),
  actor: z.string().min(1), lifecycleStage: z.string().min(1),
  sourceReferences: z.array(z.strictObject({ documentId: z.string().min(1), locator: z.string().min(1) })).min(1),
});
export const submitRuleCatalogGroupsSchema = z.strictObject({
  ruleSetDigest: z.string().min(1),
  memberships: z.array(ruleCatalogMembershipSchema.extend({
    assessmentRuleId: z.string().min(1), assessmentRuleVersion: z.string().min(1),
    nameEn: z.string().min(1), nameVi: z.string().min(1), descriptionEn: z.string().min(1), descriptionVi: z.string().min(1),
  })).min(1).max(10000),
});
export const approveRuleCatalogGroupsSchema = z.strictObject({ membershipDigest: z.string().regex(/^[a-f0-9]{64}$/), confirmsTaxonomyAndMembershipReview: z.literal(true) });
export type SubmitRuleCatalogGroups = z.infer<typeof submitRuleCatalogGroupsSchema>;
