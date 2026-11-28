"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { BillingReconciliationCaseDetailResponse } from "@lcsp/contracts/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { resolveAppMessage } from "@/lib/i18n";
import {
  createAdminCompensationFormSchema,
  type AdminCompensationFormData,
} from "../../schemas/admin-model-reconciliation.schema";

type Preview = NonNullable<
  BillingReconciliationCaseDetailResponse["compensationPreview"]
>;

type Props = {
  preview: Preview;
  onSubmit: (payload: AdminCompensationFormData) => Promise<void>;
  isSubmitting: boolean;
};

/**
 * Business purpose: Let an Admin request a debit-linked correction with an explicit audit reason.
 * Business rules:
 * - The amount is a positive integer no greater than the server-provided remaining microcredits.
 * - The original debit identity is fixed by the case detail; backend locking remains authoritative.
 * Execution flow:
 * 1. Show original debit and remaining ceiling. 2. Validate amount and reason. 3. Submit idempotently.
 * Failure cases:
 * - Invalid amounts stay local; failed requests retain the same idempotency key for retry.
 * Side effects:
 * - Calls the Admin compensation BFF only after an explicit form submission.
 */
export function AdminModelReconciliationCompensationForm({
  preview,
  onSubmit,
  isSubmitting,
}: Props) {
  const form = useForm<AdminCompensationFormData>({
    resolver: zodResolver(createAdminCompensationFormSchema(preview)),
    mode: "onChange",
    defaultValues: {
      originalLedgerEntryId: preview.originalLedgerEntryId,
      amountMicrocredits: "",
      reason: "",
      idempotencyKey: crypto.randomUUID(),
    },
  });

  /**
   * Business purpose: Submit one correction and prepare a new request identity after server acknowledgement.
   * Business rules:
   * - Failure preserves the amount, rationale and idempotency key for a safe retry.
   * Execution flow:
   * 1. Await the billing mutation. 2. Reset form with a fresh key only on success.
   * Failure cases:
   * - Mutation errors are displayed by the parent; no local success state is fabricated.
   * Side effects:
   * - May create a backend compensation; resets local fields after success.
   */
  async function submitCompensation(payload: AdminCompensationFormData) {
    try {
      await onSubmit(payload);
      form.reset({
        ...payload,
        amountMicrocredits: "",
        reason: "",
        idempotencyKey: crypto.randomUUID(),
      });
    } catch {
      // Why: A lost response must be retried with the same request identity.
      // How: Keep the form untouched and let the parent display the mutation error.
      // Invariant: This client never assumes a wallet credit occurred.
    }
  }

  // Why: The preview is the only trustworthy source for the original debit and remaining ceiling.
  // How: Render both read-only and bind the amount to the preview-scoped schema.
  // Invariant: The form never invents or silently enlarges a compensation amount.
  return (
    <FormProvider {...form}>
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit(submitCompensation)}
        data-testid="model-reconciliation-compensation-form"
      >
        <p>
          {resolveAppMessage(
            "pages.admin.modelReconciliation.compensation.title",
          )}
        </p>
        <label className="block space-y-1">
          <span>
            {resolveAppMessage(
              "pages.admin.modelReconciliation.compensation.originalLedgerEntryId",
            )}
          </span>
          <Input
            {...form.register("originalLedgerEntryId")}
            defaultValue={preview.originalLedgerEntryId}
            readOnly
          />
        </label>
        <p>
          {resolveAppMessage(
            "pages.admin.modelReconciliation.compensation.remaining",
          )}
          :{" "}
          <span className="font-mono">
            {preview.remainingUncompensatedMicrocredits}
          </span>
        </p>
        <label className="block space-y-1">
          <span>
            {resolveAppMessage(
              "pages.admin.modelReconciliation.compensation.amount",
            )}
          </span>
          <Input
            inputMode="numeric"
            {...form.register("amountMicrocredits")}
            aria-invalid={Boolean(form.formState.errors.amountMicrocredits)}
          />
        </label>
        <label className="block space-y-1">
          <span>
            {resolveAppMessage(
              "pages.admin.modelReconciliation.compensation.reason",
            )}
          </span>
          <Textarea
            {...form.register("reason")}
            aria-invalid={Boolean(form.formState.errors.reason)}
          />
        </label>
        <Button
          type="submit"
          disabled={isSubmitting || !form.formState.isValid}
        >
          {resolveAppMessage(
            "pages.admin.modelReconciliation.compensation.submit",
          )}
        </Button>
      </form>
    </FormProvider>
  );
}
