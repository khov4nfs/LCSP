import { PUBLIC_ENTRY_ROUTES } from "./auth-entry.ts";

export const protectedWorkspacePathPrefixes = Object.freeze([
  "/workspace",
  "/assessments",
  "/laws",
  "/developer/assessments",
]);

export function isProtectedWorkspacePath(pathname: string): boolean {
  return protectedWorkspacePathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function getWorkspaceRouteRedirectPath({
  pathname,
  search,
  hasSession,
}: {
  pathname: string;
  search: string;
  hasSession: boolean;
}): string | null {
  if (!isProtectedWorkspacePath(pathname) || hasSession) {
    return null;
  }

  const nextPath = `${pathname}${search}`;
  return `${PUBLIC_ENTRY_ROUTES.signIn}?next=${encodeURIComponent(nextPath)}`;
}
