import { expect, test } from "@playwright/test";
import { authenticateBillingE2e, BILLING_E2E_TOKENS } from "../fixtures/billing-auth.js";

test("compliance page shows missing rule set coverage instead of an all-clear", async ({ page }) => {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
  await page.route("**/api/assessments/tracking/obligations*", (route) => route.fulfill({
    json: {
      ok: true,
      data: {
        items: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
        evaluationSummary: { evaluatedAssessmentCount: 0, notEvaluatedAssessmentCount: 3 },
        generatedAt: "2026-10-26T00:00:00.000Z",
      },
    },
  }));

  await page.goto("/workspace/compliance");

  await expect(page.getByText("3 assessments could not be evaluated", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review affected assessments" })).toHaveAttribute("href", "/assessments");
  await expect(page.getByText("No actionable obligations were found among evaluated assessments.", { exact: true })).toHaveCount(0);
});

test("customers can page to obligation assessments beyond the first twenty", async ({ page }) => {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
  const assessment = (index: number) => ({
    assessmentId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    assessmentName: `Affected assessment ${index}`,
    outcome: "UNRESOLVED",
    freshnessStatus: "FRESHNESS_UNKNOWN",
    observedAt: null,
    trustStatus: "IN_PROGRESS",
  });
  await page.route("**/api/assessments/tracking/obligations?*", (route) => route.fulfill({
    json: {
      ok: true,
      data: {
        items: [{
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          ruleSetVersion: "1.0.0",
          assessmentRuleId: "RULE-MFA",
          concept: "Multi-factor authentication",
          compliantCount: 0,
          nonCompliantCount: 0,
          notApplicableCount: 0,
          unresolvedCount: 25,
          affectedAssessmentCount: 25,
          assessments: Array.from({ length: 20 }, (_, index) => assessment(index + 1)),
        }],
        pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
        evaluationSummary: { evaluatedAssessmentCount: 25, notEvaluatedAssessmentCount: 0 },
        generatedAt: "2026-10-26T00:00:00.000Z",
      },
    },
  }));
  await page.route("**/api/assessments/tracking/obligations/assessments?*", (route) => route.fulfill({
    json: {
      ok: true,
      data: {
        items: Array.from({ length: 5 }, (_, index) => assessment(index + 21)),
        pagination: { total: 25, limit: 20, offset: 20, hasMore: false },
        generatedAt: "2026-10-26T00:00:00.000Z",
      },
    },
  }));

  await page.goto("/workspace/compliance");
  const loadMore = page.getByRole("button", { name: "Load more affected assessments" });
  await expect(loadMore).toBeVisible();
  await loadMore.focus();
  await expect(loadMore).toBeFocused();
  await loadMore.click();
  await expect(page.getByRole("link", { name: "Affected assessment 25" })).toBeVisible();
  await expect(page.getByText("25 / 25", { exact: true })).toBeVisible();
});

test("customers are redirected away from ADMIN tracking", async ({ page }) => {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
  await page.goto("/admin/tracking");
  await expect(page).toHaveURL(/\/workspace(?:$|\?)/);
});
