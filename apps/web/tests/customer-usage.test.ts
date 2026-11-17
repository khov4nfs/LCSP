import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  customerUsageAnalyticsSchema,
  customerUsageQuerySchema,
  MODEL_ATTEMPT_STATUSES,
  BILLING_ERROR_CODES,
  quoteCustomerUsage,
  CUSTOMER_USAGE_PRICING,
} from "@lcsp/contracts/billing";
import { GET } from "../src/app/api/billing/usage/route.ts";
import {
  customerUsagePeriod,
  formatUsageCount,
} from "../src/features/billing/utils/customer-usage.ts";
import {
  customerUsageFiltersSchema,
  toCustomerUsageQuery,
} from "../src/features/billing/schemas/customer-usage.schema.ts";
import {
  getCustomerUsage,
  isCustomerUsageForbidden,
} from "../src/lib/api/customer-usage-client.ts";
import { problemEnvelope } from "../src/lib/api/problem-envelope.ts";
import { apiQueryKeys } from "../src/lib/api/query-keys.ts";

test("LCSP pricing applies 1.8 exactly, preserves incomplete evidence and rejects invalid costs", () => {
  for (const [cost, expected] of [
    ["0", "0"],
    ["1", "1.8"],
    ["0.001", "0.0018"],
    ["0.000000000000000001", "0.0000000000000000018"],
    ["9007199254740993", "16212958658533787.4"],
  ]) {
    const price = quoteCustomerUsage(cost, cost);
    assert.equal(price.multiplier, CUSTOMER_USAGE_PRICING.multiplier);
    assert.equal(price.knownSubtotalUsd, expected);
    assert.equal(price.estimatedTotalUsd, expected);
  }
  assert.equal(quoteCustomerUsage("1", null).estimatedTotalUsd, null);
  assert.equal(quoteCustomerUsage("1", null).knownSubtotalUsd, "1.8");
  for (const cost of ["-1", "NaN", "1e3", ""]) {
    assert.throws(() => quoteCustomerUsage(cost, cost));
  }
});

const report = JSON.parse(
  await readFile(
    new URL("../src/public/assets/mocks/customer-usage.json", import.meta.url),
    "utf8",
  ),
);
const period = customerUsagePeriod(30, new Date("2026-11-18T12:00:00Z"));
const request = (query = "", authenticated = true) =>
  new NextRequest(`http://localhost/api/billing/usage?${query}`, {
    headers: authenticated
      ? { cookie: "lcsp_session=customer-test-session" }
      : {},
  });

test("customer query rejects owner/internal filters and invalid bounded pagination/periods", () => {
  for (const extra of [
    { userId: "other" },
    { runId: "other" },
    { assessmentId: "other" },
    { page: 0 },
    { pageSize: 101 },
    { attemptStatus: "invalid" },
    { provider: "x".repeat(201) },
    { from: "2026-12-01T00:00:00Z" },
  ]) {
    assert.equal(
      customerUsageQuerySchema.safeParse({ ...period, ...extra }).success,
      false,
    );
  }
  assert.equal(
    customerUsageQuerySchema.safeParse({
      ...period,
      from: "2020-01-01T00:00:00Z",
    }).success,
    false,
  );
  assert.equal(customerUsageQuerySchema.safeParse({}).success, true);
});

test("UTC periods and form projections share inclusive bounds and restart pagination", () => {
  assert.equal(period.from, "2026-10-20T00:00:00.000Z");
  assert.equal(period.to, "2026-11-18T23:59:59.999Z");
  assert.doesNotThrow(() =>
    customerUsagePeriod(90, new Date("2026-11-18T12:00:00Z")),
  );
  const filters = {
    from: "2026-11-01",
    to: "2026-11-18",
    provider: " provider-a ",
    model: "",
    attemptStatus: MODEL_ATTEMPT_STATUSES.FAILED,
  };
  assert.equal(customerUsageFiltersSchema.safeParse(filters).success, true);
  assert.equal(
    customerUsageFiltersSchema.safeParse({ ...filters, to: "2026-10-01" })
      .success,
    false,
  );
  assert.deepEqual(toCustomerUsageQuery(filters), {
    from: "2026-11-01T00:00:00.000Z",
    to: "2026-11-18T23:59:59.999Z",
    provider: "provider-a",
    model: undefined,
    attemptStatus: MODEL_ATTEMPT_STATUSES.FAILED,
    page: 1,
    pageSize: 25,
  });
});

