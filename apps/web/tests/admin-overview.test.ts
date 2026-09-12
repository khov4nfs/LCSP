import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import type { MessageKey } from "@lcsp/i18n";
import {
  ADMIN_OVERVIEW_ACTION_KEYS,
  ADMIN_OVERVIEW_PERIODS,
  type AdminOverviewPeriod,
  type AdminOverviewStats,
} from "@lcsp/contracts/auth";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const testWindow = dom.window;
for (const name of [
  "window",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "MutationObserver",
  "getComputedStyle",
] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? testWindow : testWindow[name],
  });
}
for (const name of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: testWindow[name].bind(testWindow),
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
Object.defineProperty(testWindow, "matchMedia", {
  configurable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
});

const { createRoot } = await import("react-dom/client");
const { resolveAppMessage } = await import("../src/lib/i18n.ts");
const { AdminPeriodSelector } = await import(
  "../src/features/admin/components/molecules/admin-period-selector.tsx"
);
const { AdminOverviewMetricCard } = await import(
  "../src/features/admin/components/atoms/admin-overview-metric-card.tsx"
);
const { AdminAssessmentActivityCard } = await import(
  "../src/features/admin/components/molecules/admin-assessment-activity-card.tsx"
);
const { AdminUserStatusCard } = await import(
  "../src/features/admin/components/molecules/admin-user-status-card.tsx"
);
const { AdminRecentActivityCard } = await import(
  "../src/features/admin/components/molecules/admin-recent-activity-card.tsx"
);
const { AdminCorpusStatusCard } = await import(
  "../src/features/admin/components/molecules/admin-corpus-status-card.tsx"
);

const fixtureData: AdminOverviewStats = {
  period: ADMIN_OVERVIEW_PERIODS.p30d,
  periodDays: 30,
  summary: {
    totalUsers: { count: 876, periodChange: 38 },
    activeUsers: { count: 842, percentageOfTotal: 96.1 },
    assessments: { totalCount: 2417, periodCompletedCount: 312 },
    currentCorpus: { version: "v2026.08.31", sourceCount: 184, ruleCount: null },
  },
  assessmentActivity: {
    points: [
      { date: "2026-08-20", timestamp: "2026-08-20T00:00:00.000Z", startedCount: 12, completedCount: 10 },
      { date: "2026-09-02", timestamp: "2026-09-02T00:00:00.000Z", startedCount: 24, completedCount: 18 },
    ],
    totalStarted: 36,
    totalCompleted: 312,
    startDate: "2026-08-20T00:00:00.000Z",
    endDate: "2026-09-02T00:00:00.000Z",
  },
  accountDistribution: {
    activeCount: 842,
    invitedCount: 64,
    suspendedCount: 34,
    deactivatedCount: 0,
    totalCount: 940,
  },
  recentActivity: [
    {
      id: "evt-1",
      eventType: "AUTH_ADMIN_USER_SUSPENDED",
      actionKey: ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount,
      occurredAt: "2026-09-11T10:24:00.000Z",
      adminEmail: "admin@example.com",
      adminName: "Admin",
      target: "linh@example.com",
    },
    {
      id: "evt-2",
      eventType: "CORPUS_VERSION_ACTIVATED",
      actionKey: ADMIN_OVERVIEW_ACTION_KEYS.publishedCorpus,
      occurredAt: "2026-09-11T09:05:00.000Z",
      adminEmail: "admin@example.com",
      adminName: "Admin",
      target: "v2026.08.31",
    },
  ],
  corpusStatus: {
    current: {
      version: "v2026.08.31",
      sourceCount: 184,
      ruleCount: null,
      publishedAt: "2026-08-31T00:00:00.000Z",
    },
    draft: {
      version: "v2026.09.02-draft",
      sourceCount: 188,
      ruleCount: null,
      createdAt: "2026-09-02T00:00:00.000Z",
    },
  },
};

function renderComponent(element: React.ReactElement) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(StrictMode, null, element));
  });
  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test("AdminPeriodSelector renders selected period and opens dropdown menu on click", () => {
  let selected: AdminOverviewPeriod = ADMIN_OVERVIEW_PERIODS.p30d;
  const { container, cleanup } = renderComponent(
    createElement(AdminPeriodSelector, {
      selectedPeriod: selected,
      onSelectPeriod: (p) => {
        selected = p;
      },
    }),
  );

  const button = container.querySelector("button");
  assert.ok(button);
  const expectedP30Label = resolveAppMessage(
    "pages.admin.overview.periods.p30d" as MessageKey,
  );
  assert.equal(button.textContent?.trim(), expectedP30Label);

  // Click to open
  act(() => {
    button.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
  });

  const options = container.querySelectorAll("[role='option']");
  assert.equal(options.length, 3);

  // Select 7 days
  act(() => {
    options[0].dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
  });

  assert.equal(selected, ADMIN_OVERVIEW_PERIODS.p7d);
  cleanup();
});

