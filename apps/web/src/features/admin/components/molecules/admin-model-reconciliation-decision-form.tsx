"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import {
  RECONCILIATION_DECISION_ACTIONS,
  type BillingReconciliationCaseDetailResponse,
} from "@lcsp/contracts/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { resolveAppMessage } from "@/lib/i18n";
import {
  adminModelReconciliationDecisionFormSchema,
  type AdminModelReconciliationDecisionFormData,
} from "../../schemas/admin-model-reconciliation.schema";

type Props = {
  detail: BillingReconciliationCaseDetailResponse;
  onSubmit: (
    payload: AdminModelReconciliationDecisionFormData,
  ) => Promise<void>;
  isSubmitting: boolean;
};

/**
 * Business purpose: Collect an auditable Admin decision for one uncertain model invocation.
 * Business rules: No-usage release is unavailable without a verified provider artifact; the API remains authoritative.
 * Execution flow: 1. Bind fields to a strict shared schema. 2. Require rationale. 3. Submit one idempotent decision.
 * Failure cases: Invalid inputs stay local; mutation failures remain visible to the parent dialog.
 * Side effects: Calls the parent's decision mutation; no direct wallet or ledger writes.
 */
export function AdminModelReconciliationDecisionForm({
  detail,
  onSubmit,
  isSubmitting,
}: Props) {
  const verified = detail.evidenceArtifact?.verified === true;
  const form = useForm<AdminModelReconciliationDecisionFormData>({
    resolver: zodResolver(adminModelReconciliationDecisionFormSchema),
    mode: "onChange",
    defaultValues: {
      decision: RECONCILIATION_DECISION_ACTIONS.maintainExposure,
      idempotencyKey: crypto.randomUUID(),
      auditRationale: "",
      providerLogArtifactId: verified
        ? detail.evidenceArtifact?.artifactId
        : undefined,
    },
  });

  /**
   * Business purpose: Submit one stable decision and prepare a fresh key after successful acknowledgement.
   * Business rules:
   * - A failed request keeps the original idempotency key for safe retry; a successful one rotates it.
   * Execution flow:
   * 1. Await the server-backed mutation. 2. Reset the form with a new key after success.
   * Failure cases:
   * - Mutation rejection leaves the form untouched so a retry keeps the same request identity.
   * Side effects:
   * - Calls the Admin decision BFF and resets local form state only on success.
   */
  async function submitDecision(
    payload: AdminModelReconciliationDecisionFormData,
  ) {
    try {
      await onSubmit(payload);
      form.reset({ ...payload, idempotencyKey: crypto.randomUUID() });
    } catch {
      // Why: A failed network request may be retried under the same idempotency key.
      // How: The parent mutation renders the error while this form retains all fields.
      // Invariant: No new request identity is generated until the server acknowledges success.
    }
  }

  // Why: Only independent verified provider evidence can authorize a no-usage slot release.
  // How: Disable that choice until a verified artifact is present; retain backend validation for authority.
  // Invariant: Worker-only claims and unverified artifacts cannot be selected as proof in this form.
  return (
    <FormProvider {...form}>
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit(submitDecision)}
        data-testid="model-reconciliation-decision-form"
      >
        <label className="block space-y-1">
          <span>
            {resolveAppMessage(
              "pages.admin.modelReconciliation.decision.action",
            )}
          </span>
          <select
            className="h-8 w-full rounded-lg border border-input bg-background px-2"
            {...form.register("decision")}
          >
            <option value={RECONCILIATION_DECISION_ACTIONS.maintainExposure}>
              {resolveAppMessage(
                "pages.admin.modelReconciliation.decision.maintainExposure",
              )}
            </option>
            <option value={RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview}>
              {resolveAppMessage(
                "pages.admin.modelReconciliation.decision.flagIntegrityReview",
              )}
            </option>
            <option value={RECONCILIATION_DECISION_ACTIONS.escalate}>
              {resolveAppMessage(
                "pages.admin.modelReconciliation.decision.escalate",
              )}
            </option>
            <option
              value={RECONCILIATION_DECISION_ACTIONS.confirmNoUsage}
              disabled={!verified}
            >
              {resolveAppMessage(
                "pages.admin.modelReconciliation.decision.confirmNoUsage",
              )}
            </option>
          </select>
        </label>
        <label className="block space-y-1">
          <span>
            {resolveAppMessage(
              "pages.admin.modelReconciliation.decision.auditRationale",
            )}
          </span>
          <Textarea
            {...form.register("auditRationale")}
            aria-invalid={Boolean(form.formState.errors.auditRationale)}
          />
        </label>
        {verified ? (
          <label className="block space-y-1">
            <span>
              {resolveAppMessage(
                "pages.admin.modelReconciliation.decision.artifactId",
              )}
            </span>
            <Input
              {...form.register("providerLogArtifactId")}
              defaultValue={detail.evidenceArtifact?.artifactId}
              readOnly
            />
          </label>
        ) : null}
        <Button
          type="submit"
          disabled={isSubmitting || !form.formState.isValid}
        >
          {resolveAppMessage("pages.admin.modelReconciliation.decision.submit")}
        </Button>
      </form>
    </FormProvider>
  );
}
