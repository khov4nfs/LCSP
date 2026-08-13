import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment/codes";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { SCAN_ERROR_CODES } from "@lcsp/contracts/scan/codes";
import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildResolveConflictApiBody,
  resolveConflict,
  sanitizeConflictListPayload,
  sanitizeResolveConflictPayload,
  toConflictListOutcome,
  toResolveConflictOutcome,
} from "../src/lib/api/conflict-client.ts";

function problem(code: string, status: number) {
  return {
    ok: false,
    problem: {
      type: `test/${code.toLowerCase().replaceAll("_", "-")}`,
      status,
      code,
      titleKey: "auth.errors.validationFailed.title",
      detailKey: "auth.errors.validationFailed.detail",
      requiredAction: "none",
      correlationId: "test-correlation",
    },
  };
}

test("conflict list payload sanitizer accepts valid shape", () => {
  const payload = {
    conflicts: [
      {
        conflict_id: "c1",
        conflict_type: "scope_mismatch",
        conflict_score: 0.9,
        score_explanation: "Scope differs",
        status: "PENDING",
        evidence_refs: ["e1", "e2"],
        created_at: "2026-07-22T10:00:00Z",
      },
    ],
    total: 1,
    page: 1,
    page_size: 20,
    correlationId: "corr-1",
  };

  assert.deepEqual(sanitizeConflictListPayload(payload), payload);
});

test("conflict list outcome maps 403 to access_revoked", () => {
  assert.deepEqual(
    toConflictListOutcome(
      problem(AUTH_ERROR_CODES.pbacDenied, 403),
      false,
      403,
    ),
    { kind: "access_revoked" },
  );
});

test("conflict list outcome maps MFA-required to MFA redirect", () => {
  assert.deepEqual(
    toConflictListOutcome(
      problem(AUTH_ERROR_CODES.mfaRequired, 401),
      false,
      401,
    ),
    { kind: "redirect", location: "/mfa/verify" },
  );
});

test("conflict list outcome maps unauthenticated to sign-in redirect", () => {
  assert.deepEqual(
    toConflictListOutcome(
      problem(AUTH_ERROR_CODES.sessionInvalid, 401),
      false,
      401,
    ),
    { kind: "redirect", location: "/sign-in" },
  );
});

test("conflict list outcome maps assessment not found to empty", () => {
  assert.deepEqual(
    toConflictListOutcome(
      problem(ASSESSMENT_ERROR_CODES.notFound, 404),
      false,
      404,
    ),
    { kind: "empty" },
  );
});

test("conflict list outcome maps zero pending conflicts to empty", () => {
  assert.deepEqual(
    toConflictListOutcome(
      {
        conflicts: [],
        total: 0,
        page: 1,
        page_size: 20,
      },
      true,
      200,
    ),
    { kind: "empty" },
  );
});

test("resolve payload sanitizer accepts valid shape", () => {
  const payload = {
    conflict_id: "c1",
    status: "DISMISSED",
    resolved_at: "2026-07-22T10:10:00Z",
    all_conflicts_resolved: true,
    correlationId: "corr-2",
  } as const;

  assert.deepEqual(sanitizeResolveConflictPayload(payload), payload);
});

test("resolve outcome maps 409 conflict-already-resolved", () => {
  assert.deepEqual(
    toResolveConflictOutcome(
      problem(SCAN_ERROR_CODES.conflictAlreadyResolved, 409),
      false,
      409,
    ),
    { kind: "already_resolved" },
  );
});

test("resolve outcome maps PBAC denial to access_revoked", () => {
  assert.deepEqual(
    toResolveConflictOutcome(
      problem(AUTH_ERROR_CODES.pbacDenied, 403),
      false,
      403,
    ),
    { kind: "access_revoked" },
  );
});

test("resolve conflict blocks dismissed without reason before network call", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({}, { status: 500 });
  };

  try {
    const outcome = await resolveConflict("a-1", "c-1", {
      resolution: "DISMISSED",
      resolution_note: "  ",
    });

    assert.deepEqual(outcome, {
      kind: "validation_error",
      reason: "dismiss_reason_required",
    });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolve api body builder defaults safely", () => {
  assert.deepEqual(buildResolveConflictApiBody({}), {
    resolution: "RESOLVED",
    resolution_note: undefined,
  });
});

test("resolve api body builder preserves dismissed reason", () => {
  assert.deepEqual(
    buildResolveConflictApiBody({
      resolution: "DISMISSED",
      resolution_note: "Needs manual review",
    }),
    {
      resolution: "DISMISSED",
      resolution_note: "Needs manual review",
    },
  );
});
