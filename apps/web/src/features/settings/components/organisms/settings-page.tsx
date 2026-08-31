"use client";

import { useState } from "react";
import type {
  AuthBackupEmailPolicy,
  AuthPrimaryEmailAddressPolicy,
} from "@lcsp/contracts/auth";
import { resolveMessage } from "@lcsp/i18n";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";

import { ConfirmAccessDialog } from "@/components/organisms/confirm-access-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { appLocale } from "@/lib/locale";
import {
  useDisableMfaMutation,
  useAuthSessionsQuery,
  useAuthSettingsProfileQuery,
  useMfaEnrollMutation,
  useMfaVerifyMutation,
  usePasswordReauthMutation,
  useRequestRecoveryMutation,
  useRevokeAuthSessionMutation,
  useUpdateProfileMutation,
} from "@/lib/api/auth-queries";
import { useProviderCredentialStatusesQuery } from "@/lib/api/github-repository-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import { profileSafetySchema } from "@/features/auth/schemas/profile-safety.schema";
import {
  mfaVerifySchema,
  type MfaVerifyFormValues,
} from "@/features/auth/schemas/mfa-verify.schema";
import { useForm } from "react-hook-form";

import { AccountSettingsSection } from "./account-settings-section";
import { AppearanceSettingsSection } from "./appearance-settings-section";
import { EmailSettingsSection } from "./email-settings-section";
import { NotificationsSettingsSection } from "./notifications-settings-section";
import { PasswordAuthenticationSettingsSection } from "./password-authentication-settings-section";
import { RepositoriesSettingsSection } from "./repositories-settings-section";
import { GitHubRepositoryConnectDialog } from "./github-repository-connect-dialog";
import { SessionsSettingsSection } from "./sessions-settings-section";
import { useQrCode } from "../../hooks/use-qr-code";
import { SETTINGS_SECTION_IDS } from "../../types/settings.types";
import type {
  RecoveryEmailFormValues,
  SettingsAlertMessage,
} from "../../types/settings-page.types";
import { isSettingsSectionId } from "../../utils/settings-page.utils";

const SETTINGS_SENSITIVE_ACTIONS = {
  enableMfa: "enable_mfa",
  saveRecoveryEmail: "save_recovery_email",
  saveBackupPolicy: "save_backup_policy",
  savePrimaryEmailPolicy: "save_primary_email_policy",
  disableMfa: "disable_mfa",
  revokeSession: "revoke_session",
  connectGitHubRepository: "connect_github_repository",
  manageGitHubInstallation: "manage_github_installation",
  reauthenticateProviderCredential: "reauthenticate_provider_credential",
} as const;

type SettingsSensitiveAction = {
  resolveResult?: (success: boolean) => void;
} & (
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.enableMfa;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.saveRecoveryEmail;
      values: RecoveryEmailFormValues;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.saveBackupPolicy;
      policy: AuthBackupEmailPolicy;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.savePrimaryEmailPolicy;
      policy: AuthPrimaryEmailAddressPolicy;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.disableMfa;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.revokeSession;
      sessionId: string;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.connectGitHubRepository;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.manageGitHubInstallation;
      installationId: string;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.reauthenticateProviderCredential;
      retry: () => void;
    }
);

