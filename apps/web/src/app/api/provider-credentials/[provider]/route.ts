import type { NextRequest } from "next/server";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

const PROVIDERS: readonly string[] = Object.values(CREDENTIAL_PROVIDERS);

/**
 * Business purpose: Forward a customer's provider disconnect to the backend, which owns ownership and reauthentication policy.
 * Business rules:
 * - Only known providers are forwarded and the session bearer token is the only identity sent.
 * Execution flow:
 * 1. Require a session token, then validate the provider path segment against the contract values.
 * 2. Send the DELETE upstream and return its envelope unchanged.
 * Failure cases:
 * - Missing sessions return the shared unauthorized response; unknown providers return 400 before any upstream call.
 * - Upstream problems, including reauthentication challenges, are forwarded unchanged.
 * Side effects:
 * - Triggers backend credential destruction; no request body, secret or response data is logged here.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const { provider } = await context.params;
  if (!PROVIDERS.includes(provider)) return new Response(null, { status: 400 });

  return upstreamJson(
    await upstreamRequest(
      `/provider-credentials/${encodeURIComponent(provider)}`,
      { method: "DELETE", bearerToken: session.token },
    ),
  );
}
