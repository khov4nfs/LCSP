import { z } from "zod";
import {
  billingReconciliationCaseItemSchema,
  reconciliationCaseDecisionRequestSchema,
  compensateBillingDebitRequestSchema,
} from "@lcsp/contracts/billing";

// Why: The API returns a paginated queue, while the shared contract currently defines its item only.
// How: Validate the complete read payload before either the BFF or browser displays case metadata.
// Invariant: Unknown fields and malformed pagination cannot be silently accepted as trusted Admin data.
export const adminModelReconciliationListSchema = z.strictObject({
  items: z.array(billingReconciliationCaseItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
});

export type AdminModelReconciliationList = z.infer<
  typeof adminModelReconciliationListSchema
>;

// Why: The Admin decision form must validate the same fields that the API will accept.
// How: Derive the form schema directly from the strict shared decision request contract.
// Invariant: The browser cannot silently add unapproved financial decision fields.
export const adminModelReconciliationDecisionFormSchema =
  reconciliationCaseDecisionRequestSchema;
export type AdminModelReconciliationDecisionFormData = z.infer<
  typeof adminModelReconciliationDecisionFormSchema
>;

/**
 * Business purpose: Bound an Admin correction to the server's current debit preview.
 * Business rules:
 * - The original ledger ID must match and the positive integer amount cannot exceed the remaining balance.
 * Execution flow:
 * 1. Validate canonical request shape. 2. Compare its debit identity and amount with the preview.
 * Failure cases:
 * - Missing, mismatched or excessive amounts fail validation before reaching the BFF.
 * Side effects:
 * - Pure schema construction; the server independently rechecks the bound under its wallet lock.
 */
export function createAdminCompensationFormSchema(preview: {
  originalLedgerEntryId: string;
  remainingUncompensatedMicrocredits: string;
}) {
  // Why: A stale or altered browser amount must never silently exceed the shown server ceiling.
  // How: Compare decimal integers with BigInt after the shared request schema validates them.
  // Invariant: The API remains authoritative when another compensation races this form.
  return compensateBillingDebitRequestSchema.superRefine((value, context) => {
    if (value.originalLedgerEntryId !== preview.originalLedgerEntryId) {
      context.addIssue({ code: "custom", path: ["originalLedgerEntryId"] });
    }
    if (
      /^[1-9]\d*$/.test(value.amountMicrocredits) &&
      BigInt(value.amountMicrocredits) >
        BigInt(preview.remainingUncompensatedMicrocredits)
    ) {
      context.addIssue({ code: "custom", path: ["amountMicrocredits"] });
    }
  });
}

export type AdminCompensationFormData = z.infer<
  typeof compensateBillingDebitRequestSchema
>;
