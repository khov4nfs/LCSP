import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { API_OUTCOME_KINDS } from "../src/lib/api/outcome-kinds.ts";
import { toWorkspaceOutcome } from "../src/lib/api/workspace-client.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("workspace BFF route requests upstream /auth/profile instead of deleted /workspace", async () => {
  const source = await read("../src/app/api/workspace/route.ts");
  assert.equal(source.includes('upstreamRequest("/auth/profile"'), true);
  assert.equal(source.includes('upstreamRequest("/workspace"'), false);
});

test("toWorkspaceOutcome normalizes profile with display_name null using email fallback", () => {
  const payload = {
    user_id: "user-123",
    email: "user@example.com",
    display_name: null,
    role: AUTH_USER_ROLES.customer,
  };

  const outcome = toWorkspaceOutcome(payload, true, 200);
  assert.equal(outcome.kind, API_OUTCOME_KINDS.loaded);
  if (outcome.kind === API_OUTCOME_KINDS.loaded) {
    assert.equal(outcome.workspace.user.id, "user-123");
    assert.equal(outcome.workspace.user.display_name, "user@example.com");
    assert.equal(outcome.workspace.user.role, AUTH_USER_ROLES.customer);
  }
});

test("toWorkspaceOutcome preserves explicit display_name when present", () => {
  const payload = {
    user_id: "user-456",
    email: "custom@example.com",
    display_name: "Alice Engineer",
    role: AUTH_USER_ROLES.customer,
  };

  const outcome = toWorkspaceOutcome(payload, true, 200);
  assert.equal(outcome.kind, API_OUTCOME_KINDS.loaded);
  if (outcome.kind === API_OUTCOME_KINDS.loaded) {
    assert.equal(outcome.workspace.user.id, "user-456");
    assert.equal(outcome.workspace.user.display_name, "Alice Engineer");
    assert.equal(outcome.workspace.user.role, AUTH_USER_ROLES.customer);
  }
});

test("toWorkspaceOutcome redirects to sign-in on 401 or sessionInvalid problem", () => {
  const outcome401 = toWorkspaceOutcome(null, false, 401);
  assert.equal(outcome401.kind, API_OUTCOME_KINDS.redirect);
  if (outcome401.kind === API_OUTCOME_KINDS.redirect) {
    assert.equal(outcome401.location, "/sign-in");
  }

  const outcomeProblem = toWorkspaceOutcome(
    { ok: false, problem: { code: AUTH_ERROR_CODES.sessionInvalid } },
    false,
    401,
    AUTH_ERROR_CODES.sessionInvalid,
  );
  assert.equal(outcomeProblem.kind, API_OUTCOME_KINDS.redirect);
  if (outcomeProblem.kind === API_OUTCOME_KINDS.redirect) {
    assert.equal(outcomeProblem.location, "/sign-in");
  }
});

test("toWorkspaceOutcome redirects to MFA verify when mfaRequired problem occurs", () => {
  const outcome = toWorkspaceOutcome(
    { ok: false, problem: { code: AUTH_ERROR_CODES.mfaRequired } },
    false,
    403,
    AUTH_ERROR_CODES.mfaRequired,
  );
  assert.equal(outcome.kind, API_OUTCOME_KINDS.redirect);
  if (outcome.kind === API_OUTCOME_KINDS.redirect) {
    assert.equal(outcome.location, "/mfa/verify");
  }
});
