import type { AuthSettingsProfile } from "@/lib/api/auth-client";

export type AdminAccountIdentityModel = {
  displayName: string;
  email: string;
  role: AuthSettingsProfile["role"];
  avatarInitials: string;
};

export type AdminAccountIdentityProps = {
  identity: AdminAccountIdentityModel | null;
};
