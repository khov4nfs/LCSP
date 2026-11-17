import type { Locale } from "@lcsp/contracts/shared";
import type { AuthSessionSummary } from "@/lib/api/auth-client";

export type SessionSettingsSectionProps = {
  locale: Locale;
  onReauthenticate: (mfaRequired: boolean) => Promise<boolean>;
};

export type SessionSettingsRowProps = {
  session: AuthSessionSummary;
  locale: Locale;
  disabled: boolean;
  onRevoke: (sessionId: string) => void;
};
