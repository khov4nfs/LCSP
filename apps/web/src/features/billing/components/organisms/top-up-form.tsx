"use client";

import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";
import type { UseFormReturn } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { BillingTopUpFormValues } from "../../schemas/billing-top-up.schema";

type TopUpFormProps = {
  locale: Locale;
  form: UseFormReturn<BillingTopUpFormValues>;
  isSubmitting: boolean;
  isSubmitError: boolean;
  hasPendingOrders: boolean;
  hasPendingHistoryOrder: boolean;
  showAdditionalConfirmation: boolean;
  onSubmit: (values: BillingTopUpFormValues) => void | Promise<void>;
  onOpenExistingOrder: () => void;
  onConfirmAdditionalOrder: () => void;
  onCancelAdditionalOrder: () => void;
};

/**
 * Business purpose: Collect and validate a prepaid VND top-up amount and handle confirmation when pending orders already exist.
 * Business rules:
 * - Validates input against billingTopUpSchema via react-hook-form before allowing order creation.
 * - Requires explicit customer confirmation before creating an additional order when a pending order already exists.
 * Execution flow:
 * 1. Render the VND amount input with validation feedback and minimum hint.
 * 2. Submit validated values to onSubmit, or display the additional-order confirmation alert when requested.
 * Failure cases:
 * - Displays localized validation or server creation errors without fabricating an order or balance update.
 * Side effects:
 * - Delegates order creation and idempotency tracking to the parent BillingSettingsPanel container.
 */
export function TopUpForm({
  locale,
  form,
  isSubmitting,
  isSubmitError,
  hasPendingOrders,
  hasPendingHistoryOrder,
  showAdditionalConfirmation,
  onSubmit,
  onOpenExistingOrder,
  onConfirmAdditionalOrder,
  onCancelAdditionalOrder,
}: TopUpFormProps) {
  return (
    <section
      aria-labelledby="billing-top-up-heading"
      className="rounded-xl border border-border/70 bg-muted/20 p-5"
      data-component="TopUpForm"
    >
      <h3 id="billing-top-up-heading" className="text-sm font-medium">
        {resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.topUpTitle",
        )}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.topUpDescription",
        )}
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
      >
        <div className="space-y-2">
          <label htmlFor="billing-amount-vnd" className="text-sm">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.amountLabel",
            )}
          </label>
          <Input
            id="billing-amount-vnd"
            inputMode="numeric"
            disabled={isSubmitting || showAdditionalConfirmation}
            aria-invalid={form.formState.errors.amountVnd ? "true" : undefined}
            placeholder={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.amountPlaceholder",
            )}
            {...form.register("amountVnd")}
          />
          {form.formState.errors.amountVnd ? (
            <p role="alert" className="text-xs text-destructive">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.amountInvalid",
              )}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.amountHint",
            )}
          </p>
        </div>
        <Button
          type="submit"
          disabled={isSubmitting || showAdditionalConfirmation}
        >
          {isSubmitting
            ? resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.creatingOrder",
              )
            : resolveMessage(
                locale,
                hasPendingOrders
                  ? "pages.workspace.settingsHub.billing.createAnotherOrder"
                  : "pages.workspace.settingsHub.billing.createOrder",
              )}
        </Button>
        {isSubmitError ? (
          <p role="alert" className="text-xs text-destructive">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.createOrderError",
            )}
          </p>
        ) : null}
        {showAdditionalConfirmation ? (
          <Alert>
            <AlertTitle>
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.confirmAdditionalOrderTitle",
              )}
            </AlertTitle>
            <AlertDescription>
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.confirmAdditionalOrderDescription",
              )}
            </AlertDescription>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!hasPendingHistoryOrder}
                onClick={onOpenExistingOrder}
              >
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.billing.openExistingOrder",
                )}
              </Button>
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={onConfirmAdditionalOrder}
              >
                {isSubmitting
                  ? resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.billing.creatingOrder",
                    )
                  : resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.billing.confirmCreateAnotherOrder",
                    )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onCancelAdditionalOrder}
              >
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.billing.cancelAdditionalOrder",
                )}
              </Button>
            </div>
          </Alert>
        ) : null}
      </form>
    </section>
  );
}
