import {
  click,
  installFetch,
  render,
  settle,
} from "./support/dom.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MODEL_PRICING_SCOPES,
  adminModelPricingOverviewQuerySchema,
  formatMicrocreditsToDecimal,
  type AdminModelPricingOverviewResponse,
} from "@lcsp/contracts/billing";

import { setAppLocale } from "../src/lib/locale.ts";
import { AdminPricingPage } from "../src/features/admin/components/organisms/admin-pricing-page.tsx";
import {
  formatMicrocreditRate,
  sortCoverageByPrecedence,
} from "../src/features/admin/utils/admin-pricing-format.ts";
import {
  adminPricingFiltersSchema,
  toAdminPricingQuery,
} from "../src/features/admin/schemas/admin-pricing.schema.ts";
import { DEFAULT_ADMIN_PRICING_FILTERS } from "../src/features/admin/config/admin-pricing.config.ts";

const mockFixtureUrl = new URL(
  "../src/public/assets/mocks/admin-model-pricing.json",
  import.meta.url,
);

async function loadMockOverview(): Promise<AdminModelPricingOverviewResponse> {
  return JSON.parse(
    await readFile(mockFixtureUrl, "utf8"),
  ) as AdminModelPricingOverviewResponse;
}

function createTestQueryClient(t?: test.TestContext) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  t?.after(() => {
    client.clear();
  });
  return client;
}

test("formatMicrocreditRate and sortCoverageByPrecedence apply exact BigInt formatting and precedence order", () => {
  const formattedExact = formatMicrocreditRate("3000000", "en");
  assert.equal(formattedExact.microcreditsFormatted, "3,000,000");
  assert.equal(
    formattedExact.creditsDecimal,
    formatMicrocreditsToDecimal(BigInt("3000000")),
  );
  assert.equal(formattedExact.creditsDecimal, "3");

  const formattedFractional = formatMicrocreditRate("1500500", "en");
  assert.equal(formattedFractional.microcreditsFormatted, "1,500,500");
  assert.equal(formattedFractional.creditsDecimal, "1.5005");

  const sorted = sortCoverageByPrecedence([
    {
      provider: "openai",
      resolvedModel: "gpt-4o-mini",
      normalizedScopeKey: "EXACT_MODEL:openai:gpt-4o-mini",
      hasCoverage: false,
      resolvedScope: null,
      fallbackSource: null,
      assignmentId: null,
      snapshotId: null,
      snapshotVersion: null,
      effectiveFrom: null,
      effectiveTo: null,
      rates: null,
    },
    {
      provider: "anthropic",
      resolvedModel: "claude-haiku-4-5",
      normalizedScopeKey: "EXACT_MODEL:anthropic:claude-haiku-4-5",
      hasCoverage: true,
      resolvedScope: MODEL_PRICING_SCOPES.globalDefault,
      fallbackSource: MODEL_PRICING_SCOPES.globalDefault,
      assignmentId: "asg-global",
      snapshotId: "snap-global",
      snapshotVersion: 1,
      effectiveFrom: "2026-11-01T00:00:00.000Z",
      effectiveTo: null,
      rates: null,
    },
    {
      provider: "anthropic",
      resolvedModel: "claude-opus-4-1",
      normalizedScopeKey: "EXACT_MODEL:anthropic:claude-opus-4-1",
      hasCoverage: true,
      resolvedScope: MODEL_PRICING_SCOPES.providerDefault,
      fallbackSource: MODEL_PRICING_SCOPES.providerDefault,
      assignmentId: "asg-provider",
      snapshotId: "snap-provider",
      snapshotVersion: 1,
      effectiveFrom: "2026-11-01T00:00:00.000Z",
      effectiveTo: null,
      rates: null,
    },
    {
      provider: "anthropic",
      resolvedModel: "claude-sonnet-4-6",
      normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
      hasCoverage: true,
      resolvedScope: MODEL_PRICING_SCOPES.exactModel,
      fallbackSource: MODEL_PRICING_SCOPES.exactModel,
      assignmentId: "asg-exact",
      snapshotId: "snap-exact",
      snapshotVersion: 2,
      effectiveFrom: "2026-11-01T00:00:00.000Z",
      effectiveTo: null,
      rates: null,
    },
  ]);

  assert.deepEqual(
    sorted.map((row) => row.fallbackSource ?? "GAP"),
    [
      MODEL_PRICING_SCOPES.exactModel,
      MODEL_PRICING_SCOPES.providerDefault,
      MODEL_PRICING_SCOPES.globalDefault,
      "GAP",
    ],
  );
});

