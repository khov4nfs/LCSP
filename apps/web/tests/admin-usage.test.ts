import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  MODEL_ATTEMPT_STATUSES,
  adminUsageQuerySchema,
  billingLlmUsageReportSchema,
} from "@lcsp/contracts/billing";
import { GET } from "../src/app/api/admin/usage/route.ts";
import {
  adminUsageFiltersSchema,
  toUsageQuery,
} from "../src/features/admin/schemas/admin-usage.schema.ts";
import { DEFAULT_USAGE_FILTERS } from "../src/features/admin/config/admin-usage.config.ts";
import { ADMIN_NAV_ITEMS } from "../src/features/admin/config/admin-sidebar.config.ts";
import { getAdminRouteRedirectPath } from "../src/admin-route-middleware.ts";

test("usage BFF denies unauthenticated access before any upstream call", async () => {
  const response = await GET(
    new NextRequest("http://localhost/api/admin/usage"),
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).ok, false);
});
test("usage period/filter validation is bounded and date fields produce UTC boundaries", () => {
  assert.equal(
    adminUsageQuerySchema.safeParse({ from: "2020-01-01T00:00:00Z" }).success,
    false,
  );
  assert.equal(
    adminUsageQuerySchema.safeParse({ attemptStatus: "bogus" }).success,
    false,
  );
  assert.equal(
    adminUsageFiltersSchema.safeParse(DEFAULT_USAGE_FILTERS).success,
    true,
  );
  assert.deepEqual(
    toUsageQuery({
      ...DEFAULT_USAGE_FILTERS,
      from: "2026-10-01",
      to: "2026-10-22",
      provider: " APX ",
    }),
    {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-22T23:59:59.999Z",
      provider: "APX",
    },
  );
});
test("preparation usage scope resolves ownership on the API and cannot claim another scope", () => {
  const usage = {
    preparationRunId: "run",
    runId: "run",
    invocationId: "physical",
    agentRole: "claim-author",
    provider: "APX",
    model: "claude-sonnet-4-6-free",
    attemptStatus: MODEL_ATTEMPT_STATUSES.OUTCOME_UNKNOWN,
    occurredAt: "2026-10-22T16:00:00Z",
  };
  assert.equal(billingLlmUsageReportSchema.safeParse(usage).success, true);
  assert.equal(
    billingLlmUsageReportSchema.safeParse({ ...usage, runId: "different" })
      .success,
    false,
  );
  assert.equal(
    billingLlmUsageReportSchema.safeParse({ ...usage, assessmentId: "other" })
      .success,
    false,
  );
  assert.equal(
    billingLlmUsageReportSchema.safeParse({
      ...usage,
      failureClass: "secret raw message",
    }).success,
    false,
  );
});
test("usage navigation follows existing Admin role boundary", () => {
  assert.ok(ADMIN_NAV_ITEMS.some((x) => x.href === "/admin/usage"));
  assert.equal(
    getAdminRouteRedirectPath({
      pathname: "/admin/usage",
      search: "",
      hasSession: true,
      userRole: AUTH_USER_ROLES.customer,
    }),
    "/workspace",
  );
  assert.equal(
    getAdminRouteRedirectPath({
      pathname: "/admin/usage",
      search: "",
      hasSession: true,
      userRole: AUTH_USER_ROLES.admin,
    }),
    null,
  );
});
