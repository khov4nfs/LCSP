import type { AuthSettingsProfile } from "@/lib/api/auth-client";

export type ProfileSettingsSectionProps = {
  onReauthenticate: (mfaRequired: boolean) => Promise<boolean>;
};

export type ProfileSettingsEditorProps = ProfileSettingsSectionProps & {
  profile: AuthSettingsProfile;
};
