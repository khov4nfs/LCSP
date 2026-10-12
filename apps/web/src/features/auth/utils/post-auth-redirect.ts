import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";

import { getAuthSettingsProfile } from "@/lib/api/auth-client";

export const POST_AUTH_REDIRECT_PATHS = {
  admin: "/admin",
  customer: "/workspace",
} as const;

export function postAuthRedirectPath(role: AuthUserRole) {
  return role === AUTH_USER_ROLES.admin
    ? POST_AUTH_REDIRECT_PATHS.admin
    : POST_AUTH_REDIRECT_PATHS.customer;
}

export async function resolvePostAuthRedirectPath(role?: AuthUserRole) {
  if (role) return postAuthRedirectPath(role);
  const profile = await getAuthSettingsProfile();
  return postAuthRedirectPath(profile.role);
}
