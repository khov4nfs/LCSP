/** Server-owned scope review protocol. This is NOT a model-selected source filter. */
import { z } from "zod";
import { RULE_CATALOG_GROUP_IDS } from "../assessment-domain/rule-groups.ts";

export const PREPARATION_ACTIVITY_SCOPES = [
  "FULL_SOURCE",
  "DEVELOPMENT_ONLY",
] as const;
export const PREPARATION_SCOPE_STAGES = [
  "DEVELOPMENT",
  "NON_DEVELOPMENT",
  "LEGAL_REVIEW_REQUIRED",
] as const;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const preparationClaimStageDecisionSchema = z.strictObject({
  claimId: z.string().min(1).max(128),
  legalSourceVersionId: z.uuid(),
  sourceNodeIds: z.array(hash).min(1).max(64),
  actor: z.string().trim().min(1).max(8000),
  modality: z.string().trim().min(1).max(128),
  action: z.string().trim().min(1).max(8000),
  stage: z.enum(PREPARATION_SCOPE_STAGES),
  reason: z.string().trim().min(8).max(4000),
  grouping: z.strictObject({ groupId: z.enum(RULE_CATALOG_GROUP_IDS), rationaleEn: z.string().min(1), rationaleVi: z.string().min(1), ordinal: z.number().int().nonnegative() }).nullable(),
  evidence: z.strictObject({
    targetObject: z.string().trim().min(1), triggerAndTiming: z.string().trim().min(1),
    technicalDeliverable: z.string().trim().min(1).nullable(),
    repositoryVerifiability: z.string().trim().min(1), externalFulfillment: z.string().trim().min(1).nullable(),
    conditions: z.array(z.string().min(1)), exceptions: z.array(z.string().min(1)),
    materialContextClaimIds: z.array(z.string().min(1)),
    sourceSupport: z.array(z.strictObject({ sourceNodeId: hash, locator: z.string().min(1), rationale: z.string().min(1) })).min(1),
  }),
});

export const preparationScopeReviewSubmitSchema = z.strictObject({
  inventoryRevision: z.number().int().positive(),
  inventoryFingerprint: hash,
  expectedReviewRevision: z.number().int().nonnegative(),
  decisions: z.array(preparationClaimStageDecisionSchema).min(1).max(20000),
});
export const preparationScopeReviewApprovalSchema = z.strictObject({
  inventoryRevision: z.number().int().positive(),
  expectedReviewRevision: z.number().int().positive(),
  decisionDigest: hash,
  /** Human explicitly approves the scope of a selected legal-source snapshot. */
  confirmsLegalReview: z.literal(true),
});
export const preparationScopeReviewActivateSchema = z.strictObject({
  inventoryRevision: z.number().int().positive(),
});
export type PreparationScopeReviewActivate = z.infer<
  typeof preparationScopeReviewActivateSchema
>;
export type PreparationClaimStageDecision = z.infer<
  typeof preparationClaimStageDecisionSchema
>;
export type PreparationScopeReviewSubmit = z.infer<
  typeof preparationScopeReviewSubmitSchema
>;
export type PreparationScopeReviewApproval = z.infer<
  typeof preparationScopeReviewApprovalSchema
>;
