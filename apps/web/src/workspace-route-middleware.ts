import { PUBLIC_ENTRY_ROUTES } from "./auth-entry.ts";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { ADMIN_ROOT_PATH } from "./admin-route-middleware.ts";

export const protectedWorkspacePathPrefixes = Object.freeze([
  "/workspace",
  "/assessments",
  "/laws",
]);


export function isProtectedWorkspacePath(pathname: string): boolean {
  return protectedWorkspacePathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Business purpose:
 * Keep unauthenticated users and authenticated administrators outside customer workspace routes.
 *
 * Business rules:
 * - Protected customer routes require a session.
 * - ADMIN uses the Admin Portal and must not render customer assessment clients or content surfaces.
 *
 * Execution flow:
 * 1. Ignore public/non-workspace paths.
 * 2. Redirect an authenticated ADMIN to the Admin Portal.
 * 3. Redirect a missing session to sign-in while preserving the requested path.
 *
 * Failure cases:
 * - An unavailable role before profile verification does not guess authorization; the post-verification proxy call decides it.
 *
 * Side effects:
 * - Pure route decision; no session, assessment or navigation state is mutated.
 */
export function getWorkspaceRouteRedirectPath({
  pathname,
  search,
  hasSession,
  userRole,
}: {
  pathname: string;
  search: string;
  hasSession: boolean;
  userRole?: AuthUserRole;
}): string | null {
  if (!isProtectedWorkspacePath(pathname)) {
    return null;
  }

  // Role routing is evaluated only after the server has verified the active session profile.
  if (hasSession && userRole === AUTH_USER_ROLES.admin) return ADMIN_ROOT_PATH;
  if (hasSession) return null;

  const nextPath = `${pathname}${search}`;
  return `${PUBLIC_ENTRY_ROUTES.signIn}?next=${encodeURIComponent(nextPath)}`;
}