test("toAdminPricingQuery omits blank values and passes adminModelPricingOverviewQuerySchema", () => {
  assert.equal(
    adminPricingFiltersSchema.safeParse(DEFAULT_ADMIN_PRICING_FILTERS).success,
    true,
  );
  const query = toAdminPricingQuery({
    provider: " anthropic ",
    resolvedModel: "   ",
    scope: MODEL_PRICING_SCOPES.exactModel,
    status: "",
    coverageGapOnly: true,
  });
  assert.deepEqual(query, {
    provider: "anthropic",
    scope: MODEL_PRICING_SCOPES.exactModel,
  });
  assert.equal(adminModelPricingOverviewQuerySchema.safeParse(query).success, true);
});

test("AdminPricingPage renders posture banner, precedence coverage, assignments, drafts, snapshots, and zero mutation controls", async (t) => {
  setAppLocale("en");
  const mockOverview = await loadMockOverview();
  const { calls, restore } = installFetch({
    "GET /api/admin/billing/model-pricing": mockOverview,
  });

  try {
    const root = render(
      <QueryClientProvider client={createTestQueryClient(t)}>
        <AdminPricingPage />
      </QueryClientProvider>,
    );

    await settle();

    const text = root.textContent ?? "";
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "GET");

    // Posture banner + zero alert on healthy load
    assert.match(text, /MODEL_USAGE_DEBIT/);
    assert.match(text, /OFF/);
    assert.equal(root.querySelectorAll('[role="alert"]').length, 0);

    // Single polite live region
    const liveRegions = root.querySelectorAll('[aria-live="polite"]');
    assert.equal(liveRegions.length, 1);

    // Coverage precedence & gap
    assert.match(text, /Exact model/i);
    assert.match(text, /Provider default/i);
    assert.match(text, /Global default/i);
    assert.match(text, /Coverage gap/i);

    // Assignments (ACTIVE, SCHEDULED, SUPERSEDED)
    assert.match(text, /Active/i);
    assert.match(text, /Scheduled/i);
    assert.match(text, /Superseded/i);

    // Drafts & Snapshots
    assert.match(text, /Draft/i);
    assert.match(text, /Immutable/i);

    // Microcredits formatted as grouped integers + decimal credits
    assert.match(text, /3,000,000/);
    assert.match(text, /15,000,000/);

    // Semantic table accessibility
    const tables = root.querySelectorAll("table");
    assert.ok(tables.length >= 4);
    for (const table of tables) {
      assert.ok(table.querySelector("caption"), "Every table needs a caption");
      const headers = table.querySelectorAll("th[scope='col']");
      assert.ok(headers.length > 0, "Every table needs scope='col' headers");
    }
    const scrollRegions = root.querySelectorAll('[role="region"][tabindex="0"]');
    assert.ok(scrollRegions.length >= 4);

    // Strictly read-only: zero mutation controls
    const actionControls = [
      ...root.querySelectorAll("button, a"),
    ].map((el) => el.textContent?.trim() ?? "");
    for (const label of actionControls) {
      assert.doesNotMatch(
        label,
        /^(create|new tariff|edit|publish|supersede|delete|save|remove|tạo|chỉnh sửa|xuất bản|thay thế|xóa)/i,
        `Unexpected mutation control found: ${label}`,
      );
    }
  } finally {
    restore();
  }
});

test("AdminPricingPage opens read-only inspection Dialog for drafts with operationalAssumptions and immutable snapshots", async (t) => {
  setAppLocale("en");
  const mockOverview = await loadMockOverview();
  const { restore } = installFetch({
    "GET /api/admin/billing/model-pricing": mockOverview,
  });

  try {
    const root = render(
      <QueryClientProvider client={createTestQueryClient(t)}>
        <AdminPricingPage />
      </QueryClientProvider>,
    );

    await settle();

    const inspectButtons = Array.from(
      root.querySelectorAll('button[data-pricing-inspect]'),
    );
    assert.ok(
      inspectButtons.length >= 2,
      "Expected inspect buttons for pricing records",
    );

    const draftInspect = inspectButtons.find(
      (btn) => btn.getAttribute("data-pricing-inspect") === "DRAFT",
    );
    assert.ok(draftInspect, "Expected DRAFT inspect button");
    click(draftInspect);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();

    let dialog = document.body.querySelector('[role="dialog"]');
    assert.ok(dialog, "Expected Dialog to open for draft");
    assert.match(dialog.textContent ?? "", /Non-authoritative/i);
    assert.match(
      dialog.textContent ?? "",
      new RegExp(
        mockOverview.drafts[0]?.operationalAssumptions?.providerPriceSource ??
          "Anthropic",
      ),
    );

    const closeBtn = dialog.querySelector('[data-slot="dialog-close"]');
    click(closeBtn);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();

    const snapshotInspect = inspectButtons.find(
      (btn) => btn.getAttribute("data-pricing-inspect") === "SNAPSHOT",
    );
    assert.ok(snapshotInspect, "Expected SNAPSHOT inspect button");
    click(snapshotInspect);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();

    dialog = document.body.querySelector('[role="dialog"]');
    assert.ok(dialog, "Expected Dialog to open for snapshot");
    assert.match(
      dialog.textContent ?? "",
      new RegExp(mockOverview.snapshots[0]!.auditReason),
    );
    assert.match(
      dialog.textContent ?? "",
      new RegExp(mockOverview.snapshots[0]!.idempotencyKey),
    );
  } finally {
    restore();
  }
});

