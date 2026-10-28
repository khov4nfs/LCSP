"use client";

import {
  ClipboardCopyIcon,
  DownloadIcon,
  PrinterIcon,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@lcsp/i18n";
import { resolveMessage } from "@lcsp/i18n";

import {
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
  type MfaRecoveryCodeAccessAction,
} from "@lcsp/contracts/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmAccessDialog } from "@/components/organisms/confirm-access-dialog";
import { FormCard } from "@/components/organisms/form-card";
import { appLocale } from "@/lib/locale";
import {
  useAuthSettingsProfileQuery,
  useMfaEnrollMutation,
  useMfaRecoveryCodeAccessMutation,
  usePasswordReauthMutation,
} from "@/lib/api/auth-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import { MfaQrPreview } from "../molecules/mfa-qr-preview";
import type { MfaEnrollErrorState } from "../../types/mfa-enroll.types";

export function MfaEnrollForm() {
  const router = useRouter();
  const profileQuery = useAuthSettingsProfileQuery();
  const enrollMutation = useMfaEnrollMutation();
  const recoveryCodeAccessMutation = useMfaRecoveryCodeAccessMutation();
  const reauthMutation = usePasswordReauthMutation();
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<MfaEnrollErrorState>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthError, setReauthError] = useState<{
    titleKey?: MessageKey;
    detailKey?: MessageKey;
  } | null>(null);

  const profile = profileQuery.data ?? null;

  async function handleEnroll() {
    setError(null);
    const outcome = await enrollMutation.mutateAsync().catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.mfaEnroll.errors.requestFailedTitle" as const,
      detailKey: "pages.mfaEnroll.errors.requestFailedDetail" as const,
    }));

    if (outcome.kind === API_OUTCOME_KINDS.loaded) {
      setTotpUri(outcome.totpUri);
      setRecoveryCodes(outcome.recoveryCodes);
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.sessionInvalid) {
      router.replace(API_REDIRECT_LOCATIONS.signIn);
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.mfaRequired) {
      setError({
        titleKey: "auth.errors.mfaRequired.title",
        detailKey: "auth.errors.mfaRequired.detail",
      });
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.reauthRequired) {
      setReauthOpen(true);
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.error) {
      setError({
        titleKey: outcome.titleKey,
        detailKey: outcome.detailKey,
      });
      return;
    }

    setError({
      titleKey: "pages.mfaEnroll.errors.requestFailedTitle",
      detailKey: "pages.mfaEnroll.errors.requestFailedDetail",
    });
  }

  async function handleReauthPasswordSubmit(values: { password: string }) {
    setReauthError(null);
    const result = await reauthMutation
      .mutateAsync({ password: values.password })
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey: "pages.mfaEnroll.errors.requestFailedTitle" as const,
        detailKey: "pages.mfaEnroll.errors.requestFailedDetail" as const,
      }));

    if (result.kind === API_OUTCOME_KINDS.verified) {
      setReauthOpen(false);
      setReauthError(null);
      await handleEnroll();
      return;
    }

    if (result.kind === API_OUTCOME_KINDS.invalid) {
      setReauthError({
        titleKey: "auth.errors.invalidCredentials.title",
        detailKey: "auth.errors.invalidCredentials.detail",
      });
      return;
    }

    if (result.kind === API_OUTCOME_KINDS.sessionInvalid) {
      router.replace(API_REDIRECT_LOCATIONS.signIn);
      return;
    }

    if (result.kind === API_OUTCOME_KINDS.error) {
      setReauthError({
        titleKey: result.titleKey,
        detailKey: result.detailKey,
      });
      return;
    }

    setReauthError({
      titleKey: "pages.mfaEnroll.errors.requestFailedTitle",
      detailKey: "pages.mfaEnroll.errors.requestFailedDetail",
    });
  }

  async function logRecoveryCodeAccess(action: MfaRecoveryCodeAccessAction) {
    const outcome = await recoveryCodeAccessMutation
      .mutateAsync(action)
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey: "pages.mfaEnroll.errors.requestFailedTitle" as const,
        detailKey: "pages.mfaEnroll.errors.requestFailedDetail" as const,
      }));
    if (outcome.kind === API_OUTCOME_KINDS.saved) {
      return true;
    }
    if (outcome.kind === API_OUTCOME_KINDS.error) {
      setError({
        titleKey: outcome.titleKey,
        detailKey: outcome.detailKey,
      });
    } else {
      setError({
        titleKey: "pages.mfaEnroll.errors.requestFailedTitle",
        detailKey: "pages.mfaEnroll.errors.requestFailedDetail",
      });
    }
    return false;
  }

  async function handleCopyRecoveryCodes() {
    if (
      !(await logRecoveryCodeAccess(MFA_RECOVERY_CODE_ACCESS_ACTIONS.copy))
    ) {
      return;
    }
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
  }

  async function handleDownloadRecoveryCodes() {
    if (
      !(await logRecoveryCodeAccess(
        MFA_RECOVERY_CODE_ACCESS_ACTIONS.download,
      ))
    ) {
      return;
    }
    const blob = new Blob([recoveryCodes.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lcsp-mfa-recovery-codes.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handlePrintRecoveryCodes() {
    if (
      !(await logRecoveryCodeAccess(MFA_RECOVERY_CODE_ACCESS_ACTIONS.print))
    ) {
      return;
    }
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return;
    const pre = printWindow.document.createElement("pre");
    pre.textContent = recoveryCodes.join("\n");
    printWindow.document.body.append(pre);
    printWindow.document.close();
    printWindow.print();
  }

  return (
    <>
      <FormCard
      eyebrow={resolveMessage(appLocale, "pages.mfaEnroll.formEyebrow")}
      title={resolveMessage(appLocale, "pages.mfaEnroll.formTitle")}
      description={resolveMessage(appLocale, "pages.mfaEnroll.formDescription")}
      footer={
        <>
          <Button
            className="w-full"
            type="button"
            onClick={handleEnroll}
            disabled={enrollMutation.isPending}
            aria-busy={enrollMutation.isPending}
          >
            {resolveMessage(
              appLocale,
              enrollMutation.isPending
                ? "pages.mfaEnroll.submitting"
                : "pages.mfaEnroll.submit",
            )}
          </Button>
          <Button
            render={<Link href={API_REDIRECT_LOCATIONS.mfaVerify} />}
            variant="ghost"
          >
            {resolveMessage(appLocale, "pages.mfaEnroll.goToVerify")}
          </Button>
        </>
      }
      leading={
        <p className="text-sm text-muted-foreground">
          {resolveMessage(appLocale, "pages.mfaEnroll.accessHelp")}
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{resolveMessage(appLocale, error.titleKey)}</AlertTitle>
            <AlertDescription>
              {resolveMessage(appLocale, error.detailKey)}
            </AlertDescription>
          </Alert>
        ) : null}

        {totpUri ? (
          <Alert>
            <AlertTitle>
              {resolveMessage(appLocale, "pages.mfaEnroll.successTitle")}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <p>
                {resolveMessage(appLocale, "pages.mfaEnroll.successDetail")}
              </p>
              <MfaQrPreview totpUri={totpUri} />
              {recoveryCodes.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {recoveryCodes.map((code) => (
                      <code
                        key={code}
                        className="rounded-md border bg-muted px-2 py-1 text-center font-mono text-sm"
                      >
                        {code}
                      </code>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyRecoveryCodes}
                    >
                      <ClipboardCopyIcon />
                      {resolveMessage(appLocale, "pages.mfaEnroll.copyCodes")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadRecoveryCodes}
                    >
                      <DownloadIcon />
                      {resolveMessage(
                        appLocale,
                        "pages.mfaEnroll.downloadCodes",
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handlePrintRecoveryCodes}
                    >
                      <PrinterIcon />
                      {resolveMessage(appLocale, "pages.mfaEnroll.printCodes")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </FormCard>
    <ConfirmAccessDialog
      open={reauthOpen}
      onOpenChange={(open) => {
        setReauthOpen(open);
        if (!open) {
          setReauthError(null);
        }
      }}
      onPasswordSubmit={handleReauthPasswordSubmit}
      accountLabelKey="pages.workspace.settingsHub.reauth.accountLabel"
      accountHandle={profile?.email ?? ""}
      avatarFallback={(profile?.email ?? "U").slice(0, 1).toUpperCase()}
      titleKey="pages.workspace.settingsHub.reauth.title"
      descriptionKey="pages.workspace.settingsHub.reauth.description"
      passwordLabelKey="pages.signIn.passwordLabel"
      passwordPlaceholderKey="pages.workspace.settingsHub.reauth.passwordPlaceholder"
      forgotPasswordHref={API_REDIRECT_LOCATIONS.recoveryRequest}
      forgotPasswordLabelKey="pages.signIn.forgotPassword"
      supportTitleKey="pages.workspace.settingsHub.reauth.supportTitle"
      confirmLabelKey="pages.workspace.settingsHub.reauth.confirm"
      confirmingLabelKey="pages.workspace.settingsHub.reauth.confirming"
      closeLabelKey="pages.workspace.settingsHub.reauth.close"
      errorTitleKey={reauthError?.titleKey}
      errorKey={reauthError?.detailKey ?? null}
    />
  </>
  );
}
