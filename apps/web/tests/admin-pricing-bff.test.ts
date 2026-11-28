import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_ERROR_CODES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  PRICING_ASSIGNMENT_STATUSES,
  adminModelPricingOverviewResponseSchema,
} from "@lcsp/contracts/billing";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";

import * as routeModule from "../src/app/api/admin/billing/model-pricing/route.ts";
import {
  getAdminRouteRedirectPath,
  isAdminPath,
} from "../src/admin-route-middleware.ts";
import { ADMIN_NAV_ITEMS } from "../src/features/admin/config/admin-sidebar.config.ts";
import { apiQueryKeys } from "../src/lib/api/query-keys.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

const mockFixturePath = new URL(
  "../src/public/assets/mocks/admin-model-pricing.json",
  import.meta.url,
);

function createAuthedRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=e2e-admin-session-token`,
      ...headers,
    },
  });
}

test("model pricing BFF exports only GET handler (strictly read-only)", () => {
  const mod = routeModule as Record<string, unknown>;
  assert.equal(typeof mod.GET, "function");
  assert.equal(mod.POST, undefined);
  assert.equal(mod.PATCH, undefined);
  assert.equal(mod.PUT, undefined);
  assert.equal(mod.DELETE, undefined);
});

test("model pricing BFF denies unauthenticated requests with 401 before calling fetch", async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called without a session");
  });

  const response = await routeModule.GET(
    new NextRequest("http://localhost/api/admin/billing/model-pricing"),
  );
  const body = (await response.json()) as {
    ok: boolean;
    problem?: { code: string; status: number };
  };

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.problem?.code, AUTH_ERROR_CODES.sessionInvalid);
  assert.equal(body.problem?.status, 401);
  assert.equal(fetchCalls, 0);
});

test("model pricing BFF rejects invalid query params with 400 BILLING_VALIDATION_FAILED", async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called on invalid query params");
  });

  const invalidUrls = [
    "http://localhost/api/admin/billing/model-pricing?scope=BOGUS",
    "http://localhost/api/admin/billing/model-pricing?status=UNKNOWN",
    "http://localhost/api/admin/billing/model-pricing?activeAt=2026-11-26",
    "http://localhost/api/admin/billing/model-pricing?unexpected=1",
  ];

  for (const url of invalidUrls) {
    const response = await routeModule.GET(
      createAuthedRequest(url, { "x-correlation-id": "corr-invalid-query" }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      problem?: { code: string; status: number; correlationId?: string };
    };
    assert.equal(response.status, 400, `Expected 400 for ${url}`);
    assert.equal(body.ok, false);
    assert.equal(body.problem?.code, BILLING_ERROR_CODES.validationFailed);
    assert.equal(body.problem?.status, 400);
    assert.equal(body.problem?.correlationId, "corr-invalid-query");
  }

  assert.equal(fetchCalls, 0);
});

test("model pricing BFF forwards x-correlation-id, bearer token, normalized query params, and validates response", async (t) => {
  const fixtureRaw = JSON.parse(await readFile(mockFixturePath, "utf8")) as unknown;
  const captured: { url: string; auth: string | null; correlationId: string | null }[] = [];

  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      captured.push({
        url: String(input),
        auth: headers.get("authorization"),
        correlationId: headers.get("x-correlation-id"),
      });
      return Response.json({ ok: true, data: fixtureRaw }, { status: 200 });
    },
  );

  const response = await routeModule.GET(
    createAuthedRequest(
      `http://localhost/api/admin/billing/model-pricing?provider=anthropic&resolvedModel=&scope=${MODEL_PRICING_SCOPES.exactModel}&status=${PRICING_ASSIGNMENT_STATUSES.active}`,
      { "x-correlation-id": "corr-forward-123" },
    ),
  );
  const body = (await response.json()) as { ok: boolean; data?: unknown };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(
    adminModelPricingOverviewResponseSchema.safeParse(body.data).success,
    true,
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.auth, "Bearer e2e-admin-session-token");
  assert.equal(captured[0]?.correlationId, "corr-forward-123");

  const upstreamUrl = new URL(captured[0]!.url);
  assert.equal(upstreamUrl.pathname, "/admin/billing/model-pricing");
  assert.equal(upstreamUrl.searchParams.get("provider"), "anthropic");
  assert.equal(upstreamUrl.searchParams.has("resolvedModel"), false);
  assert.equal(
    upstreamUrl.searchParams.get("scope"),
    MODEL_PRICING_SCOPES.exactModel,
  );
  assert.equal(
    upstreamUrl.searchParams.get("status"),
    PRICING_ASSIGNMENT_STATUSES.active,
  );
});

test("model pricing BFF returns 502 when upstream emits debitMode ON or extra uncontracted fields", async (t) => {
  const fixtureRaw = JSON.parse(await readFile(mockFixturePath, "utf8")) as Record<
    string,
    unknown
  >;

  t.mock.method(globalThis, "fetch", async () => {
    return Response.json(
      {
        ok: true,
        data: { ...fixtureRaw, debitMode: MODEL_USAGE_DEBIT_MODES.ON },
      },
      { status: 200 },
    );
  });

  const debitOnResponse = await routeModule.GET(
    createAuthedRequest("http://localhost/api/admin/billing/model-pricing"),
  );
  const debitOnBody = (await debitOnResponse.json()) as {
    ok: boolean;
    problem?: { code: string; status: number };
  };
  assert.equal(debitOnResponse.status, 502);
  assert.equal(debitOnBody.ok, false);
  assert.equal(
    debitOnBody.problem?.code,
    SHARED_ERROR_CODES.upstreamResponseInvalid,
  );

  t.mock.method(globalThis, "fetch", async () => {
    return Response.json(
      {
        ok: true,
        data: { ...fixtureRaw, uncontractedExtraField: "invalid" },
      },
      { status: 200 },
    );
  });

  const extraFieldResponse = await routeModule.GET(
    createAuthedRequest("http://localhost/api/admin/billing/model-pricing"),
  );
  const extraFieldBody = (await extraFieldResponse.json()) as {
    ok: boolean;
    problem?: { code: string; status: number };
  };
  assert.equal(extraFieldResponse.status, 502);
  assert.equal(extraFieldBody.ok, false);
  assert.equal(
    extraFieldBody.problem?.code,
    SHARED_ERROR_CODES.upstreamResponseInvalid,
  );
});

