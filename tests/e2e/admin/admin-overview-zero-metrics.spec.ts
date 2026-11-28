import { expect, test } from "@playwright/test";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

test("Admin overview renders a real zero cohort without sample metrics", async ({
  page,
}) => {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);
  // Why: The API can legitimately return zero counts for a selected period.
  // How: Replace only the overview JSON response while the real Admin route renders in Chromium.
  // Invariant: A zero cohort cannot acquire fixture counts or sample bars in the browser.
  await page.route("**/api/admin/overview**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          period: "30D",
          periodDays: 30,
          summary: {
            totalUsers: { count: 0, periodChange: 0 },
            activeUsers: { count: 0, percentageOfTotal: 0 },
            assessments: { totalCount: 0, periodCompletedCount: 0 },
            currentLegalSource: {
              version: null,
              sourceCount: 0,
              ruleCount: null,
            },
          },
          assessmentActivity: {
            points: [],
            totalStarted: 0,
            totalCompleted: 0,
            startDate: "2026-09-01T00:00:00.000Z",
            endDate: "2026-10-01T00:00:00.000Z",
          },
          accountDistribution: {
            activeCount: 0,
            invitedCount: 0,
            suspendedCount: 0,
            deactivatedCount: 0,
            totalCount: 0,
          },
          recentActivity: [],
          legalSourceStatus: { current: null, draft: null },
        },
      },
    }),
  );
  await page.goto("/admin");
  const card = page.locator('[data-figma-name="Assessment throughput"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("0 completed in cohort");
  await expect(card).not.toContainText(/876|312|270/);
  await expect(card.locator('[title^="Started:"]')).toHaveCount(0);
  await expect(card.locator('[title^="Completed:"]')).toHaveCount(0);
});
