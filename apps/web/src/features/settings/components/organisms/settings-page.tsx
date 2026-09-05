"use client";

import { LOCALES, type Locale } from "@lcsp/contracts/shared";
import type { ReactNode } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { resolveMessage } from "@lcsp/i18n";
import {
  ChevronDownIcon,
  InfoIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";

import { ConfirmAccessDialog } from "@/components/organisms/confirm-access-dialog";
import { ThemePreferenceControl } from "@/components/molecules/theme-preference-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  appLocale,
  getAppLocaleSnapshot,
  hydrateAppLocaleFromCookie,
  setAppLocale,
  subscribeToAppLocale,
} from "@/lib/locale";
import { cn } from "@/lib/utils";
import type {
  AuthSessionSummary,
  AuthSettingsProfile,
} from "@/lib/api/auth-client";
import {
  useAuthSessionsQuery,
  useAuthSettingsProfileQuery,
  useMfaVerifyMutation,
  usePasswordReauthMutation,
  useRevokeAuthSessionMutation,
} from "@/lib/api/auth-queries";
import { useProviderCredentialStatusesQuery } from "@/lib/api/github-repository-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import type { MfaVerifyFormValues } from "@/features/auth/schemas/mfa-verify.schema";

import { RepositoriesSettingsSection } from "./repositories-settings-section";
import { SettingsSidebar } from "./settings-sidebar";
import { SETTINGS_SECTION_IDS } from "../../types/settings.types";
import type { SettingsSectionId } from "../../types/settings.types";
import type { SettingsAlertMessage } from "../../types/settings-page.types";
import {
  formatDateTime,
  normalizeSettingsSection,
} from "../../utils/settings-page.utils";

type SettingsPageProps = {
  activeSection?: SettingsSectionId;
  onSectionChange?: (section: SettingsSectionId) => void;
  presentation?: "page" | "modal";
};

const SETTINGS_SENSITIVE_ACTIONS = {
  revokeSession: "revoke_session",
  reauthenticateProviderCredential: "reauthenticate_provider_credential",
} as const;

type SettingsSensitiveAction = {
  resolveResult?: (success: boolean) => void;
} & (
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.revokeSession;
      sessionId: string;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.reauthenticateProviderCredential;
      retry: () => void;
    }
);

