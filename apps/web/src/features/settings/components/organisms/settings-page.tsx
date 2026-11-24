"use client";
import { AccountSettingsPanel } from "./account-settings-panel";

import { LOCALES, type Locale } from "@lcsp/contracts/shared";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { resolveMessage } from "@lcsp/i18n";
import { ChevronDownIcon, InfoIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { ConfirmAccessDialog } from "@/components/organisms/confirm-access-dialog";
import { CONFIRM_ACCESS_METHODS } from "@/components/types/confirm-access-dialog.types";
import { ThemePreferenceControl } from "@/components/molecules/theme-preference-control";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
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
import {
  useAuthSessionsQuery,
  useAuthSettingsProfileQuery,
} from "@/lib/api/auth-queries";
import {
  reauthenticateWithPassword,
  verifyMfaOtp,
} from "@/lib/api/auth-client";
import { useProviderCredentialStatusesQuery } from "@/lib/api/github-repository-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import { BillingSettingsPanel } from "@/features/billing/components/organisms/billing-settings-panel";
import { CustomerUsageSettingsPanel } from "@/features/billing/components/organisms/customer-usage-settings-panel";
import type { MfaVerifyFormValues } from "@/features/auth/schemas/mfa-verify.schema";

import { RepositoriesSettingsSection } from "./repositories-settings-section";
import { ProfileSettingsSection } from "./profile-settings-section";
import { PrivacySettingsPanel } from "./privacy-settings-panel";
import { SettingsSidebar } from "./settings-sidebar";
import { SETTINGS_SECTION_IDS } from "../../types/settings.types";
import type { SettingsSectionId } from "../../types/settings.types";
import type {
  SettingsAlertMessage,
  SettingsPageProps,
  SettingsSensitiveAction,
} from "../../types/settings-page.types";
import type { ProfileSettingsSectionProps } from "../../types/profile-settings.types";
import {
  SETTINGS_PRESENTATIONS,
  SETTINGS_SENSITIVE_ACTIONS,
} from "../../config/settings-page.config";
import { normalizeSettingsSection } from "../../utils/settings-page.utils";

export function SettingsPage({
  activeSection: controlledActiveSection,
  onSectionChange,
  presentation = SETTINGS_PRESENTATIONS.page,
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
  const providerCredentialStatusesQuery = useProviderCredentialStatusesQuery();
  const oauthLinkParam = searchParams.get("oauth_link");

  const [confirmAccessOpen, setConfirmAccessOpen] = useState(false);
  const [pendingSensitiveAction, setPendingSensitiveAction] =
    useState<SettingsSensitiveAction | null>(null);
  // Observe dismissal synchronously when an already-submitted proof resolves later.
  const activeSensitiveAction = useRef<SettingsSensitiveAction | null>(null);
  const [confirmAccessMfaError, setConfirmAccessMfaError] =
    useState<SettingsAlertMessage | null>(null);
  const [confirmAccessPasswordError, setConfirmAccessPasswordError] =
    useState<SettingsAlertMessage | null>(null);

  const profile = profileQuery.data;

  function openSensitiveAction(action: SettingsSensitiveAction) {
    activeSensitiveAction.current?.resolveResult?.(false);
    activeSensitiveAction.current = action;
    setConfirmAccessMfaError(null);
    setConfirmAccessPasswordError(null);
    setPendingSensitiveAction(action);
    setConfirmAccessOpen(true);
  }

  function closeConfirmAccessDialog(cancelled = true) {
    const action = activeSensitiveAction.current;
    activeSensitiveAction.current = null;
    if (cancelled) {
      action?.resolveResult?.(false);
    }
    setConfirmAccessOpen(false);
    setPendingSensitiveAction(null);
    setConfirmAccessMfaError(null);
    setConfirmAccessPasswordError(null);
  }

  /**
   * Business purpose: Resume the pending Settings action after access has been confirmed.
   * Business rules:
   * - Settings challenges release the waiting caller, which owns the pending profile or session mutation.
   * - Provider credentials retain their existing authenticated retry path.
   * Execution flow:
   * 1. Match the pending action and execute it or release its waiting caller.
   * Failure cases:
   * - Unrecognized actions fail closed without authorizing the waiting caller.
   * Side effects:
   * - May retry credential work or release a Settings reauthentication challenge.
   */
  function executeSensitiveAction(action: SettingsSensitiveAction): boolean {
    switch (action.kind) {
      case SETTINGS_SENSITIVE_ACTIONS.reauthenticateSettings:
        return true;
      case SETTINGS_SENSITIVE_ACTIONS.reauthenticateProviderCredential:
        action.retry();
        return true;
      default:
        return false;
    }
  }

  /**
   * Business purpose: Verify the password for the active Settings action.
   * Business rules: A dismissed or replaced challenge cannot authorize a write.
   * Execution flow:
   * 1. Verify the password, check that the challenge is still current, and resume the action.
   * Failure cases: Invalid proof or expired access stays in the current challenge.
   * Side effects: May resume a protected Settings operation.
   */
  async function handleConfirmAccessPasswordSubmit(values: {
    password: string;
  }) {
    const action = activeSensitiveAction.current;
    if (!action) {
      return;
    }

    setConfirmAccessPasswordError(null);
    // Submit proof directly so neither passwords nor OTPs become query-cache variables.
    const outcome = await reauthenticateWithPassword(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.signIn.errors.requestFailedTitle" as const,
      detailKey: "pages.signIn.errors.requestFailedDetail" as const,
    }));

    // A verification response belongs only to the challenge that submitted it.
    if (activeSensitiveAction.current !== action) return;
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

    const success = executeSensitiveAction(action);
    action.resolveResult?.(success);
    closeConfirmAccessDialog(false);
  }

  /**
   * Business purpose: Verify an authenticator code for the active Settings action.
   * Business rules: The same challenge must still be active after verification and refresh.
   * Execution flow:
   * 1. Verify the code and refresh account access before unlocking the action.
   * Failure cases: Dismissed or unsuccessful challenges cannot resume a write.
   * Side effects: Refreshes account queries and may resume a protected Settings operation.
   */
  async function handleConfirmAccessOtpSubmit(values: MfaVerifyFormValues) {
    const action = activeSensitiveAction.current;
    if (!action) return;
    setConfirmAccessMfaError(null);
    const outcome = await verifyMfaOtp(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.mfaVerify.errors.requestFailedTitle" as const,
      detailKey: "pages.mfaVerify.errors.requestFailedDetail" as const,
    }));

    if (activeSensitiveAction.current !== action) return;
    if (outcome.kind === API_OUTCOME_KINDS.verified) {
      await Promise.all([profileQuery.refetch(), sessionsQuery.refetch()]);
      if (activeSensitiveAction.current !== action) return;

      const success = executeSensitiveAction(action);
      action.resolveResult?.(success);
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

  /**
   * Business purpose: Obtain explicit access confirmation before a sensitive Settings mutation.
   * Business rules:
   * - Reuse password/MFA verification; cancellation resolves false and cannot authorize a mutation.
   * Execution flow:
   * 1. Open the shared access dialog and wait for its confirmed or canceled outcome.
   * Failure cases:
   * - Failed verification keeps the dialog open; dismissal releases the caller without authorization.
   * Side effects:
   * - Opens the access dialog and stores the pending completion callback in Settings state.
   */
  function requestSettingsReauthentication(
    mfaRequired: boolean,
  ): Promise<boolean> {
    return new Promise((resolveResult) =>
      openSensitiveAction({
        kind: SETTINGS_SENSITIVE_ACTIONS.reauthenticateSettings,
        mfaRequired,
        resolveResult,
      }),
    );
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
        presentation === SETTINGS_PRESENTATIONS.modal
          ? "flex h-full min-h-0 flex-col overflow-hidden text-foreground md:flex-row"
          : "flex flex-1 flex-col px-4 py-6 text-foreground lg:px-6"
      }
      data-component="SettingsPage"
      data-presentation={presentation}
      data-locale={settingsLocale}
    >
      <div
        className={
          presentation === SETTINGS_PRESENTATIONS.modal
            ? "flex min-h-0 flex-1 flex-col md:flex-row"
            : "mx-auto flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm md:min-h-205 md:flex-row"
        }
      >
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        />
        <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0">
            {profile ? (
              <ConfirmAccessDialog
                initialMethod={
                  pendingSensitiveAction?.kind ===
                    SETTINGS_SENSITIVE_ACTIONS.reauthenticateSettings &&
                  pendingSensitiveAction.mfaRequired
                    ? CONFIRM_ACCESS_METHODS.otp
                    : CONFIRM_ACCESS_METHODS.password
                }
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
              <GeneralSettingsPanel
                onReauthenticate={requestSettingsReauthentication}
              />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.account ? (
              <AccountSettingsPanel
                locale={settingsLocale}
                onReauthenticate={requestSettingsReauthentication}
                oauthLinkResult={oauthLinkParam}
              />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.privacy ? (
              <PrivacySettingsPanel locale={settingsLocale} />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.billing ? (
              <BillingSettingsPanel locale={settingsLocale} />
            ) : null}

            {activeSection === SETTINGS_SECTION_IDS.usage ? (
              <CustomerUsageSettingsPanel
                locale={settingsLocale}
                onOpenBilling={() =>
                  handleSectionChange(SETTINGS_SECTION_IDS.billing)
                }
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
                isLoading={providerCredentialStatusesQuery.isPending}
                loadFailed={providerCredentialStatusesQuery.isError}
                onRetry={() => void providerCredentialStatusesQuery.refetch()}
                onReauthenticate={(retry, onCancel) =>
                  openSensitiveAction({
                    kind: SETTINGS_SENSITIVE_ACTIONS.reauthenticateProviderCredential,
                    retry,
                    resolveResult: (confirmed) => {
                      if (!confirmed) onCancel?.();
                    },
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
  onReauthenticate,
}: ProfileSettingsSectionProps) {
  return (
    <section
      className="h-full min-h-0 space-y-6 overflow-y-auto px-4 py-8 md:px-8"
      data-component="GeneralSettingsPanel"
    >
      <ProfileSettingsSection onReauthenticate={onReauthenticate} />
      <Separator />
      <section
        className="space-y-5"
        aria-labelledby="settings-preferences-heading"
      >
        <h2 id="settings-preferences-heading" className="text-lg font-semibold">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.general.preferencesTitle",
          )}
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.general.appearance",
            )}
          </span>
          <ThemePreferenceControl variant="compact" />
        </div>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="text-sm" htmlFor="settings-language">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.general.language",
            )}
          </label>
          <SettingsLanguageSelect />
        </div>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-3">
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
        </div>
      </section>
      <Separator />
      <section
        className="space-y-5"
        aria-labelledby="settings-notifications-heading"
      >
        <h2
          id="settings-notifications-heading"
          className="text-lg font-semibold"
        >
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.general.notificationsTitle",
          )}
        </h2>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.general.assessmentCompletions",
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.general.assessmentCompletionsDescription",
              )}
            </p>
          </div>
          <Switch
            checked
            disabled
            aria-label={resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.general.assessmentCompletions",
            )}
          />
        </div>
        <Separator />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.general.remediationApprovals",
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.general.remediationApprovalsDescription",
              )}
            </p>
          </div>
          <Switch
            checked
            disabled
            aria-label={resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.general.remediationApprovals",
            )}
          />
        </div>
      </section>
    </section>
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
            <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="w-65 rounded-xl border-border bg-popover p-1.75 shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
        data-component="SettingsLanguageSelectContent"
      >
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={handleLocaleChange}
        >
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

function CapabilitiesSettingsPanel() {
  return (
    <SettingsPanelCanvas dataComponent="CapabilitiesSettingsPanel">
      <SettingsSectionHeading top="top-10">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.sections.general",
        )}
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
          <label
            className="text-[13px] font-medium"
            htmlFor="settings-domain-input"
          >
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
