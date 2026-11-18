"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useHydrated } from "@/components/hooks/use-hydrated";
import { Separator } from "@/components/ui/separator";
import { useAuthSettingsProfileQuery } from "@/lib/api/auth-queries";
import { AccountEmailSection } from "./account-email-section";
import { AccountMfaSection } from "./account-mfa-section";
import { SessionSettingsSection } from "./session-settings-section";
import type { AccountSecurityProps } from "../../types/account-security.types";

export function AccountSettingsPanel(props: AccountSecurityProps) {
  const query = useAuthSettingsProfileQuery();
  const hydrated = useHydrated();
  const profile = hydrated ? query.data : undefined;
  return (
    <div
      data-component="AccountSettingsPanel"
      className="h-full space-y-6 overflow-y-auto p-4 sm:p-8"
    >
      {!hydrated || query.isPending ? (
        <p role="status">
          {resolveMessage(
            props.locale,
            "pages.workspace.settingsHub.accountSecurity.loading",
          )}
        </p>
      ) : null}
      {hydrated && query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {resolveMessage(
            props.locale,
            "pages.workspace.settingsHub.accountSecurity.loadFailed",
          )}
        </p>
      ) : null}
      {profile ? (
        <>
          <AccountEmailSection
            key={`email-${profile.user_id}`}
            profile={profile}
            readFailed={query.isError}
            readVersion={query.dataUpdatedAt}
            {...props}
          />
          <Separator />
          <AccountMfaSection
            key={`mfa-${profile.user_id}`}
            profile={profile}
            readFailed={query.isError}
            readVersion={query.dataUpdatedAt}
            {...props}
          />
          <Separator />
        </>
      ) : null}
      <SessionSettingsSection {...props} />
    </div>
  );
}
