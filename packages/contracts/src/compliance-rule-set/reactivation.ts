import { z } from "zod";

/** An Admin attests that the replaced authority failed semantic acceptance. */
export const RULE_SET_REACTIVATION_REASONS = {
  SEMANTIC_AUTHORITY_CONTAINMENT: "SEMANTIC_AUTHORITY_CONTAINMENT",
} as const;

export const RULE_SET_REACTIVATION_ERROR_CODES = {
  TARGET_NOT_FOUND: "RULE_SET_REACTIVATION_TARGET_NOT_FOUND",
  TARGET_NOT_ELIGIBLE: "RULE_SET_REACTIVATION_TARGET_NOT_ELIGIBLE",
  EXPECTED_ACTIVE_MISMATCH: "RULE_SET_REACTIVATION_EXPECTED_ACTIVE_MISMATCH",
  NO_ACTIVE_RULE_SET: "RULE_SET_REACTIVATION_NO_ACTIVE_RULE_SET",
  TARGET_ALREADY_ACTIVE: "RULE_SET_REACTIVATION_TARGET_ALREADY_ACTIVE",
  INTEGRITY_INVALID: "RULE_SET_REACTIVATION_INTEGRITY_INVALID",
  PREPARATION_IN_PROGRESS: "RULE_SET_REACTIVATION_PREPARATION_IN_PROGRESS",
  REQUEST_INVALID: "RULE_SET_REACTIVATION_REQUEST_INVALID",
  CONFLICT: "RULE_SET_REACTIVATION_CONFLICT",
} as const;

export const complianceRuleSetReactivationRequestSchema = z.strictObject({
  expectedActiveRuleSetVersionId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(200),
  reason: z.enum(RULE_SET_REACTIVATION_REASONS),
});
export type ComplianceRuleSetReactivationRequest = z.infer<
  typeof complianceRuleSetReactivationRequestSchema
>;

export const complianceRuleSetReactivationResultSchema = z.strictObject({
  transitionId: z.uuid(),
  ruleSetVersionId: z.uuid(),
  previousActiveRuleSetVersionId: z.uuid(),
  ruleSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  correlationId: z.string().min(1),
  completedAt: z.iso.datetime(),
  auditEventId: z.uuid(),
  outboxEventId: z.string().min(1),
  replayed: z.boolean(),
});
export type ComplianceRuleSetReactivationResult = z.infer<
  typeof complianceRuleSetReactivationResultSchema
>;
