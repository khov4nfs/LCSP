import { z } from "zod";
import { legalSemanticGraphSchema } from "./semantic-graph.ts";

export const CLAIM_PREPARATION_PHASES = {
  CLAIM_DISCOVERY: "CLAIM_DISCOVERY",
  CLAIM_INVENTORY_VALIDATION: "CLAIM_INVENTORY_VALIDATION",
  CLAIM_INVENTORY_READY: "CLAIM_INVENTORY_READY",
  RULE_AUTHORING: "RULE_AUTHORING",
  RULE_VALIDATION: "RULE_VALIDATION",
  SUBMISSION_READY: "SUBMISSION_READY",
  COMPLETION: "COMPLETION",
} as const;
export type ClaimPreparationPhase =
  (typeof CLAIM_PREPARATION_PHASES)[keyof typeof CLAIM_PREPARATION_PHASES];
export const CLAIM_INVENTORY_ACTIONS = {
  VALIDATE: "VALIDATE",
  FINALIZE: "FINALIZE",
  REOPEN: "REOPEN",
  AUTHOR_RULES: "AUTHOR_RULES",
  RECORD_SEMANTIC_AUDITS: "RECORD_SEMANTIC_AUDITS",
} as const;
export const CLAIM_INVENTORY_GAPS = {
  REQUIRED: "CLAIM_INVENTORY_REQUIRED",
  STALE: "STALE_INVENTORY_BINDING",
  FROZEN: "CLAIM_INVENTORY_FROZEN",
  PHASE: "CLAIM_PHASE_INVALID",
  INVALID: "CLAIM_INVENTORY_INVALID",
  SCHEMA: "CLAIM_SCHEMA_INVALID",
} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const claimInventoryBindingSchema = z.strictObject({
  revision: z.number().int().positive(),
  fingerprint: hash,
});
export type ClaimInventoryBinding = z.infer<typeof claimInventoryBindingSchema>;
export const claimInventoryOperationSchema = z.strictObject({
  preparationRunId: z.string().uuid(),
  action: z.enum(CLAIM_INVENTORY_ACTIONS),
  revision: z.number().int().positive(),
  graph: legalSemanticGraphSchema.optional(),
  identities: z
    .record(z.string(), z.string().trim().min(1).max(128))
    .optional(),
  reason: z.string().trim().min(1).max(2000).optional(),
});
export type ClaimInventoryOperation = z.infer<
  typeof claimInventoryOperationSchema
>;