test("AdminPeriodSelector supports full keyboard navigation (ArrowDown, ArrowUp, Enter, Escape)", () => {
  let selected: AdminOverviewPeriod = ADMIN_OVERVIEW_PERIODS.p30d;
  const { container, cleanup } = renderComponent(
    createElement(AdminPeriodSelector, {
      selectedPeriod: selected,
      onSelectPeriod: (p) => {
        selected = p;
      },
    }),
  );

  const trigger = container.querySelector("button");
  assert.ok(trigger);

  // Open with ArrowDown
  act(() => {
    trigger.dispatchEvent(
      new testWindow.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });

  let listbox = container.querySelector("[role='listbox']");
  assert.ok(listbox);

  // Test Escape closes listbox
  act(() => {
    listbox?.dispatchEvent(
      new testWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.equal(container.querySelector("[role='listbox']"), null);

  // Re-open with ArrowUp
  act(() => {
    trigger.dispatchEvent(
      new testWindow.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
  });
  listbox = container.querySelector("[role='listbox']");
  assert.ok(listbox);

  // Navigate with ArrowDown
  act(() => {
    listbox?.dispatchEvent(
      new testWindow.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });

  // Select with Enter
  act(() => {
    listbox?.dispatchEvent(
      new testWindow.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });

  assert.equal(selected, ADMIN_OVERVIEW_PERIODS.p90d);
  cleanup();
});

test("AdminOverviewMetricCard renders label, value, subtitle and handles unavailable state gracefully", () => {
  const { container, cleanup } = renderComponent(
    createElement(AdminOverviewMetricCard, {
      label: "Total users",
      value: 876,
      subtitle: "+38 in the last 30 days",
    }),
  );

  assert.match(container.textContent ?? "", /Total users/);
  assert.match(container.textContent ?? "", /876/);
  assert.match(container.textContent ?? "", /\+38 in the last 30 days/);
  cleanup();

  // Test null / unavailable value rendering dash
  const { container: containerNull, cleanup: cleanupNull } = renderComponent(
    createElement(AdminOverviewMetricCard, {
      label: "Total users",
      value: null,
      subtitle: "—",
    }),
  );

  assert.match(containerNull.textContent ?? "", /—/);
  cleanupNull();
});

test("AdminAssessmentActivityCard renders points, completion count and labels", () => {
  const { container, cleanup } = renderComponent(
    createElement(AdminAssessmentActivityCard, {
      points: fixtureData.assessmentActivity.points,
      totalCompleted: fixtureData.assessmentActivity.totalCompleted,
      periodDays: 30,
      startDate: fixtureData.assessmentActivity.startDate,
      endDate: fixtureData.assessmentActivity.endDate,
    }),
  );

  const title = resolveAppMessage(
    "pages.admin.overview.assessmentActivity.title" as MessageKey,
  );
  const completedLabel = resolveAppMessage(
    "pages.admin.overview.assessmentActivity.completed" as MessageKey,
  );

  assert.match(container.textContent ?? "", new RegExp(title, "i"));
  assert.match(container.textContent ?? "", /312/);
  assert.match(container.textContent ?? "", new RegExp(completedLabel, "i"));
  assert.match(container.textContent ?? "", /08\/20/);
  assert.match(container.textContent ?? "", /09\/02/);
  cleanup();
});

test("AdminUserStatusCard renders status rows and total count accurately", () => {
  const { container, cleanup } = renderComponent(
    createElement(AdminUserStatusCard, {
      distribution: fixtureData.accountDistribution,
    }),
  );

  const title = resolveAppMessage(
    "pages.admin.overview.accountStatus.title" as MessageKey,
  );
  const activeLabel = resolveAppMessage(
    "pages.admin.overview.accountStatus.active" as MessageKey,
  );
  const invitedLabel = resolveAppMessage(
    "pages.admin.overview.accountStatus.invited" as MessageKey,
  );
  const suspendedLabel = resolveAppMessage(
    "pages.admin.overview.accountStatus.suspended" as MessageKey,
  );

  assert.match(container.textContent ?? "", new RegExp(title, "i"));
  assert.match(container.textContent ?? "", new RegExp(activeLabel, "i"));
  assert.match(container.textContent ?? "", /842/);
  assert.match(container.textContent ?? "", new RegExp(invitedLabel, "i"));
  assert.match(container.textContent ?? "", /64/);
  assert.match(container.textContent ?? "", new RegExp(suspendedLabel, "i"));
  assert.match(container.textContent ?? "", /34/);
  assert.match(container.textContent ?? "", /940/);
  cleanup();
});

test("AdminRecentActivityCard renders audit-safe table rows with localized actions", () => {
  const { container, cleanup } = renderComponent(
    createElement(AdminRecentActivityCard, {
      items: fixtureData.recentActivity,
    }),
  );

  const title = resolveAppMessage(
    "pages.admin.overview.recentActivity.title" as MessageKey,
  );
  const suspendedAction = resolveAppMessage(
    "pages.admin.overview.recentActivity.actions.suspendedAccount" as MessageKey,
  );

  assert.match(container.textContent ?? "", new RegExp(title, "i"));
  assert.match(container.textContent ?? "", new RegExp(suspendedAction, "i"));
  assert.match(container.textContent ?? "", /admin@example\.com/);
  assert.match(container.textContent ?? "", /linh@example\.com/);
  assert.match(container.textContent ?? "", /v2026\.08\.31/);
  cleanup();

  // Test fallback localized target and system actor when email/target are null
  const systemActorLabel = resolveAppMessage(
    "pages.admin.overview.recentActivity.systemActor" as MessageKey,
  );
  const fallbackTargetLabel = resolveAppMessage(
    "pages.admin.overview.recentActivity.targets.userAccount" as MessageKey,
  );
  const { container: fallbackContainer, cleanup: fallbackCleanup } = renderComponent(
    createElement(AdminRecentActivityCard, {
      items: [
        {
          id: "evt-null",
          eventType: "AUTH_ADMIN_USER_SUSPENDED",
          actionKey: ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount,
          occurredAt: "2026-09-11T10:24:00.000Z",
          adminEmail: null,
          adminName: null,
          target: null,
        },
      ],
    }),
  );
  assert.match(fallbackContainer.textContent ?? "", new RegExp(systemActorLabel, "i"));
  assert.match(fallbackContainer.textContent ?? "", new RegExp(fallbackTargetLabel, "i"));
  fallbackCleanup();
});

test("AdminCorpusStatusCard renders CURRENT and DRAFT corpus boxes with null rule counts preserved as dash", () => {
  const { container, cleanup } = renderComponent(
    createElement(AdminCorpusStatusCard, {
      corpusStatus: fixtureData.corpusStatus,
    }),
  );

  const title = resolveAppMessage(
    "pages.admin.overview.corpusStatus.title" as MessageKey,
  );
  const currentBadge = resolveAppMessage(
    "pages.admin.overview.corpusStatus.currentLabel" as MessageKey,
  );
  const draftBadge = resolveAppMessage(
    "pages.admin.overview.corpusStatus.draftLabel" as MessageKey,
  );

  assert.match(container.textContent ?? "", new RegExp(title, "i"));
  assert.match(container.textContent ?? "", new RegExp(currentBadge, "i"));
  assert.match(container.textContent ?? "", /v2026\.08\.31/);
  assert.match(container.textContent ?? "", /184/);
  assert.match(container.textContent ?? "", /—/); // Rule count is null -> renders as —
  assert.match(container.textContent ?? "", new RegExp(draftBadge, "i"));
  assert.match(container.textContent ?? "", /v2026\.09\.02-draft/);
  cleanup();

  // Test missing / error corpusStatus renders dash instead of claiming authoritative absence
  const noPublishedLabel = resolveAppMessage(
    "pages.admin.overview.corpusStatus.noPublished" as MessageKey,
  );
  const { container: missingContainer, cleanup: missingCleanup } = renderComponent(
    createElement(AdminCorpusStatusCard, {
      corpusStatus: undefined,
    }),
  );
  assert.doesNotMatch(missingContainer.textContent ?? "", new RegExp(noPublishedLabel, "i"));
  assert.match(missingContainer.textContent ?? "", /—/);
  missingCleanup();
});