export function SettingsPage({
  activeSection: controlledActiveSection,
  onSectionChange,
  presentation = "page",
}: SettingsPageProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const settingsLocale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );

  useEffect(() => {
    hydrateAppLocaleFromCookie();
  }, []);
  const legacyHashSection = useSyncExternalStore(
    subscribeToHashChange,
    getCurrentHashSection,
    getServerHashSection,
  );
  const requestedSection = searchParams.get("section");
  const activeSection =
    controlledActiveSection ??
    normalizeSettingsSection(requestedSection ?? legacyHashSection);

  const profileQuery = useAuthSettingsProfileQuery();
  const sessionsQuery = useAuthSessionsQuery();
  const verifyMutation = useMfaVerifyMutation();
  const passwordReauthMutation = usePasswordReauthMutation();
  const revokeSessionMutation = useRevokeAuthSessionMutation();
  const providerCredentialStatusesQuery = useProviderCredentialStatusesQuery();

  const [confirmAccessOpen, setConfirmAccessOpen] = useState(false);
  const [pendingSensitiveAction, setPendingSensitiveAction] =
    useState<SettingsSensitiveAction | null>(null);
  const [confirmAccessMfaError, setConfirmAccessMfaError] =
    useState<SettingsAlertMessage | null>(null);
  const [confirmAccessPasswordError, setConfirmAccessPasswordError] =
    useState<SettingsAlertMessage | null>(null);

  const profile = profileQuery.data;
  const sessions = sessionsQuery.data ?? [];

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

  async function executeSensitiveAction(
    action: SettingsSensitiveAction,
  ): Promise<boolean> {
    switch (action.kind) {
      case SETTINGS_SENSITIVE_ACTIONS.revokeSession:
        return executeRevokeSession(action.sessionId);
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

  async function handleRevokeSession(sessionId: string) {
    openSensitiveAction({
      kind: SETTINGS_SENSITIVE_ACTIONS.revokeSession,
      sessionId,
    });
  }

  function handleSectionChange(section: SettingsSectionId) {
    onSectionChange?.(section);
    if (!onSectionChange) {
      router.replace(`/workspace/settings?section=${section}`);
    }
  }

  return (
    <main
      className={
        presentation === "modal"
          ? "flex h-full min-h-0 flex-col overflow-hidden text-foreground md:flex-row"
          : "flex flex-1 flex-col px-4 py-6 text-foreground lg:px-6"
      }
      data-component="SettingsPage"
      data-presentation={presentation}
      data-locale={settingsLocale}
    >
      <div
        className={
          presentation === "modal"
            ? "flex min-h-0 flex-1 flex-col md:flex-row"
            : "mx-auto flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm md:min-h-205 md:flex-row"
        }
      >
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        />
        <section className="min-h-0 flex-1 overflow-hidden">
          {profileLoadFailed ? (
            <Alert className="mb-5" variant="destructive">
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

          <div className="h-full min-h-0">
            {profile ? (
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
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.general ? (
              <GeneralSettingsPanel profile={profile} />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.account ? (
              <AccountSettingsPanel
                sessions={sessions}
                revokePending={revokeSessionMutation.isPending}
                onRevokeSession={handleRevokeSession}
              />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.privacy ? (
              <UnsupportedSettingsPanel
                titleKey="pages.workspace.settingsHub.privacy.title"
                descriptionKey="pages.workspace.settingsHub.privacy.description"
                rows={[
                  "pages.workspace.settingsHub.privacy.repositoryMetadata",
                  "pages.workspace.settingsHub.privacy.improveModels",
                  "pages.workspace.settingsHub.privacy.exportData",
                  "pages.workspace.settingsHub.privacy.sharedAssessments",
                  "pages.workspace.settingsHub.privacy.memoryPreferences",
                ]}
              />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.billing ? (
              <UnsupportedSettingsPanel
                titleKey="pages.workspace.settingsHub.billing.title"
                descriptionKey="pages.workspace.settingsHub.billing.description"
                rows={[
                  "pages.workspace.settingsHub.billing.creditBalance",
                  "pages.workspace.settingsHub.billing.buyCredits",
                  "pages.workspace.settingsHub.billing.autoReload",
                  "pages.workspace.settingsHub.billing.paymentMethod",
                  "pages.workspace.settingsHub.billing.invoices",
                ]}
              />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.usage ? (
              <UnsupportedSettingsPanel
                titleKey="pages.workspace.settingsHub.usage.title"
                descriptionKey="pages.workspace.settingsHub.usage.description"
                rows={[
                  "pages.workspace.settingsHub.usage.creditUsage",
                  "pages.workspace.settingsHub.usage.balance",
                  "pages.workspace.settingsHub.usage.spendingLimit",
                ]}
              />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.capabilities ? (
              <CapabilitiesSettingsPanel />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.connectors ? (
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
        </section>
      </div>
    </main>
  );
}

function subscribeToHashChange(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

function getCurrentHashSection() {
  return window.location.hash.replace(/^#/, "") || null;
}

function getServerHashSection() {
  return null;
}

function GeneralSettingsPanel({
  profile,
}: {
  profile: AuthSettingsProfile | undefined;
}) {
  return (
    <SettingsPanelCanvas dataComponent="GeneralSettingsPanel">
      <SettingsSectionHeading top="top-10">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.general.profileTitle",
        )}
      </SettingsSectionHeading>
      <SettingsControlRow className="top-18">
        <label className="text-sm" htmlFor="settings-full-name">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.general.fullName",
          )}
        </label>
        <Input
          id="settings-full-name"
          className="h-9 w-51 text-[13px]"
          value={profile?.display_name ?? ""}
          readOnly
        />
      </SettingsControlRow>
      <SettingsControlRow className="top-30.5">
        <label className="text-sm" htmlFor="settings-assistant-name">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.general.assistantName",
          )}
        </label>
        <Input
          id="settings-assistant-name"
          className="h-9 w-51 text-[13px]"
          value={profile?.display_name ?? ""}
          readOnly
        />
      </SettingsControlRow>
      <SettingsDivider className="top-43.5" />
      <SettingsSectionHeading top="top-50">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.general.preferencesTitle",
        )}
      </SettingsSectionHeading>
      <SettingsControlRow className="top-58">
        <span className="text-sm">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.general.appearance",
          )}
        </span>
        <ThemePreferenceControl variant="compact" />
      </SettingsControlRow>
      <SettingsDivider className="top-71" />
      <SettingsControlRow className="top-73">
        <label className="text-sm" htmlFor="settings-language">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.general.language",
          )}
        </label>
        <SettingsLanguageSelect />
      </SettingsControlRow>
      <SettingsDivider className="top-86" />
      <SettingsControlRow className="top-88">
        <label className="text-sm" htmlFor="settings-chat-font">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.general.chatFont",
          )}
        </label>
        <ReadonlySelectValue
          id="settings-chat-font"
          className="w-43.5"
          value={resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.general.chatFontInter",
          )}
        />
      </SettingsControlRow>
      <SettingsDivider className="top-101" />
      <SettingsSectionHeading top="top-107.5">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.general.notificationsTitle",
        )}
      </SettingsSectionHeading>
      <ReadonlySwitchRow
        className="top-118"
        titleKey="pages.workspace.settingsHub.general.assessmentCompletions"
        descriptionKey="pages.workspace.settingsHub.general.assessmentCompletionsDescription"
      />
      <SettingsDivider className="top-130" />
      <ReadonlySwitchRow
        className="top-134.5"
        titleKey="pages.workspace.settingsHub.general.remediationApprovals"
        descriptionKey="pages.workspace.settingsHub.general.remediationApprovalsDescription"
      />
      <SettingsDivider className="top-146.5" />
    </SettingsPanelCanvas>
  );
}

