import type { NextRequest } from "next/server";
import {
  AZURE_DEVOPS_CREDENTIAL_TYPES,
  BITBUCKET_CREDENTIAL_TYPES,
  CREDENTIAL_PROVIDERS,
} from "@lcsp/contracts/github-integration";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  return upstreamJson(
    await upstreamRequest("/provider-credentials", {
      bearerToken: session.token,
    }),
  );
}

export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return new Response(null, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isCredentialBody(body)) return new Response(null, { status: 400 });
  return upstreamJson(
    await upstreamRequest("/provider-credentials", {
      method: "POST",
      bearerToken: session.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Business purpose: Preserve the approved provider-specific credential contract across the authenticated BFF boundary.
 * Business rules:
 * - GitHub/GitLab accept their legacy string payload; Bitbucket/Azure require their exact typed discriminator and required identity fields.
 * - Optional expiry metadata must be parseable before the payload can reach the API.
 * Execution flow:
 * 1. Validate the envelope and optional expiry.
 * 2. Check only fields required by the selected provider.
 * 3. Allow the caller to forward the unchanged validated payload.
 * Failure cases:
 * - Unrecognized providers, type mismatches, missing typed fields, or invalid expiry are rejected before upstream access.
 * Side effects:
 * - Pure request validation; no credential is logged, stored, or transformed by this helper.
 */
function isCredentialBody(value: unknown): value is {
  provider: string;
  credential: unknown;
  credential_expires_at?: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (
    typeof body.credential_expires_at !== "undefined" &&
    (typeof body.credential_expires_at !== "string" ||
      !Number.isFinite(Date.parse(body.credential_expires_at)))
  ) return false;
  if (
    body.provider === CREDENTIAL_PROVIDERS.github ||
    body.provider === CREDENTIAL_PROVIDERS.gitlab
  ) {
    return typeof body.credential === "string";
  }
  if (body.provider === CREDENTIAL_PROVIDERS.bitbucket) {
    const credential = body.credential as Record<string, unknown> | null;
    return Boolean(
      credential &&
      typeof credential === "object" &&
      credential.type === BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken &&
      typeof credential.email === "string" &&
      typeof credential.apiToken === "string",
    );
  }
  if (body.provider === CREDENTIAL_PROVIDERS.azureDevOps) {
    const credential = body.credential as Record<string, unknown> | null;
    return Boolean(
      credential &&
      typeof credential === "object" &&
      credential.type === AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat &&
      typeof credential.organization === "string" &&
      typeof credential.pat === "string",
    );
  }
  return false;
}