test("public projection preserves unknown tokens and strips internal receipt and pricing fields", () => {
  const contaminated = structuredClone(report);
  contaminated.items[0].failureClass = "internal-error";
  contaminated.items[0].runId = "internal-run";
  contaminated.items[0].referenceCost.evidenceSha256 = "internal-hash";
  const result = customerUsageAnalyticsSchema.parse(contaminated);
  assert.equal(result.items[0].tokens.totalTokens, "9007199254740993");
  assert.equal(result.items[1].tokens.totalTokens, null);
  assert.equal(result.summary.estimatedCostUsd, null);
  assert.equal("failureClass" in result.items[0], false);
  assert.equal("runId" in result.items[0], false);
  assert.equal("evidenceSha256" in result.items[0].referenceCost!, false);
  assert.equal(
    formatUsageCount("9007199254740993", "en"),
    "9,007,199,254,740,993",
  );
});

test("BFF rejects unauthenticated and owner-selectable reads before upstream fetch", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected fetch");
  });
  assert.equal((await GET(request("", false))).status, 401);
  const rejected = await GET(request("userId=other"));
  assert.equal(rejected.status, 400);
  assert.equal(
    (await rejected.json()).problem.code,
    BILLING_ERROR_CODES.validationFailed,
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("BFF forwards authenticated customer query and strips unexpected response metadata", async (t) => {
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer customer-test-session",
      );
      return Response.json({
        ok: true,
        data: { ...report, internal: "not public" },
      });
    },
  );
  const response = await GET(
    request(
      new URLSearchParams({ ...period, page: "2", pageSize: "25" } as Record<
        string,
        string
      >).toString(),
    ),
  );
  assert.equal(response.status, 200);
  assert.equal("internal" in (await response.json()).data, false);
  assert.match(String(fetch.mock.calls[0].arguments[0]), /\/billing\/usage\?/);
  assert.doesNotMatch(String(fetch.mock.calls[0].arguments[0]), /userId/);
});

test("BFF preserves role/auth problems and rejects malformed analytics success", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json(problemEnvelope(AUTH_ERROR_CODES.rbacDenied, 403), {
      status: 403,
    }),
  );
  const forbidden = await GET(request());
  assert.equal(forbidden.status, 403);
  assert.equal(
    (await forbidden.json()).problem.code,
    AUTH_ERROR_CODES.rbacDenied,
  );
  fetch.mock.mockImplementation(async () =>
    Response.json({ ok: true, data: { items: [] } }),
  );
  assert.equal((await GET(request())).status, 502);
});

test("browser loader retains API errors and separates filter/page cache keys", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(problemEnvelope(AUTH_ERROR_CODES.rbacDenied, 403), {
      status: 403,
    }),
  );
  await assert.rejects(getCustomerUsage(period), {
    problemCode: AUTH_ERROR_CODES.rbacDenied,
  });
  await getCustomerUsage(period).catch((error: unknown) => {
    assert.equal(isCustomerUsageForbidden(error), true);
  });
  assert.equal(isCustomerUsageForbidden(new Error("network failure")), false);
  assert.notDeepEqual(
    apiQueryKeys.billing.usage(period),
    apiQueryKeys.billing.usage({ ...period, page: 2 }),
  );
  assert.notDeepEqual(
    apiQueryKeys.billing.usage(period),
    apiQueryKeys.billing.usage({ ...period, provider: "other" }),
  );
});