function AccountSettingsPanel({
  onRevokeSession,
  revokePending,
  sessions,
}: {
  onRevokeSession: (sessionId: string) => void | Promise<void>;
  revokePending: boolean;
  sessions: AuthSessionSummary[];
}) {
  return (
    <SettingsPanelCanvas dataComponent="AccountSettingsPanel">
      <SettingsControlRow className="top-17.5">
        <span className="text-sm">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.sessions.logOutAllDevicesTitle",
          )}
        </span>
        <Button className="h-9 w-20 text-[13px]" disabled variant="outline">
          {resolveMessage(appLocale, "pages.appShell.signOut")}
        </Button>
      </SettingsControlRow>
      <SettingsDivider className="top-30" />
      <SettingsSectionHeading top="top-37">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.labels.trustedDevices",
        )}
      </SettingsSectionHeading>
      <p className="absolute top-45 left-8.5 text-[13px] text-muted-foreground">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.sessions.trustedDevicesDescription",
        )}
      </p>
      <p className="absolute top-53.5 left-8.5 text-sm text-muted-foreground">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.sessions.noTrustedDevices",
        )}
      </p>
      <SettingsSectionHeading top="top-65">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.sessions.activeTitle",
        )}
      </SettingsSectionHeading>
      <div className="absolute top-74.5 left-8.5 grid w-218 grid-cols-[212px_224px_230px_1fr_48px] text-[13px] font-medium text-muted-foreground">
        <span>
          {resolveMessage(appLocale, "pages.workspace.settingsHub.labels.device")}
        </span>
        <span>
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.labels.location",
          )}
        </span>
        <span>
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.labels.createdAt",
          )}
        </span>
        <span>
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.labels.updatedAt",
          )}
        </span>
      </div>
      <SettingsDivider className="top-81" />
      <div
        className="absolute top-81.25 left-8.5 max-h-60 w-218 overflow-y-auto overflow-x-hidden"
        data-component="CompactSessionList"
      >
        {sessions.length === 0 ? (
          <p className="py-5 pl-3 text-sm text-muted-foreground">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.states.noSessions",
            )}
          </p>
        ) : (
          sessions.map((session) => (
            <CompactSessionRow
              key={session.id}
              session={session}
              revokePending={revokePending}
              onRevokeSession={onRevokeSession}
            />
          ))
        )}
      </div>
    </SettingsPanelCanvas>
  );
}

function CompactSessionRow({
  onRevokeSession,
  revokePending,
  session,
}: {
  onRevokeSession: (sessionId: string) => void | Promise<void>;
  revokePending: boolean;
  session: AuthSessionSummary;
}) {
  const canRevoke = !session.is_current && session.revoked_at === null;
  return (
    <div
      className="group relative grid h-12 grid-cols-[212px_224px_230px_1fr_48px] items-center rounded-lg text-[13px] hover:bg-muted/60 focus-within:bg-muted/60"
      data-component="CompactSessionRow"
    >
      <div className="flex items-center gap-2 overflow-hidden pl-3">
        <span className="truncate">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.sessions.webSession",
          )}
        </span>
        {session.is_current ? (
          <Badge className="h-6 rounded-md px-2 text-xs" variant="secondary">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.states.currentSession",
            )}
          </Badge>
        ) : null}
      </div>
      <span className="truncate">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.sessions.unknownLocation",
        )}
      </span>
      <span className="truncate">{formatDateTime(session.created_at)}</span>
      <span className="truncate">{formatDateTime(session.updated_at)}</span>
      <div className="flex size-12 items-center justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.sessions.actionMenuLabel",
                )}
                className="size-8 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                disabled={!canRevoke || revokePending}
                size="icon-sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => void onRevokeSession(session.id)}>
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.actions.revoke",
                )}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Separator className="absolute bottom-0 left-0 w-full" />
    </div>
  );
}

