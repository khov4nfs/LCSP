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
import { Spinner } from "@/components/ui/spinner";
import { ConfirmAccessDialog } from "@/components/organisms/confirm-access-dialog";
import { appLocale } from "@/lib/locale";
import {
  useAuthSettingsProfileQuery,
  useMfaEnrollMutation,
  useMfaRecoveryCodeAccessMutation,
  usePasswordReauthMutation,
} from "@/lib/api/auth-queries";
import { API_OUTCOME_KINDS, API_REDIRECT_LOCATIONS } from "@/lib/api/outcome-kinds";
import {
  AuthFormSurface,
  AuthHeading,
  AuthInlineLink,
  AuthNote,
  AuthPrimaryButton,
} from "../molecules/auth-form-primitives";
import { MfaQrPreview } from "../molecules/mfa-qr-preview";
import type { MfaEnrollErrorState } from "../../types/mfa-enroll.types";

export function MfaEnrollForm() {
  const router = useRouter();
  const [reauthOpen, setReauthOpen] = useState(false);
  const profileQuery = useAuthSettingsProfileQuery({ enabled: reauthOpen });
  const enrollMutation = useMfaEnrollMutation();
  const recoveryCodeAccessMutation = useMfaRecoveryCodeAccessMutation();
  const reauthMutation = usePasswordReauthMutation();
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<MfaEnrollErrorState>(null);
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
      <AuthFormSurface
        className={
          totpUri
            ? "max-w-md pt-16 pb-20 sm:pt-20"
            : "pt-28 pb-16 sm:pt-32"
        }
      >
        <AuthHeading
          title={resolveMessage(appLocale, "pages.mfaEnroll.formTitle")}
          description={resolveMessage(appLocale, "pages.mfaEnroll.formDescription")}
        />

        <div className="mt-8 flex flex-col gap-6">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{resolveMessage(appLocale, error.titleKey)}</AlertTitle>
              <AlertDescription>
                {resolveMessage(appLocale, error.detailKey)}
              </AlertDescription>
            </Alert>
          ) : null}

          {totpUri ? (
            <div className="flex flex-col gap-6 rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-sm">
              <div className="text-center">
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  {resolveMessage(appLocale, "pages.mfaEnroll.successTitle")}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {resolveMessage(appLocale, "pages.mfaEnroll.successDetail")}
                </p>
              </div>

              <MfaQrPreview totpUri={totpUri} />

              {recoveryCodes.length > 0 ? (
                <div className="flex flex-col gap-4 border-t border-border/60 pt-5">
                  <div className="grid grid-cols-2 gap-2.5">
                    {recoveryCodes.map((code) => (
                      <code
                        key={code}
                        className="rounded-lg border border-border/60 bg-muted/60 px-3 py-2 text-center font-mono text-xs font-semibold tracking-wider text-foreground select-all"
                      >
                        {code}
                      </code>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3 text-xs"
                      onClick={handleCopyRecoveryCodes}
                    >
                      <ClipboardCopyIcon className="size-3.5" />
                      {resolveMessage(appLocale, "pages.mfaEnroll.copyCodes")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3 text-xs"
                      onClick={handleDownloadRecoveryCodes}
                    >
                      <DownloadIcon className="size-3.5" />
                      {resolveMessage(
                        appLocale,
                        "pages.mfaEnroll.downloadCodes",
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3 text-xs"
                      onClick={handlePrintRecoveryCodes}
                    >
                      <PrinterIcon className="size-3.5" />
                      {resolveMessage(appLocale, "pages.mfaEnroll.printCodes")}
                    </Button>
                  </div>
                </div>
              ) : null}

              <Button
                render={<Link href={API_REDIRECT_LOCATIONS.mfaVerify} />}
                className="w-full"
                nativeButton={false}
              >
                {resolveMessage(appLocale, "pages.mfaEnroll.goToVerify")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <AuthPrimaryButton
                type="button"
                onClick={handleEnroll}
                disabled={enrollMutation.isPending}
                aria-busy={enrollMutation.isPending}
              >
                {enrollMutation.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {resolveMessage(
                  appLocale,
                  enrollMutation.isPending
                    ? "pages.mfaEnroll.submitting"
                    : "pages.mfaEnroll.submit",
                )}
              </AuthPrimaryButton>
              <AuthInlineLink
                href={API_REDIRECT_LOCATIONS.mfaVerify}
                className="mt-2 self-center"
              >
                {resolveMessage(appLocale, "pages.mfaEnroll.goToVerify")}
              </AuthInlineLink>
              <AuthNote className="mt-4">
                {resolveMessage(appLocale, "pages.mfaEnroll.accessHelp")}
              </AuthNote>
            </div>
          )}
        </div>
      </AuthFormSurface>
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
