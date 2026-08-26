import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES, WORKSPACE_ERROR_CODES } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";

import {
  isMockModeEnabled,
  readMockJson,
} from "@/lib/server/fixtures/response";
import type { MockWorkspace } from "@/lib/server/fixtures/workspace";
import { problemJson, successJson } from "@/lib/server/problem-json";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session/session-store";

export async function GET(request: NextRequest) {
  if (!isMockModeEnabled()) {
    return problemJson(SHARED_ERROR_CODES.notFound, { status: 404 });
  }

  const workspace = await readMockWorkspace();
  const selectedWorkspaceId = request.cookies.get(SESSION_COOKIE_NAME)?.value
    ? workspace.id
    : undefined;

  return successJson({
    workspaces: [workspace],
    selected_workspace_id: selectedWorkspaceId,
  });
}

export async function POST(request: NextRequest) {
  if (!isMockModeEnabled()) {
    return problemJson(SHARED_ERROR_CODES.notFound, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  const workspaceId = (body as { workspace_id?: unknown })?.workspace_id;
  if (typeof workspaceId !== "string") {
    return problemJson(AUTH_ERROR_CODES.validationFailed, { status: 400 });
  }

  const selectedWorkspace = await readMockWorkspace();
  if (selectedWorkspace.id !== workspaceId) {
    return problemJson(WORKSPACE_ERROR_CODES.notFound, { status: 404 });
  }

  const response = successJson({
    selected_workspace: selectedWorkspace,
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    "mock-session:manager",
    sessionCookieOptions,
  );
  return response;
}

async function readMockWorkspace(): Promise<MockWorkspace> {
  const payload = await readMockJson<{
    organization?: { id?: unknown; name?: unknown };
  }>("workspace.json");
  return {
    id:
      typeof payload.organization?.id === "string"
        ? payload.organization.id
        : "org-lcsp",
    name:
      typeof payload.organization?.name === "string"
        ? payload.organization.name
        : "LCSP",
  };
}
