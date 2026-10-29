import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AUTH_USER_ROLES, AUTH_ACCOUNT_STATUSES } from "@lcsp/contracts/auth";
import {
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleDateTimeWithYear,
  formatLocaleActivityTime,
} from "../src/lib/date-format.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { AdminRecentActivityCard } from "../src/features/admin/components/molecules/admin-recent-activity-card.tsx";
import { AdminAccountDetailsCard } from "../src/features/admin/components/organisms/admin-account-details-card.tsx";
import { AdminUsageSummary } from "../src/features/admin/components/organisms/admin-usage-summary.tsx";
import { AdminUserTable } from "../src/features/admin/components/organisms/admin-user-table.tsx";

const dom = new JSDOM(
  '<!doctype html><html lang="vi"><body><div id="root"></div></body></html>',
  { url: "http://localhost/admin/overview", pretendToBeVisual: true },
);
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
] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? testWindow : testWindow[name],
  });
}

test("formatLocaleDate formats according to active locale", () => {
  const iso = "2026-03-15T10:30:00.000Z";

  setAppLocale("en");
  const enDate = formatLocaleDate(iso);
  assert.match(enDate, /Mar 15, 2026/);

  setAppLocale("vi");
  const viDate = formatLocaleDate(iso);
  assert.match(viDate, /15 thg 3, 2026/);

  // Explicit locale override
  assert.match(formatLocaleDate(iso, "en"), /Mar 15, 2026/);
  assert.match(formatLocaleDate(iso, "vi"), /15 thg 3, 2026/);
});

test("formatLocaleDateTime and formatLocaleActivityTime follow locale authority", () => {
  const iso = "2026-03-15T14:30:00.000Z";

  setAppLocale("en");
  const enDateTime = formatLocaleDateTime(iso);
  const enActivity = formatLocaleActivityTime(iso);

  setAppLocale("vi");
  const viDateTime = formatLocaleDateTime(iso);
  const viActivity = formatLocaleActivityTime(iso);

  assert.notEqual(enDateTime, viDateTime);
  assert.ok(enActivity);
  assert.ok(viActivity);
});

test("formatLocaleDateTimeWithYear uses an em dash for missing or invalid timestamps", () => {
  assert.equal(formatLocaleDateTimeWithYear(null), "—");
  assert.equal(formatLocaleDateTimeWithYear(undefined), "—");
  assert.equal(formatLocaleDateTimeWithYear("not-a-date"), "—");
});

test("AdminRecentActivityCard presents activity timestamp driven by selected locale", () => {
  const items = [
    {
      id: "act-1",
      eventType: "account.suspended",
      occurredAt: "2026-03-15T14:30:00.000Z",
      adminEmail: "admin@example.com",
      adminName: "Admin",
      actionKey: "SUSPENDED_ACCOUNT" as const,
      target: "user@example.com",
    },
  ];

  setAppLocale("en");
  const htmlEn = renderToStaticMarkup(
    createElement(AdminRecentActivityCard, { items }),
  );

  setAppLocale("vi");
  const htmlVi = renderToStaticMarkup(
    createElement(AdminRecentActivityCard, { items }),
  );

  assert.match(htmlEn, /Recent admin activity/);
  assert.match(htmlVi, /Hoạt động quản trị gần đây/);
  assert.match(htmlEn, /3\/15/);
  assert.match(htmlVi, /15\/3/);
});

test("AdminAccountDetailsCard presents user dates driven by selected locale", () => {
  const user = {
    id: "usr-1",
    fullName: "Jane Doe",
    email: "jane@example.com",
    role: AUTH_USER_ROLES.admin,
    status: AUTH_ACCOUNT_STATUSES.active,
    createdAt: "2026-01-10T00:00:00.000Z",
    lastActiveAt: "2026-03-15T12:00:00.000Z",
    usageSummary: {
      assessments30d: 5,
      lastAssessmentAt: "2026-03-15T14:30:00.000Z",
      creditSpend30d: 120.5,
      openFindingsCount: 2,
    },
  };

  setAppLocale("en");
  const htmlEn = renderToStaticMarkup(
    createElement(AdminAccountDetailsCard, { user }),
  );
  assert.match(htmlEn, /Jan 10, 2026/);
  assert.match(htmlEn, /Mar 15, 2026/);

  setAppLocale("vi");
  const htmlVi = renderToStaticMarkup(
    createElement(AdminAccountDetailsCard, { user }),
  );
  assert.match(htmlVi, /10 thg 1, 2026/);
  assert.match(htmlVi, /15 thg 3, 2026/);
});

test("AdminUsageSummary presents last assessment timestamp driven by selected locale", () => {
  const usageSummary = {
    assessments30d: 5,
    lastAssessmentAt: "2026-03-15T14:30:00.000Z",
    creditSpend30d: 120.5,
    openFindingsCount: 2,
  };

  setAppLocale("en");
  const htmlEn = renderToStaticMarkup(
    createElement(AdminUsageSummary, { usageSummary }),
  );
  assert.match(htmlEn, /Mar 15/);

  setAppLocale("vi");
  const htmlVi = renderToStaticMarkup(
    createElement(AdminUsageSummary, { usageSummary }),
  );
  assert.match(htmlVi, /15 thg 3/);
});

test("AdminUserTable presents user creation and activity dates driven by selected locale", () => {
  const users = [
    {
      id: "usr-1",
      fullName: "Jane Doe",
      email: "jane@example.com",
      role: AUTH_USER_ROLES.admin,
      status: AUTH_ACCOUNT_STATUSES.active,
      createdAt: "2026-01-10T00:00:00.000Z",
      lastActiveAt: "2026-03-15T12:00:00.000Z",
      assessmentCount: 3,
    },
  ];

  setAppLocale("en");
  const htmlEn = renderToStaticMarkup(
    createElement(AdminUserTable, { users, onViewUser: () => {} }),
  );
  assert.match(htmlEn, /Jan 10, 2026/);
  assert.match(htmlEn, /Mar 15, 2026/);

  setAppLocale("vi");
  const htmlVi = renderToStaticMarkup(
    createElement(AdminUserTable, { users, onViewUser: () => {} }),
  );
  assert.match(htmlVi, /10 thg 1, 2026/);
  assert.match(htmlVi, /15 thg 3, 2026/);
});
