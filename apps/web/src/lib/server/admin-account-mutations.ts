import type { NextRequest } from "next/server";
import { requireSessionToken } from "./session-token";
import { upstreamJson, upstreamRequest } from "./upstream-request";

export const ADMIN_ACCOUNT_MUTATION_PATHS = {
  suspend: "suspend",
  restore: "restore",
} as const;
type MutationPath =
  (typeof ADMIN_ACCOUNT_MUTATION_PATHS)[keyof typeof ADMIN_ACCOUNT_MUTATION_PATHS];

/** Proxy only: the API owns lifecycle, version and idempotency validation. */
export async function proxyAdminAccountMutation(
  request: NextRequest,
  id: string,
  operation: MutationPath,
) {
  return proxyAdminAccountWrite(
    request,
    `/admin/users/${encodeURIComponent(id)}/${operation}`,
  );
}
export async function proxyAdminAccountInvite(request: NextRequest) {
  return proxyAdminAccountWrite(request, "/admin/users");
}
async function proxyAdminAccountWrite(request: NextRequest, path: string) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  for (const name of ["idempotency-key", "x-correlation-id"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const body: unknown = await request.json().catch(() => null);
  return upstreamJson(
    await upstreamRequest(path, {
      method: "POST",
      bearerToken: session.token,
      headers,
      body: JSON.stringify(body),
    }),
  );
}
