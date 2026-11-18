"use client";

import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { FormTextField } from "@/components/molecules/form-text-field";
import { Button } from "@/components/ui/button";
import { MfaQrPreview } from "@/features/auth/components/molecules/mfa-qr-preview";
import {
  mfaVerifySchema,
  type MfaVerifyFormValues,
} from "@/features/auth/schemas/mfa-verify.schema";
import { useMfaVerifyMutation } from "@/lib/api/auth-queries";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import type { MfaSetupProps } from "../../types/account-security.types";

export function MfaSetupForm({ totpUri, locale, onVerified }: MfaSetupProps) {
  const form = useForm<MfaVerifyFormValues>({
    resolver: zodResolver(mfaVerifySchema),
    defaultValues: { otp: "" },
  });
  const mutation = useMfaVerifyMutation();
  const [error, setError] = useState<MessageKey | null>(null);
  const t = (key: MessageKey) => resolveMessage(locale, key);

  /**
   * Business purpose: Activate a newly configured authenticator only after proving a current OTP.
   * Business rules:
   * - QR generation alone does not enable MFA; verification and a fresh profile read are required.
   * Execution flow:
   * 1. Submit a validated six-digit OTP for the active session.
   * 2. Ask the owning section to confirm the persisted factor before completing setup.
   * Failure cases:
   * - Invalid, expired or rate-limited codes retain setup and expose the backend's localized error.
   * - Failed confirmation remains an uncertain result rather than a success.
   * Side effects:
   * - Verifies the authenticator through the backend and refreshes security data through the owner.
   */
  async function verify(values: MfaVerifyFormValues) {
    setError(null);
    try {
      const outcome = await mutation.mutateAsync(values);
      if (outcome.kind === API_OUTCOME_KINDS.verified) {
        await onVerified();
      } else {
        setError(
          "detailKey" in outcome
            ? outcome.detailKey
            : outcome.kind === API_OUTCOME_KINDS.sessionInvalid
              ? "auth.errors.sessionInvalid.detail"
              : "auth.errors.mfaRequired.detail",
        );
      }
    } catch {
      setError("pages.workspace.settingsHub.accountSecurity.unconfirmed");
    } finally {
      form.reset({ otp: "" });
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <MfaQrPreview totpUri={totpUri} />
      <FormProvider {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit(verify)}
          className="space-y-4"
          aria-busy={form.formState.isSubmitting}
        >
          <FormTextField<MfaVerifyFormValues>
            name="otp"
            id="settings-setup-otp"
            autoComplete="one-time-code"
            labelKey="pages.mfaVerify.otpLabel"
          />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t(
              form.formState.isSubmitting
                ? "pages.workspace.settingsHub.reauth.verifying"
                : "pages.workspace.settingsHub.reauth.verify",
            )}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          ) : null}
        </form>
      </FormProvider>
    </div>
  );
}