test("AdminPricingPage distinguishes filter-empty with Reset, empty system state, and 503 error alert", async (t) => {
  setAppLocale("en");
  const mockOverview = await loadMockOverview();
  const emptyOverview: AdminModelPricingOverviewResponse = {
    debitMode: "OFF",
    dbUtcNow: "2026-11-26T00:00:00.000Z",
    allowlistedModels: [],
    coverage: [],
    assignments: [],
    drafts: [],
    snapshots: [],
  };

  // 1. Filter-empty state with Reset button
  const { restore: restoreFilter } = installFetch({
    "GET /api/admin/billing/model-pricing": mockOverview,
  });

  try {
    const root = render(
      <QueryClientProvider client={createTestQueryClient(t)}>
        <AdminPricingPage />
      </QueryClientProvider>,
    );
    await settle();

    const providerInput = root.querySelector(
      'input[name="provider"]',
    ) as HTMLInputElement | null;
    assert.ok(providerInput, "Expected provider filter input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(providerInput, "nonexistent-provider");
      providerInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const applyButton = root.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement | null;
    click(applyButton);
    await settle();

    assert.match(
      root.textContent ?? "",
      /No records match the current filters/i,
    );
    const resetButton = Array.from(root.querySelectorAll("button")).find((b) =>
      /Reset/i.test(b.textContent ?? ""),
    );
    assert.ok(resetButton, "Expected Reset button on filter-empty state");
    click(resetButton);
    await settle();
    assert.match(root.textContent ?? "", /claude-sonnet-4-6/);
  } finally {
    restoreFilter();
  }

  // 2. Empty system state (no data at all)
  const { restore: restoreEmpty } = installFetch({
    "GET /api/admin/billing/model-pricing": emptyOverview,
  });
  try {
    const root = render(
      <QueryClientProvider client={createTestQueryClient(t)}>
        <AdminPricingPage />
      </QueryClientProvider>,
    );
    await settle();
    assert.match(root.textContent ?? "", /No coverage records/i);
    assert.match(root.textContent ?? "", /No tariff assignments/i);
  } finally {
    restoreEmpty();
  }

  // 3. Upstream 503 error -> role="alert" with zero fabricated numbers
  const { restore: restoreError } = installFetch({
    "GET /api/admin/billing/model-pricing": Response.json(
      {
        ok: false,
        problem: {
          type: "about:blank",
          status: 503,
          code: "UPSTREAM_UNAVAILABLE",
          titleKey: "problems.requestFailed.title",
          detailKey: "problems.requestFailed.detail",
          requiredAction: null,
          correlationId: "corr-503",
          meta: {},
        },
      },
      { status: 503 },
    ),
  });
  try {
    const root = render(
      <QueryClientProvider client={createTestQueryClient(t)}>
        <AdminPricingPage />
      </QueryClientProvider>,
    );
    await settle();
    const alert = root.querySelector('[role="alert"]');
    assert.ok(alert, "Expected role='alert' on upstream 503 failure");
    assert.doesNotMatch(root.textContent ?? "", /3,000,000/);
    assert.doesNotMatch(root.textContent ?? "", /claude-sonnet-4-6/);
    assert.ok(
      Array.from(root.querySelectorAll("button")).some((b) =>
        /Retry/i.test(b.textContent ?? ""),
      ),
    );
  } finally {
    restoreError();
  }
});

test("AdminPricingPage renders localized Vietnamese copy when locale is vi", async (t) => {
  setAppLocale("vi");
  const mockOverview = await loadMockOverview();
  const { restore } = installFetch({
    "GET /api/admin/billing/model-pricing": mockOverview,
  });

  try {
    const root = render(
      <QueryClientProvider client={createTestQueryClient(t)}>
        <AdminPricingPage />
      </QueryClientProvider>,
    );
    await settle();
    const text = root.textContent ?? "";
    assert.match(text, /Bảng giá mô hình/);
    assert.match(text, /Chỉ đọc/);
  } finally {
    act(() => {
      setAppLocale("en");
    });
    restore();
  }
});
