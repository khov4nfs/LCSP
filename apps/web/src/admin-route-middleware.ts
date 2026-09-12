import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { PUBLIC_ENTRY_ROUTES } from "./auth-entry.ts";

export const ADMIN_ROOT_PATH = "/admin";
export const ADMIN_USERS_PATH = "/admin/users";

export const protectedAdminPathPrefixes = Object.freeze([
  ADMIN_ROOT_PATH,
]);

export function isAdminPath(pathname: string): boolean {
  return (
    pathname === ADMIN_ROOT_PATH ||
    pathname.startsWith(`${ADMIN_ROOT_PATH}/`)
  );
}

export function getAdminRouteRedirectPath({
  pathname,
  search,
  hasSession,
  userRole,
}: {
  pathname: string;
  search: string;
  hasSession: boolean;
  userRole?: string;
}): string | null {
  if (!isAdminPath(pathname)) {
    return null;
  }

  const nextPath = `${pathname}${search}`;

  if (!hasSession) {
    return `${PUBLIC_ENTRY_ROUTES.signIn}?next=${encodeURIComponent(nextPath)}`;
  }

  if (userRole !== undefined && userRole !== AUTH_USER_ROLES.admin) {
    return "/workspace";
  }

  // Valid admin user navigating to /admin landing or admin child routes
  return null;
}
