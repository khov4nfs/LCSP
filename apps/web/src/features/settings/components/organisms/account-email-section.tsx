"use client";

import { useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Button } from "@/components/ui/button";
import { useUpdateProfileMutation } from "@/lib/api/auth-queries";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import { AccountEmailFields } from "../molecules/account-email-fields";
import {
  accountSecuritySchema,
  type AccountSecurityValues,
} from "../../schemas/account-security.schema";
import type { SecurityEditorProps } from "../../types/account-security.types";
import { runAccountSecurityAction } from "../../utils/account-security.utils";

export function AccountEmailSection({
  profile,
  locale,
  onReauthenticate,
  readFailed,
}: SecurityEditorProps) {
  const mutation = useUpdateProfileMutation();
  const [error, setError] = useState<MessageKey | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<AccountSecurityValues>({
    resolver: zodResolver(accountSecuritySchema),
    defaultValues: {
      recovery_email: profile.recovery_email ?? "",
      primary_email_address_policy: profile.primary_email_address_policy,
      backup_recovery_email_policy: profile.backup_recovery_email_policy,
    },
  });
  const {
    reset,
    formState: { isDirty, isSubmitting },
  } = form;
  const t = (key: MessageKey) => resolveMessage(locale, key);
  useEffect(() => {
    if (!isDirty && !isSubmitting)
      reset({
        recovery_email: profile.recovery_email ?? "",
        primary_email_address_policy: profile.primary_email_address_policy,
        backup_recovery_email_policy: profile.backup_recovery_email_policy,
      });
  }, [
    profile.recovery_email,
    profile.primary_email_address_policy,
    profile.backup_recovery_email_policy,
    isDirty,
    isSubmitting,
    reset,
  ]);

  /**
   * Business purpose: Save recovery preferences while preserving rejected or unconfirmed edits.
   * Business rules:
   * - Only validated policies and normalized addresses are submitted for the current account.
   * - Canceled verification never retries; success requires the mutation's persisted-field confirmation.
   * Execution flow:
   * 1. Submit the draft and complete each distinct backend authentication challenge once.
   * 2. Reset validated values only after a confirmed save; otherwise retain edits with feedback.
   * Failure cases:
   * - Conflicting addresses, stale proofs and uncertain writes never report a saved preference.
   * Side effects:
   * - Updates the account through the shared mutation and may open Settings reauthentication.
   */
  async function save(values: AccountSecurityValues) {
    if (readFailed) return;
    setError(null);
    setSaved(false);
    try {
      const outcome = await runAccountSecurityAction(
        () => mutation.mutateAsync(values),
        onReauthenticate,
      );
      if (outcome?.kind === API_OUTCOME_KINDS.saved) {
        reset(values);
        setSaved(true);
      } else {
        setError(
          !outcome
            ? "pages.workspace.settingsHub.accountSecurity.cancelled"
            : outcome.kind === API_OUTCOME_KINDS.validationError
              ? "pages.workspace.settingsHub.accountSecurity.rejected"
              : outcome.kind === API_OUTCOME_KINDS.sessionInvalid
                ? "auth.errors.sessionInvalid.detail"
                : outcome.kind === API_OUTCOME_KINDS.mfaRequired ||
                    outcome.kind === API_OUTCOME_KINDS.reauthRequired
                  ? "pages.workspace.settingsHub.accountSecurity.challenge"
                  : "pages.workspace.settingsHub.accountSecurity.failed",
        );
      }
    } catch {
      setError("pages.workspace.settingsHub.accountSecurity.unconfirmed");
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="settings-email-heading">
      <h2 id="settings-email-heading" className="text-lg font-semibold">
        {t("pages.workspace.settingsHub.accountSecurity.emailTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t("pages.workspace.settingsHub.accountSecurity.emailHelp")}
      </p>
      <FormProvider {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit(save)}
          aria-busy={isSubmitting}
          className="space-y-4"
        >
          <AccountEmailFields />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={!isDirty || isSubmitting || readFailed}
            >
              {t(
                isSubmitting
                  ? "pages.workspace.settingsHub.accountSecurity.saving"
                  : "pages.workspace.settingsHub.accountSecurity.save",
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || isSubmitting}
              onClick={() => {
                reset({
                  recovery_email: profile.recovery_email ?? "",
                  primary_email_address_policy:
                    profile.primary_email_address_policy,
                  backup_recovery_email_policy:
                    profile.backup_recovery_email_policy,
                });
                setError(null);
                setSaved(false);
              }}
            >
              {t("pages.workspace.settingsHub.accountSecurity.reset")}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          ) : null}
          {saved && !isDirty ? (
            <p role="status" className="text-sm">
              {t("pages.workspace.settingsHub.accountSecurity.saved")}
            </p>
          ) : null}
        </form>
      </FormProvider>
    </section>
  );
}