function ReadonlySelectValue({
  className,
  id,
  value,
}: {
  className?: string;
  id: string;
  value: string;
}) {
  return (
    <button
      id={id}
      type="button"
      disabled
      className={`flex h-9 cursor-not-allowed items-center justify-between rounded-lg border border-input bg-muted/20 px-3 text-[13px] text-muted-foreground opacity-80 ${className ?? "w-44"}`}
    >
      <span className="truncate">{value}</span>
      <ChevronDownIcon aria-hidden="true" className="size-3.5" />
    </button>
  );
}

function SettingsLanguageSelect() {
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );

  function handleLocaleChange(value: string) {
    if (!LOCALES.includes(value as Locale)) return;
    setAppLocale(value as Locale);
  }

  const languageLabels: Record<Locale, Parameters<typeof resolveMessage>[1]> = {
    en: "pages.workspace.settingsHub.general.languageEnglish",
    vi: "pages.workspace.settingsHub.general.languageVietnamese",
  };
  const selectedLanguageLabel = resolveMessage(locale, languageLabels[locale]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            id="settings-language"
            type="button"
            aria-label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.general.language",
            )}
            className="flex h-9 w-36 items-center justify-between rounded-lg border border-input bg-muted/35 px-3 text-left text-[13px] font-normal text-foreground outline-none transition-colors hover:bg-muted/45 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            data-component="SettingsLanguageSelectTrigger"
          >
            <span className="min-w-0 truncate">{selectedLanguageLabel}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-3.5 shrink-0"
            />
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="w-65 rounded-xl border-border bg-popover p-[7px] shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
        data-component="SettingsLanguageSelectContent"
      >
        <DropdownMenuRadioGroup value={locale} onValueChange={handleLocaleChange}>
          {LOCALES.map((option) => {
            const selected = option === locale;
            return (
              <DropdownMenuRadioItem
                key={option}
                value={option}
                className={cn(
                  "h-9.5 w-61 rounded-lg px-3 pr-9 text-sm text-foreground focus:bg-accent focus:text-accent-foreground [&_[data-slot=dropdown-menu-radio-item-indicator]]:right-3 [&_[data-slot=dropdown-menu-radio-item-indicator]>svg]:size-4",
                  selected && "bg-accent font-medium text-accent-foreground",
                )}
                data-component="SettingsLanguageSelectOption"
                data-locale-option={option}
                data-selected={selected ? "true" : undefined}
              >
                {resolveMessage(locale, languageLabels[option])}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingsPanelCanvas({
  children,
  dataComponent,
}: {
  children: ReactNode;
  dataComponent: string;
}) {
  return (
    <section
      className="relative h-full min-h-0 overflow-hidden px-8.5 py-10 text-foreground"
      data-component={dataComponent}
    >
      {children}
    </section>
  );
}

function ReadonlySwitchRow({
  checked = true,
  className,
  descriptionKey,
  titleKey,
}: {
  checked?: boolean;
  className?: string;
  descriptionKey: Parameters<typeof resolveMessage>[1];
  titleKey: Parameters<typeof resolveMessage>[1];
}) {
  return (
    <div
      className={`absolute left-8.5 flex h-12 w-218 items-start justify-between gap-4 ${className ?? ""}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm">{resolveMessage(appLocale, titleKey)}</span>
        <span className="text-xs text-muted-foreground">
          {resolveMessage(appLocale, descriptionKey)}
        </span>
      </div>
      <Switch
        checked={checked}
        disabled
        aria-label={resolveMessage(appLocale, titleKey)}
      />
    </div>
  );
}

function UnsupportedSettingsPanel({
  descriptionKey,
  rows,
  titleKey,
}: {
  descriptionKey: Parameters<typeof resolveMessage>[1];
  rows: Parameters<typeof resolveMessage>[1][];
  titleKey: Parameters<typeof resolveMessage>[1];
}) {
  return (
    <SettingsPanelCanvas dataComponent="UnsupportedSettingsPanel">
      <p className="absolute top-19.5 left-8.5 text-[13px] text-muted-foreground">
        {resolveMessage(appLocale, descriptionKey)}
      </p>
      <SettingsSectionHeading top="top-31.5">
        {resolveMessage(appLocale, titleKey)}
      </SettingsSectionHeading>
      <div className="absolute top-36.5 left-8.5 flex w-218 flex-col">
        {rows.map((row) => (
          <div
            key={row}
            className="flex h-17.5 items-center justify-between border-b border-border/70"
          >
            <span className="text-sm">{resolveMessage(appLocale, row)}</span>
            <Button type="button" variant="outline" size="sm" disabled>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.states.notSupported",
              )}
            </Button>
          </div>
        ))}
      </div>
    </SettingsPanelCanvas>
  );
}

function CapabilitiesSettingsPanel() {
  return (
    <SettingsPanelCanvas dataComponent="CapabilitiesSettingsPanel">
      <SettingsSectionHeading top="top-10">
        {resolveMessage(appLocale, "pages.workspace.settingsHub.sections.general")}
      </SettingsSectionHeading>
      <SettingsControlRow className="top-18">
        <div className="flex flex-col gap-1">
          <label className="text-sm" htmlFor="settings-tool-access-mode">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.capabilities.toolAccessMode",
            )}
          </label>
          <span className="text-[13px] text-muted-foreground">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.capabilities.toolAccessModeDescription",
            )}
          </span>
        </div>
        <ReadonlySelectValue
          id="settings-tool-access-mode"
          className="w-56.5"
          value={resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.capabilities.loadToolsWhenNeeded",
          )}
        />
      </SettingsControlRow>
      <SettingsDivider className="top-34.5" />
      <ReadonlySwitchRow
        className="top-38.5"
        titleKey="pages.workspace.settingsHub.capabilities.connectorSearch"
        descriptionKey="pages.workspace.settingsHub.capabilities.connectorSearchDescription"
      />
      <SettingsDivider className="top-53" />
      <SettingsSectionHeading top="top-60.5">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.capabilities.executionTitle",
        )}
      </SettingsSectionHeading>
      <ReadonlySwitchRow
        className="top-70.5"
        titleKey="pages.workspace.settingsHub.capabilities.artifacts"
        descriptionKey="pages.workspace.settingsHub.capabilities.artifactsDescription"
      />
      <SettingsDivider className="top-85" />
      <ReadonlySwitchRow
        checked={false}
        className="top-89"
        titleKey="pages.workspace.settingsHub.capabilities.cloudCodeExecution"
        descriptionKey="pages.workspace.settingsHub.capabilities.cloudCodeExecutionDescription"
      />
      <SettingsDivider className="top-103.5" />
      <ReadonlySwitchRow
        checked={false}
        className="top-107.5"
        titleKey="pages.workspace.settingsHub.capabilities.networkEgress"
        descriptionKey="pages.workspace.settingsHub.capabilities.networkEgressDescription"
      />
      <SettingsDivider className="top-122" />
      <div className="absolute top-127 left-8.5 flex h-52 w-218 flex-col gap-3 rounded-[14px] border border-border bg-muted/45 p-5">
        <div className="flex h-9.5 items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.capabilities.domainAllowlist",
              )}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.capabilities.domainAllowlistDescription",
              )}
            </p>
          </div>
          <ReadonlySelectValue
            id="settings-domain-allowlist"
            className="w-62"
            value={resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.capabilities.packageManagersOnly",
            )}
          />
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-background/70 px-4 py-3.5 text-xs text-muted-foreground">
          <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.capabilities.domainAllowlistNotice",
            )}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-medium" htmlFor="settings-domain-input">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.capabilities.additionalAllowedDomains",
            )}
          </label>
          <div className="flex h-9 gap-3">
            <Input
              id="settings-domain-input"
              className="h-9 flex-1 text-[13px]"
              disabled
              placeholder={resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.capabilities.domainInputPlaceholder",
              )}
            />
            <Button className="h-9 w-20 text-[13px]" disabled>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.capabilities.addDomain",
              )}
            </Button>
          </div>
        </div>
      </div>
    </SettingsPanelCanvas>
  );
}

function SettingsSectionHeading({
  children,
  top,
}: {
  children: ReactNode;
  top: string;
}) {
  return (
    <h2 className={`absolute left-8.5 text-lg font-semibold ${top}`}>
      {children}
    </h2>
  );
}

function SettingsControlRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`absolute left-8.5 flex h-9.5 w-218 items-center justify-between gap-4 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function SettingsDivider({ className }: { className?: string }) {
  return (
    <Separator
      className={`absolute left-8.5 w-218 bg-border/70 ${className ?? ""}`}
    />
  );
}