export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("section");
  const oauthLinkStatus = searchParams.get("oauth_link");
  const activeSection = isSettingsSectionId(requestedSection)
    ? requestedSection
    : SETTINGS_SECTION_IDS.passwordAndAuthentication;

  const profileQuery = useAuthSettingsProfileQuery();
  const sessionsQuery = useAuthSessionsQuery();
  const updateProfileMutation = useUpdateProfileMutation();
  const enrollMutation = useMfaEnrollMutation();
  const disableMfaMutation = useDisableMfaMutation();
  const verifyMutation = useMfaVerifyMutation();
  const passwordReauthMutation = usePasswordReauthMutation();
  const revokeSessionMutation = useRevokeAuthSessionMutation();
  const requestRecoveryMutation = useRequestRecoveryMutation();
  const providerCredentialStatusesQuery = useProviderCredentialStatusesQuery();

  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [mfaEditorOpen, setMfaEditorOpen] = useState(false);
  const [mfaError, setMfaError] = useState<SettingsAlertMessage | null>(null);
  const [recoveryRequestSent, setRecoveryRequestSent] = useState(false);
  const [confirmAccessOpen, setConfirmAccessOpen] = useState(false);
  const [pendingSensitiveAction, setPendingSensitiveAction] =
    useState<SettingsSensitiveAction | null>(null);
  const [confirmAccessMfaError, setConfirmAccessMfaError] =
    useState<SettingsAlertMessage | null>(null);
  const [confirmAccessPasswordError, setConfirmAccessPasswordError] =
    useState<SettingsAlertMessage | null>(null);
  const [githubConnectOpen, setGitHubConnectOpen] = useState(false);

  const recoveryForm = useForm<RecoveryEmailFormValues>({
    resolver: zodResolver(profileSafetySchema),
    defaultValues: { recovery_email: "" },
  });
  const verifyForm = useForm<MfaVerifyFormValues>({
    resolver: zodResolver(mfaVerifySchema),
    defaultValues: { otp: "" },
  });

  const profile = profileQuery.data;
  const sessions = sessionsQuery.data ?? [];
  const activeSessionsCount = sessions.filter(
    (session) => session.revoked_at === null,
  ).length;
  const primaryEmailBadgeKey = profile?.email_verified
    ? "pages.workspace.settingsHub.badges.verified"
    : "pages.workspace.settingsHub.badges.unverified";

  const profileLoadFailed = profileQuery.isError || sessionsQuery.isError;

  function openSensitiveAction(action: SettingsSensitiveAction) {
    setConfirmAccessMfaError(null);
    setConfirmAccessPasswordError(null);
    setPendingSensitiveAction(action);
    setConfirmAccessOpen(true);
  }

  function closeConfirmAccessDialog(cancelled = true) {
    if (cancelled) {
      pendingSensitiveAction?.resolveResult?.(false);
    }
    setConfirmAccessOpen(false);
    setPendingSensitiveAction(null);
    setConfirmAccessMfaError(null);
    setConfirmAccessPasswordError(null);
  }

  async function executeSaveRecoveryEmail(values: RecoveryEmailFormValues) {
    const outcome = await updateProfileMutation
      .mutateAsync(values)
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey:
          "pages.workspace.settingsHub.errors.profileLoadTitle" as const,
        detailKey:
          "pages.workspace.settingsHub.errors.profileLoadDetail" as const,
      }));

    if (outcome.kind === API_OUTCOME_KINDS.saved) {
      await profileQuery.refetch();
      recoveryForm.reset({ recovery_email: "" });
      toast.success(
        resolveMessage(appLocale, "pages.workspace.security.successTitle"),
      );
      return true;
    }

    if (outcome.kind === API_OUTCOME_KINDS.validationError) {
      recoveryForm.setError("recovery_email", {
        message: outcome.detailKey,
      });
      return false;
    }

    recoveryForm.setError("root", {
      message:
        outcome.kind === API_OUTCOME_KINDS.sessionInvalid
          ? "auth.errors.sessionInvalid.detail"
          : outcome.kind === API_OUTCOME_KINDS.mfaRequired
            ? "auth.errors.mfaRequired.detail"
            : outcome.detailKey,
    });
    return false;
  }

  async function executeSaveBackupPolicy(policy: AuthBackupEmailPolicy) {
    const outcome = await updateProfileMutation
      .mutateAsync({
        backup_recovery_email_policy: policy,
      })
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey:
          "pages.workspace.settingsHub.errors.profileLoadTitle" as const,
        detailKey:
          "pages.workspace.settingsHub.errors.profileLoadDetail" as const,
      }));

    if (outcome.kind === API_OUTCOME_KINDS.saved) {
      await profileQuery.refetch();
      return true;
    }

    toast.error(
      resolveMessage(
        appLocale,
        outcome.kind === API_OUTCOME_KINDS.validationError
          ? outcome.detailKey
          : "pages.workspace.settingsHub.errors.profileLoadDetail",
      ),
    );
    return false;
  }

  async function executeSavePrimaryEmailPolicy(
    policy: AuthPrimaryEmailAddressPolicy,
  ) {
    const outcome = await updateProfileMutation
      .mutateAsync({
        primary_email_address_policy: policy,
      })
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey:
          "pages.workspace.settingsHub.errors.profileLoadTitle" as const,
        detailKey:
          "pages.workspace.settingsHub.errors.profileLoadDetail" as const,
      }));

    if (outcome.kind === API_OUTCOME_KINDS.saved) {
      await profileQuery.refetch();
      return true;
    }

    toast.error(
      resolveMessage(
        appLocale,
        outcome.kind === API_OUTCOME_KINDS.validationError
          ? outcome.detailKey
          : "pages.workspace.settingsHub.errors.profileLoadDetail",
      ),
    );
    return false;
  }

  async function executeDisableMfa() {
    const outcome = await disableMfaMutation.mutateAsync().catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey:
        "pages.workspace.settingsHub.password.disableFailedTitle" as const,
      detailKey:
        "pages.workspace.settingsHub.password.disableFailedDescription" as const,
    }));

    if (outcome.kind === API_OUTCOME_KINDS.disabled) {
      setTotpUri(null);
      setMfaEditorOpen(false);
      setRecoveryRequestSent(false);
      verifyForm.reset();
      await Promise.all([profileQuery.refetch(), sessionsQuery.refetch()]);
      toast.success(
        resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.password.mfaDisabledTitle",
        ),
      );
      return true;
    }

    setMfaError(
      outcome.kind === API_OUTCOME_KINDS.sessionInvalid
        ? {
            titleKey: "auth.errors.sessionInvalid.title",
            detailKey: "auth.errors.sessionInvalid.detail",
          }
        : outcome.kind === API_OUTCOME_KINDS.mfaRequired
          ? {
              titleKey: "auth.errors.mfaRequired.title",
              detailKey: "auth.errors.mfaRequired.detail",
            }
          : {
              titleKey: outcome.titleKey,
              detailKey: outcome.detailKey,
            },
    );
    return false;
  }

  async function executeRevokeSession(sessionId: string) {
    try {
      await revokeSessionMutation.mutateAsync(sessionId);
      toast.success(
        resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.sessions.revokedTitle",
        ),
      );
      return true;
    } catch {
      toast.error(
        resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.errors.sessionActionDetail",
        ),
      );
      return false;
    }
  }

  function redirectToGitHubAppStart(installationId?: string) {
    const startUrl = installationId
      ? `/api/github/app/start?installation_id=${encodeURIComponent(
          installationId,
        )}`
      : "/api/github/app/start";

    window.location.href = startUrl;
  }

  async function executeSensitiveAction(
    action: SettingsSensitiveAction,
  ): Promise<boolean> {
    switch (action.kind) {
      case SETTINGS_SENSITIVE_ACTIONS.enableMfa:
        return handleGenerateMfaSetup();
      case SETTINGS_SENSITIVE_ACTIONS.saveRecoveryEmail:
        return executeSaveRecoveryEmail(action.values);
      case SETTINGS_SENSITIVE_ACTIONS.saveBackupPolicy:
        return executeSaveBackupPolicy(action.policy);
      case SETTINGS_SENSITIVE_ACTIONS.savePrimaryEmailPolicy:
        return executeSavePrimaryEmailPolicy(action.policy);
      case SETTINGS_SENSITIVE_ACTIONS.disableMfa:
        return executeDisableMfa();
      case SETTINGS_SENSITIVE_ACTIONS.revokeSession:
        return executeRevokeSession(action.sessionId);
      case SETTINGS_SENSITIVE_ACTIONS.connectGitHubRepository:
        setGitHubConnectOpen(true);
        return true;
      case SETTINGS_SENSITIVE_ACTIONS.manageGitHubInstallation:
        redirectToGitHubAppStart(action.installationId);
        return true;
      case SETTINGS_SENSITIVE_ACTIONS.reauthenticateProviderCredential:
        action.retry();
        return true;
      default:
        return false;
    }
  }

  async function handleConfirmAccessPasswordSubmit(values: {
    password: string;
  }) {
    if (!pendingSensitiveAction) {
      return;
    }

    setConfirmAccessPasswordError(null);
    const outcome = await passwordReauthMutation
      .mutateAsync(values)
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey: "pages.signIn.errors.requestFailedTitle" as const,
        detailKey: "pages.signIn.errors.requestFailedDetail" as const,
      }));

    if (outcome.kind === API_OUTCOME_KINDS.invalid) {
      setConfirmAccessPasswordError({
        titleKey: "auth.errors.invalidCredentials.title",
        detailKey: "auth.errors.invalidCredentials.detail",
      });
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.sessionInvalid) {
      setConfirmAccessPasswordError({
        titleKey: "auth.errors.sessionInvalid.title",
        detailKey: "auth.errors.sessionInvalid.detail",
      });
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.error) {
      setConfirmAccessPasswordError({
        titleKey: outcome.titleKey,
        detailKey: outcome.detailKey,
      });
      return;
    }

    const success = await executeSensitiveAction(pendingSensitiveAction);
    pendingSensitiveAction.resolveResult?.(success);
    closeConfirmAccessDialog(false);
  }

  async function handleConfirmAccessOtpSubmit(values: MfaVerifyFormValues) {
    setConfirmAccessMfaError(null);
    const outcome = await verifyMutation.mutateAsync(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.mfaVerify.errors.requestFailedTitle" as const,
      detailKey: "pages.mfaVerify.errors.requestFailedDetail" as const,
    }));

    if (outcome.kind === API_OUTCOME_KINDS.verified) {
      await Promise.all([profileQuery.refetch(), sessionsQuery.refetch()]);
      if (!pendingSensitiveAction) {
        closeConfirmAccessDialog(false);
        return;
      }

      const success = await executeSensitiveAction(pendingSensitiveAction);
      pendingSensitiveAction.resolveResult?.(success);
      closeConfirmAccessDialog(false);
      return;
    }

    setConfirmAccessMfaError(
      outcome.kind === API_OUTCOME_KINDS.sessionInvalid
        ? {
            titleKey: "auth.errors.sessionInvalid.title",
            detailKey: "auth.errors.sessionInvalid.detail",
          }
        : outcome.kind === API_OUTCOME_KINDS.mfaRequired
          ? {
              titleKey: "auth.errors.mfaRequired.title",
              detailKey: "auth.errors.mfaRequired.detail",
            }
          : {
              titleKey: outcome.titleKey,
              detailKey: outcome.detailKey,
            },
    );
  }

  async function handleSaveRecoveryEmail(values: RecoveryEmailFormValues) {
    openSensitiveAction({
      kind: SETTINGS_SENSITIVE_ACTIONS.saveRecoveryEmail,
      values,
    });
  }

  function handleSaveBackupPolicy(policy: AuthBackupEmailPolicy) {
    return new Promise<boolean>((resolve) => {
      openSensitiveAction({
        kind: SETTINGS_SENSITIVE_ACTIONS.saveBackupPolicy,
        policy,
        resolveResult: resolve,
      });
    });
  }

  function handleSavePrimaryEmailPolicy(policy: AuthPrimaryEmailAddressPolicy) {
    return new Promise<boolean>((resolve) => {
      openSensitiveAction({
        kind: SETTINGS_SENSITIVE_ACTIONS.savePrimaryEmailPolicy,
        policy,
        resolveResult: resolve,
      });
    });
  }

  async function handleGenerateMfaSetup(): Promise<boolean> {
    setMfaError(null);
    setRecoveryRequestSent(false);
    const outcome = await enrollMutation.mutateAsync().catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.mfaEnroll.errors.requestFailedTitle" as const,
      detailKey: "pages.mfaEnroll.errors.requestFailedDetail" as const,
    }));

    if (outcome.kind === API_OUTCOME_KINDS.loaded) {
      setTotpUri(outcome.totpUri);
      setMfaEditorOpen(true);
      return true;
    }

    if (outcome.kind === API_OUTCOME_KINDS.sessionInvalid) {
      setMfaError({
        titleKey: "auth.errors.sessionInvalid.title",
        detailKey: "auth.errors.sessionInvalid.detail",
      });
      return false;
    }

    if (outcome.kind === API_OUTCOME_KINDS.mfaRequired) {
      setMfaError({
        titleKey: "auth.errors.mfaRequired.title",
        detailKey: "auth.errors.mfaRequired.detail",
      });
      return false;
    }

    setMfaError({
      titleKey: outcome.titleKey,
      detailKey: outcome.detailKey,
    });
    return false;
  }

  async function handleVerifyOtp(values: MfaVerifyFormValues) {
    setMfaError(null);
    const outcome = await verifyMutation.mutateAsync(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.mfaVerify.errors.requestFailedTitle" as const,
      detailKey: "pages.mfaVerify.errors.requestFailedDetail" as const,
    }));

    verifyForm.reset();

    if (outcome.kind === API_OUTCOME_KINDS.verified) {
      setTotpUri(null);
      setMfaEditorOpen(false);
      await Promise.all([profileQuery.refetch(), sessionsQuery.refetch()]);
      toast.success(
        resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.password.mfaVerifiedTitle",
        ),
      );
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.invalid) {
      verifyForm.setError("otp", {
        message: outcome.detailKey,
      });
      return;
    }

    setMfaError(
      outcome.kind === API_OUTCOME_KINDS.sessionInvalid
        ? {
            titleKey: "auth.errors.sessionInvalid.title",
            detailKey: "auth.errors.sessionInvalid.detail",
          }
        : outcome.kind === API_OUTCOME_KINDS.mfaRequired
          ? {
              titleKey: "auth.errors.mfaRequired.title",
              detailKey: "auth.errors.mfaRequired.detail",
            }
          : {
              titleKey: outcome.titleKey,
              detailKey: outcome.detailKey,
            },
    );
  }

  async function handleToggleMfa(nextEnabled: boolean) {
    if (!profile) {
      return;
    }

    setMfaError(null);

    if (nextEnabled) {
      setMfaEditorOpen(false);
      openSensitiveAction({
        kind: SETTINGS_SENSITIVE_ACTIONS.enableMfa,
      });
      return;
    }

    openSensitiveAction({
      kind: SETTINGS_SENSITIVE_ACTIONS.disableMfa,
    });
  }

  async function handleSendRecoveryInstructions() {
    if (!profile) return;

    setRecoveryRequestSent(false);
    const outcome = await requestRecoveryMutation
      .mutateAsync({ email: profile.email })
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey: "pages.recoveryRequest.errors.requestFailedTitle" as const,
        detailKey: "pages.recoveryRequest.errors.requestFailedDetail" as const,
      }));

    if (outcome.kind === API_OUTCOME_KINDS.requested) {
      setRecoveryRequestSent(true);
      return;
    }

    setMfaError(outcome);
  }

  function handleRequestMfaSetup() {
    setMfaEditorOpen(false);
    openSensitiveAction({
      kind: SETTINGS_SENSITIVE_ACTIONS.enableMfa,
    });
  }

  async function handleRevokeSession(sessionId: string) {
    openSensitiveAction({
      kind: SETTINGS_SENSITIVE_ACTIONS.revokeSession,
      sessionId,
    });
  }

  const qrCode = useQrCode(totpUri);
  const mfaToggleBusy =
    enrollMutation.isPending ||
    disableMfaMutation.isPending ||
    verifyMutation.isPending;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 text-foreground lg:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {resolveMessage(appLocale, "pages.workspace.settingsTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.description",
            )}
          </p>
        </header>

        {profileLoadFailed ? (
          <Alert variant="destructive">
            <AlertTitle>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.errors.profileLoadTitle",
              )}
            </AlertTitle>
            <AlertDescription>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.errors.profileLoadDetail",
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-6">
          {profile ? (
            <>
              <ConfirmAccessDialog
                open={confirmAccessOpen}
                onOpenChange={(open) => {
                  if (open) {
                    setConfirmAccessOpen(true);
                    return;
                  }
                  closeConfirmAccessDialog(true);
                }}
                onPasswordSubmit={handleConfirmAccessPasswordSubmit}
                accountLabelKey="pages.workspace.settingsHub.reauth.accountLabel"
                accountHandle={profile.email}
                avatarFallback={profile.email.slice(0, 1).toUpperCase()}
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
                errorTitleKey={confirmAccessPasswordError?.titleKey}
                errorKey={confirmAccessPasswordError?.detailKey ?? null}
                mfa={{
                  isEnabled: profile.mfa_enrolled,
                  isConfigured: profile.mfa_enrolled,
                  onSubmit: handleConfirmAccessOtpSubmit,
                  otpLabelKey: "pages.mfaVerify.otpLabel",
                  otpDescriptionKey: "pages.mfaVerify.otpDescription",
                  otpPlaceholderKey:
                    "pages.workspace.settingsHub.reauth.otpPlaceholder",
                  verifyLabelKey: "pages.workspace.settingsHub.reauth.verify",
                  verifyingLabelKey:
                    "pages.workspace.settingsHub.reauth.verifying",
                  switchToMfaLabelKey: profile.mfa_enrolled
                    ? "pages.workspace.settingsHub.reauth.useAuthenticator"
                    : "pages.workspace.settingsHub.reauth.setUpMfa",
                  switchToPasswordLabelKey:
                    "pages.workspace.settingsHub.reauth.usePassword",
                  onSetupRequest: () => {
                    router.push(API_REDIRECT_LOCATIONS.mfaEnroll);
                  },
                  errorTitleKey: confirmAccessMfaError?.titleKey,
                  errorKey: confirmAccessMfaError?.detailKey ?? null,
                }}
              />
              <GitHubRepositoryConnectDialog
                open={githubConnectOpen}
                onOpenChange={setGitHubConnectOpen}
                onConnected={() => undefined}
              />
            </>
          ) : null}

          <Card className="border-border/70">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold">
                  {profile?.display_name ??
                    resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.labels.account",
                    )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {profile?.email ?? "…"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {profile
                    ? resolveMessage(appLocale, primaryEmailBadgeKey)
                    : "…"}
                </Badge>
                <Badge variant="outline">
                  {profile?.mfa_enrolled
                    ? resolveMessage(
                        appLocale,
                        "pages.workspace.settingsHub.badges.mfaEnabled",
                      )
                    : resolveMessage(
                        appLocale,
                        "pages.workspace.settingsHub.badges.mfaPending",
                      )}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {activeSection === SETTINGS_SECTION_IDS.account ? (
            <AccountSettingsSection
              profile={profile}
              primaryEmailBadgeKey={primaryEmailBadgeKey}
              oauthLinkStatus={oauthLinkStatus}
            />
          ) : null}

          {activeSection === SETTINGS_SECTION_IDS.appearance ? (
            <AppearanceSettingsSection />
          ) : null}

          {activeSection === SETTINGS_SECTION_IDS.notifications ? (
            <NotificationsSettingsSection
              profile={profile}
              primaryEmailBadgeKey={primaryEmailBadgeKey}
            />
          ) : null}

          {activeSection === SETTINGS_SECTION_IDS.emails ? (
            <EmailSettingsSection
              profile={profile}
              primaryEmailBadgeKey={primaryEmailBadgeKey}
              recoveryForm={recoveryForm}
              onSubmit={handleSaveRecoveryEmail}
              onPrimaryEmailPolicyChange={handleSavePrimaryEmailPolicy}
              onBackupPolicyChange={handleSaveBackupPolicy}
              primaryPolicySaving={updateProfileMutation.isPending}
              backupPolicySaving={updateProfileMutation.isPending}
            />
          ) : null}

          {activeSection === SETTINGS_SECTION_IDS.passwordAndAuthentication ? (
            <PasswordAuthenticationSettingsSection
              profile={profile}
              primaryEmailBadgeKey={primaryEmailBadgeKey}
              mfaToggleBusy={mfaToggleBusy}
              mfaEditorOpen={mfaEditorOpen}
              setMfaEditorOpen={setMfaEditorOpen}
              mfaError={mfaError}
              qrCode={qrCode}
              onToggleMfa={handleToggleMfa}
              onGenerateMfaSetup={handleRequestMfaSetup}
              enrollPending={enrollMutation.isPending}
              verifyForm={verifyForm}
              onVerifyOtp={handleVerifyOtp}
              onSendRecoveryInstructions={handleSendRecoveryInstructions}
              recoveryRequestSent={recoveryRequestSent}
              requestRecoveryPending={requestRecoveryMutation.isPending}
            />
          ) : null}

          {activeSection === SETTINGS_SECTION_IDS.sessions ? (
            <SessionsSettingsSection
              sessions={sessions}
              activeSessionsCount={activeSessionsCount}
              revokePending={revokeSessionMutation.isPending}
              onRevokeSession={handleRevokeSession}
            />
          ) : null}

          {activeSection === SETTINGS_SECTION_IDS.repositories ? (
            <RepositoriesSettingsSection
              providerCredentialStatuses={
                providerCredentialStatusesQuery.data ?? []
              }
              onReauthenticate={(retry) =>
                openSensitiveAction({
                  kind: SETTINGS_SENSITIVE_ACTIONS.reauthenticateProviderCredential,
                  retry,
                })
              }
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
