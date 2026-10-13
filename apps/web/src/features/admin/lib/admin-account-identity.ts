import type { AuthSettingsProfile } from "@/lib/api/auth-client";
import type { AdminAccountIdentityModel } from "../types/admin-account.types";

export function getAdminAccountIdentity(
  profile?: Pick<AuthSettingsProfile, "display_name" | "email" | "role">,
): AdminAccountIdentityModel | null {
  if (!profile) return null;
  const email = profile.email.trim();
  const displayName = profile.display_name?.trim() || email;
  return {
    displayName,
    email,
    role: profile.role,
    avatarInitials: Array.from(displayName)[0]?.toLocaleUpperCase() ?? "",
  };
}
