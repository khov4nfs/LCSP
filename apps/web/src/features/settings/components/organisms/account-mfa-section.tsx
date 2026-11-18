"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Button } from "@/components/ui/button";
import { getAuthSettingsProfile } from "@/lib/api/auth-client";
import {
  useDisableMfaMutation,
  useGenerateMfaRecoveryCodesMutation,
  useMfaEnrollMutation,
} from "@/lib/api/auth-queries";
import { apiQueryKeys } from "@/lib/api/query-keys";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import { MfaSetupForm } from "../molecules/mfa-setup-form";
import { RecoveryCodesPanel } from "../molecules/recovery-codes-panel";
import { SecurityActionConfirmation } from "../molecules/security-action-confirmation";
import {
  ACCOUNT_SECURITY_ACTIONS,
  type AccountSecurityAction,
} from "../../config/account-security.config";
import type {
  SecurityEditorProps,
  AccountMfaOutcome,
} from "../../types/account-security.types";
import { runAccountSecurityAction } from "../../utils/account-security.utils";

export function AccountMfaSection({
  profile,
  locale,
  onReauthenticate,
  readFailed,
  readVersion,
}: SecurityEditorProps) {
  const enroll = useMfaEnrollMutation();
  const disable = useDisableMfaMutation();
  const generate = useGenerateMfaRecoveryCodesMutation();
  const queryClient = useQueryClient();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] =
    useState<AccountSecurityAction | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<MessageKey | null>(null);
  const [success, setSuccess] = useState<MessageKey | null>(null);
  const [unconfirmedAt, setUnconfirmedAt] = useState<number | null>(null);
  const blocked = readFailed || unconfirmedAt === readVersion;
  const t = (key: MessageKey) => resolveMessage(locale, key);

  /**
   * Business purpose: Start enrollment or execute an explicitly confirmed MFA security change.
   * Business rules:
   * - Concurrent clicks are locked and every challenged request requires the requested proof.
   * - Destructive actions enter only through confirmation; ambiguous writes are never automatically retried.
   * - Clear previous batch codes before replacement and retain new secrets only in this interaction.
   * Execution flow:
   * 1. Lock the interaction, clear feedback and submit the selected API action.
   * 2. Complete distinct backend challenges and classify the acknowledged result.
   * 3. Present committed setup credentials or backend-confirmed disabled state.
   * Failure cases:
   * - Cancellation, repeated challenges and rejected requests do not show completion.
   * - Transport or confirmation failures require refreshing state before another attempt.
   * Side effects:
   * - Creates or removes MFA credentials, replaces recovery codes and refreshes account caches.
   */
  async function execute(action?: AccountSecurityAction) {
    if (locked.current || blocked) return;
    locked.current = true;
    setPending(true);
    setConfirmation(null);
    setError(null);
    setSuccess(null);
    setCodes([]);
    try {
      const outcome = await runAccountSecurityAction<AccountMfaOutcome>(
        () =>
          action === ACCOUNT_SECURITY_ACTIONS.disable
            ? disable.mutateAsync()
            : action === ACCOUNT_SECURITY_ACTIONS.regenerate
              ? generate.mutateAsync()
              : enroll.mutateAsync(),
        onReauthenticate,
      );
      if (outcome?.kind === API_OUTCOME_KINDS.loaded) {
        setCodes(outcome.recoveryCodes);
        if ("totpUri" in outcome) setTotpUri(outcome.totpUri);
      } else if (outcome?.kind === API_OUTCOME_KINDS.disabled) {
        setTotpUri(null);
        setSuccess("pages.workspace.settingsHub.accountSecurity.disabled");
      } else {
        setError(
          !outcome
            ? "pages.workspace.settingsHub.accountSecurity.cancelled"
            : outcome.kind === API_OUTCOME_KINDS.sessionInvalid
              ? "auth.errors.sessionInvalid.detail"
              : "detailKey" in outcome
                ? outcome.detailKey
                : "pages.workspace.settingsHub.accountSecurity.challenge",
        );
      }
    } catch {
      setError("pages.workspace.settingsHub.accountSecurity.unconfirmed");
      setUnconfirmedAt(
        queryClient.getQueryState(apiQueryKeys.auth.settingsProfile())
          ?.dataUpdatedAt ?? readVersion,
      );
    } finally {
      enroll.reset();
      generate.reset();
      locked.current = false;
      setPending(false);
    }
  }

  /**
   * Business purpose: Confirm the new authenticator is active before leaving enrollment.
   * Business rules:
   * - Both account enrollment and current-session verification must be confirmed by a fresh API read.
   * Execution flow:
   * 1. Cancel older reads, fetch persisted profile and reject incomplete enrollment or verification.
   * 2. Remove the setup secret, refresh sessions and announce enabled MFA.
   * Failure cases:
   * - Failed reads or incomplete proofs preserve setup without reporting success.
   * Side effects:
   * - Refreshes profile and session caches and removes the setup URI from interaction state.
   */
  async function confirmEnrollment() {
    try {
      await queryClient.cancelQueries({
        queryKey: apiQueryKeys.auth.settingsProfile(),
      });
      const confirmed = await queryClient.fetchQuery({
        queryKey: apiQueryKeys.auth.settingsProfile(),
        queryFn: getAuthSettingsProfile,
        staleTime: 0,
        retry: false,
      });
      if (!confirmed.mfa_enrolled || !confirmed.mfa_verified)
        throw new Error("mfa-enrollment-not-confirmed");
      setTotpUri(null);
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.auth.sessions(),
      });
      setSuccess("pages.workspace.settingsHub.accountSecurity.verified");
    } catch (cause) {
      setError("pages.workspace.settingsHub.accountSecurity.unconfirmed");
      setUnconfirmedAt(
        queryClient.getQueryState(apiQueryKeys.auth.settingsProfile())
          ?.dataUpdatedAt ?? readVersion,
      );
      throw cause;
    }
  }

  return (
    <section
      className="space-y-4"
      aria-labelledby="settings-mfa-heading"
      aria-busy={pending}
    >
      <h2 id="settings-mfa-heading" className="text-lg font-semibold">
        {t("pages.workspace.settingsHub.accountSecurity.mfaTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t(
          profile.mfa_enrolled
            ? "pages.workspace.settingsHub.accountSecurity.mfaEnabled"
            : "pages.workspace.settingsHub.accountSecurity.mfaDisabled",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {profile.mfa_enrolled ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={pending || blocked || codes.length > 0}
              onClick={() =>
                setConfirmation(ACCOUNT_SECURITY_ACTIONS.regenerate)
              }
            >
              {t("pages.workspace.settingsHub.accountSecurity.regenerate")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || blocked}
              onClick={() => setConfirmation(ACCOUNT_SECURITY_ACTIONS.disable)}
            >
              {t("pages.workspace.settingsHub.accountSecurity.disable")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            disabled={pending || blocked}
            onClick={() => void execute()}
          >
            {t(
              pending
                ? "pages.workspace.settingsHub.accountSecurity.busy"
                : totpUri
                  ? "pages.workspace.settingsHub.accountSecurity.restart"
                  : "pages.workspace.settingsHub.accountSecurity.enroll",
            )}
          </Button>
        )}
      </div>
      {totpUri && !profile.mfa_enrolled ? (
        <MfaSetupForm
          key={totpUri}
          totpUri={totpUri}
          locale={locale}
          onVerified={confirmEnrollment}
        />
      ) : null}
      {codes.length > 0 ? (
        <RecoveryCodesPanel
          codes={codes}
          locale={locale}
          onClose={() => setCodes([])}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm">
          {t(success)}
        </p>
      ) : null}
      <SecurityActionConfirmation
        action={confirmation}
        locale={locale}
        onCancel={() => setConfirmation(null)}
        onConfirm={(action) => void execute(action)}
      />
    </section>
  );
}
