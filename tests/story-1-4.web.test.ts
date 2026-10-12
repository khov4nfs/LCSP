import { test } from "node:test";
import * as assert from "node:assert/strict";

import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { PUBLIC_ENTRY_ROUTES } from "@lcsp/web/auth-entry";
import {
  canCreateAssessment,
  toAssessmentsOutcome,
  toWorkspaceOutcome,
  WORKSPACE_ROUTES,
  getWorkspaceNavigationUrl,
  isWorkspaceNavigationItemActive,
  parseWorkspaceNavigationTarget,
} from "@lcsp/web";

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

test("workspace role projection shows create assessment only for customer role", () => {
  assert.equal(canCreateAssessment(AUTH_USER_ROLES.customer), true);
  assert.equal(canCreateAssessment(AUTH_USER_ROLES.admin), false);
});

test("workspace redirects auth and mfa failures to safe routes", () => {
  assert.deepEqual(
    toWorkspaceOutcome(
      problem(AUTH_ERROR_CODES.authRequired, 401),
      false,
      401,
    ),
    { kind: "redirect", location: PUBLIC_ENTRY_ROUTES.signIn },
  );

  assert.deepEqual(
    toWorkspaceOutcome(
      problem(AUTH_ERROR_CODES.mfaRequired, 403),
      false,
      403,
    ),
    { kind: "redirect", location: WORKSPACE_ROUTES.mfaVerify },
  );
});

test("workspace outcome normalizes the role-only flat API contract", () => {
  assert.deepEqual(
    toWorkspaceOutcome(
      {
        user_id: "user-1",
        display_name: "Acme Manager",
        role: AUTH_USER_ROLES.customer,
      },
      true,
      200,
    ),
    {
      kind: "loaded",
      workspace: {
        user: {
          id: "user-1",
          display_name: "Acme Manager",
          role: AUTH_USER_ROLES.customer,
        },
      },
    },
  );
});

test("assessment list outcome accepts only canonical list payloads", () => {
  const item = {
    assessment_id: "11111111-1111-4111-8111-111111111111",
    name: "EU AI Act readiness",
    lifecycle: {
      state: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
      assessmentRevision: 1,
    },
    runtime: null,
    created_at: "2026-07-12T01:00:00.000Z",
    updated_at: "2026-07-12T01:00:00.000Z",
  };
  assert.deepEqual(
    toAssessmentsOutcome(
      {
        assessments: [item],
        total: 1,
        page: 1,
        page_size: 20,
        correlationId: "c-1",
      },
      true,
    ),
    {
      kind: "loaded",
      assessments: [
        {
          id: item.assessment_id,
          name: item.name,
          lifecycle: item.lifecycle,
          runtime: null,
          created_at: item.created_at,
        },
      ],
    },
  );

  assert.deepEqual(toAssessmentsOutcome({}, true), {
    kind: "error",
    detailKey: "pages.workspace.errors.assessmentsUnavailableDetail",
    titleKey: "pages.workspace.errors.assessmentsUnavailableTitle",
  });
});

test("workspace sidebar navigation active state uses pathname and hash", () => {
  assert.equal(
    isWorkspaceNavigationItemActive({
      currentPathname: "/workspace",
      currentHash: "",
      href: "/workspace",
    }),
    true,
  );
  assert.equal(
    isWorkspaceNavigationItemActive({
      currentPathname: "/workspace",
      currentHash: "#assessments",
      href: "/workspace",
    }),
    false,
  );
  assert.equal(
    isWorkspaceNavigationItemActive({
      currentPathname: "/workspace",
      currentHash: "#assessments",
      href: "/workspace#assessments",
    }),
    true,
  );
});

test("workspace sidebar navigation keeps same-page targets as client-side urls", () => {
  assert.deepEqual(parseWorkspaceNavigationTarget("/workspace#assessments"), {
    pathname: "/workspace",
    hash: "#assessments",
  });
  assert.equal(getWorkspaceNavigationUrl("/workspace"), "/workspace");
  assert.equal(
    getWorkspaceNavigationUrl("/workspace#documents"),
    "/workspace#documents",
  );
});