test("model pricing BFF supports MOCK_MODE=true with schema-valid admin-model-pricing.json and query filters", async (t) => {
  const originalMockMode = process.env.MOCK_MODE;
  const originalCwd = process.cwd();
  t.after(() => {
    if (originalMockMode === undefined) delete process.env.MOCK_MODE;
    else process.env.MOCK_MODE = originalMockMode;
    process.chdir(originalCwd);
  });

  const webRoot = path.resolve(path.dirname(mockFixturePath.pathname), "../../../..");
  process.chdir(webRoot);
  process.env.MOCK_MODE = "true";

  const response = await routeModule.GET(
    createAuthedRequest("http://localhost/api/admin/billing/model-pricing"),
  );
  const body = (await response.json()) as { ok: boolean; data?: unknown };
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);

  const parsed = adminModelPricingOverviewResponseSchema.safeParse(body.data);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  assert.equal(parsed.data.debitMode, MODEL_USAGE_DEBIT_MODES.OFF);
  assert.ok(
    parsed.data.coverage.some(
      (row) => row.fallbackSource === MODEL_PRICING_SCOPES.exactModel,
    ),
  );
  assert.ok(
    parsed.data.coverage.some(
      (row) => row.fallbackSource === MODEL_PRICING_SCOPES.providerDefault,
    ),
  );
  assert.ok(
    parsed.data.coverage.some(
      (row) => row.fallbackSource === MODEL_PRICING_SCOPES.globalDefault,
    ),
  );
  assert.ok(parsed.data.coverage.some((row) => row.hasCoverage === false));
  assert.ok(
    parsed.data.assignments.some(
      (item) => item.status === PRICING_ASSIGNMENT_STATUSES.active,
    ),
  );
  assert.ok(
    parsed.data.assignments.some(
      (item) => item.status === PRICING_ASSIGNMENT_STATUSES.scheduled,
    ),
  );
  assert.ok(
    parsed.data.assignments.some(
      (item) => item.status === PRICING_ASSIGNMENT_STATUSES.superseded,
    ),
  );
  assert.ok(parsed.data.drafts.length > 0);
  assert.ok(parsed.data.snapshots.length > 0);

  const filteredResponse = await routeModule.GET(
    createAuthedRequest(
      "http://localhost/api/admin/billing/model-pricing?provider=nonexistent-provider",
    ),
  );
  const filteredBody = (await filteredResponse.json()) as {
    ok: boolean;
    data?: { coverage: unknown[]; assignments: unknown[] };
  };
  assert.equal(filteredResponse.status, 200);
  assert.equal(filteredBody.data?.coverage.length, 0);
  assert.equal(filteredBody.data?.assignments.length, 0);
});

test("admin-route-middleware and sidebar protect and expose /admin/pricing", () => {
  assert.equal(isAdminPath("/admin/pricing"), true);
  assert.equal(
    getAdminRouteRedirectPath({
      pathname: "/admin/pricing",
      search: "",
      hasSession: false,
    }),
    "/sign-in?next=%2Fadmin%2Fpricing",
  );
  assert.equal(
    getAdminRouteRedirectPath({
      pathname: "/admin/pricing",
      search: "",
      hasSession: true,
      userRole: AUTH_USER_ROLES.customer,
    }),
    "/workspace",
  );
  assert.equal(
    getAdminRouteRedirectPath({
      pathname: "/admin/pricing",
      search: "",
      hasSession: true,
      userRole: AUTH_USER_ROLES.admin,
    }),
    null,
  );
  assert.ok(ADMIN_NAV_ITEMS.some((item) => item.href === "/admin/pricing"));
});

test("@lcsp/i18n resolves distinct EN and VI strings for sidebar navPricing and admin.pricing", () => {
  const enNav = resolveMessage("en", "pages.admin.sidebar.navPricing" as never);
  const viNav = resolveMessage("vi", "pages.admin.sidebar.navPricing" as never);
  const enTitle = resolveMessage("en", "pages.admin.pricing.title" as never);
  const viTitle = resolveMessage("vi", "pages.admin.pricing.title" as never);

  assert.ok(typeof enNav === "string" && enNav.trim().length > 0);
  assert.ok(typeof viNav === "string" && viNav.trim().length > 0);
  assert.notEqual(enNav, viNav);

  assert.ok(typeof enTitle === "string" && enTitle.trim().length > 0);
  assert.ok(typeof viTitle === "string" && viTitle.trim().length > 0);
  assert.notEqual(enTitle, viTitle);
});

test("apiQueryKeys.admin.modelPricing produces filter-scoped cache key tuple", () => {
  const fn = (
    apiQueryKeys.admin as unknown as {
      modelPricing?: (params: Record<string, unknown>) => readonly unknown[];
    }
  ).modelPricing;
  assert.equal(typeof fn, "function");
  const key = fn!({ provider: "anthropic" });
  assert.deepEqual(key, ["admin", "billing", "model-pricing", { provider: "anthropic" }]);
});
