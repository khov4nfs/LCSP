import { z } from "zod";

/**
 * Business purpose: Validate the Admin Scope Authorization lookup and review form inputs.
 * Business rules:
 * - Scope keys are 64-character lowercase hex digests.
 * - Revocation requires a non-blank reason.
 * Execution flow:
 * 1. Parse the scope key lookup input and optional revocation reason.
 * Failure cases:
 * - Malformed scope keys or blank revocation reasons fail form validation before API dispatch.
 * Side effects:
 * - Pure schema validation.
 */
export const scopeAuthorizationFormSchema = z.object({
  scopeKey: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/),
  confirmsLegalReview: z.boolean(),
  revokeReason: z.string().trim().max(2000),
  confirmsRevocation: z.boolean(),
});

export type ScopeAuthorizationFormValues = z.infer<
  typeof scopeAuthorizationFormSchema
>;
