import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";

import { getAuthSettingsProfile } from "@/lib/api/auth-client";

export const POST_AUTH_REDIRECT_PATHS = {
  admin: "/admin",
  customer: "/workspace",
} as const;

/**
 * Business purpose: Send an authenticated person to the workspace allowed by their account role.
 *
 * Business rules:
 * - Administrators use the admin route; all other supported authenticated roles enter the customer workspace.
 *
 * Execution flow:
 * 1. Read the canonical Auth role returned by the server.
 * 2. Select the approved internal destination rather than using caller-provided URLs.
 *
 * Failure cases:
 * - No separate failure is emitted: a non-admin role uses the customer destination.
 *
 * Side effects:
 * - None: this pure function only selects a static internal path.
 */
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
