import {
  REPOSITORY_AUTHENTICATION_MODES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import { NextRequest } from "next/server";

import { isMockModeEnabled } from "@/lib/server/fixtures/response";
import { successJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  if (isMockModeEnabled()) {
    return successJson({
      repositories: [
        {
          id: "repo-connection-1",
          authentication_mode: REPOSITORY_AUTHENTICATION_MODES.githubApp,
          installation_id: "mock-install-123",
          repository_name: "lcsp-platform",
          repository_full_name: "khovan123/LCSP",
          default_branch: "main",
          status: REPOSITORY_CONNECTION_STATUSES.active,
          connected_at: new Date("2026-07-28T09:00:00.000Z").toISOString(),
          revoked_at: null,
          assessment_id: "assessment-1",
          assessment_name: "LCSP workspace rollout",
        },
      ],
    });
  }

  const upstream = await upstreamRequest("/auth/repositories", {
    bearerToken: session.token,
  });
  return validatedUpstreamJson(upstream, sanitizeRepositoriesPayload);
}

function sanitizeRepositoriesPayload(data: unknown) {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const repositories = (data as { repositories?: unknown }).repositories;
  if (!Array.isArray(repositories)) {
    return null;
  }

  return repositories.every((repository) => {
    if (typeof repository !== "object" || repository === null) {
      return false;
    }

    const candidate = repository as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      Object.values(REPOSITORY_AUTHENTICATION_MODES).includes(
        candidate.authentication_mode as (typeof REPOSITORY_AUTHENTICATION_MODES)[keyof typeof REPOSITORY_AUTHENTICATION_MODES],
      ) &&
      (typeof candidate.installation_id === "string" ||
        candidate.installation_id === null) &&
      typeof candidate.repository_name === "string" &&
      typeof candidate.repository_full_name === "string" &&
      typeof candidate.default_branch === "string" &&
      typeof candidate.status === "string" &&
      typeof candidate.connected_at === "string" &&
      (typeof candidate.revoked_at === "string" ||
        candidate.revoked_at === null) &&
      (typeof candidate.assessment_id === "string" ||
        candidate.assessment_id === null) &&
      (typeof candidate.assessment_name === "string" ||
        candidate.assessment_name === null)
    );
  })
    ? { repositories }
    : null;
}
