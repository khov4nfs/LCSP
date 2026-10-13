import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  RULE_SET_PREPARATION_FAILURE_REASONS,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
} from "@lcsp/contracts/compliance-rule-set";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/admin-rule-set-preparation.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const historyPath = "/api/admin/compliance-rule-sets";

test("Prepare is wired through the real Web BFF and a local API fixture", async ({
  page,
}) => {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);
  await page.goto("/admin/compliance-rule-sets");
  await page
    .getByRole("button", { name: "Prepare rule set", exact: true })
    .click();
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${historyPath}/prepare`) &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Prepare", exact: true })
    .click();
  expect((await response).status()).toBe(202);
  await expect(
    page.getByRole("button", { name: "Preparing rule set…", exact: true }),
  ).toBeDisabled();
  await expect(page.locator('[data-preparation-state="QUEUED"]')).toBeVisible();
});

test("Admin confirms Prepare once, sees running state, then shared ACTIVE metadata", async ({
  page,
}) => {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);
  let history = structuredClone(fixture.clean);
  let posts = 0;
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.route(`**${historyPath}`, (route) =>
    route.fulfill({ json: { ok: true, data: history } }),
  );
  await page.route(`**${historyPath}/prepare`, async (route) => {
    posts += 1;
    expect(route.request().postData()).toBeNull();
    const run = fixture.queuedRun;
    history = {
      ...fixture.clean,
      preparation: {
        ...fixture.clean.preparation,
        canStart: false,
        refusalReason:
          RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
        currentRun: run,
      },
      preparations: [{ ...run, ...fixture.runDetails }],
    };
    await route.fulfill({ status: 202, json: { ok: true, data: run } });
  });
  await page.goto("/admin/compliance-rule-sets");
  const prepare = page.getByRole("button", {
    name: "Prepare rule set",
    exact: true,
  });
  await expect(prepare).toBeEnabled();
  await expect(
    page.getByText("No Rule Set Preparation has run yet."),
  ).toBeVisible();
  await prepare.click();
  await expect(page.getByRole("dialog")).toContainText("model quota");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(posts).toBe(0);
  await prepare.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Prepare", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preparing rule set…", exact: true }),
  ).toBeDisabled();
  await expect(page.locator('[data-preparation-state="QUEUED"]')).toBeVisible();
  expect(posts).toBe(1);
  history = {
    ...fixture.clean,
    preparation: {
      ...fixture.clean.preparation,
      canStart: false,
      refusalReason:
        RULE_SET_PREPARATION_REFUSAL_REASONS.ACTIVE_RULE_SET_EXISTS,
      currentRun: {
        ...fixture.queuedRun,
        executionState: AGENT_EXECUTION_STATES.SUCCEEDED,
        ruleSetVersionId: fixture.activeRuleSet.ruleSetVersionId,
      },
    },
    ruleSets: [fixture.activeRuleSet],
    preparations: [],
  };
  await expect(
    page.locator("[data-compliance-rule-set-active]"),
  ).toHaveAttribute(
    "data-compliance-rule-set-active",
    fixture.activeRuleSet.ruleSetVersionId,
    { timeout: 10_000 },
  );
  await expect(
    page.getByRole("button", { name: "Prepare rule set", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("110", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("66", { exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test("failed preparation exposes the canonical Retry route for the same run", async ({
  page,
}) => {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);
  const run = {
    ...fixture.queuedRun,
    executionState: AGENT_EXECUTION_STATES.FAILED,
  };
  let history = {
    ...fixture.clean,
    preparation: {
      ...fixture.clean.preparation,
      canStart: false,
      refusalReason:
        RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_ALREADY_STARTED,
      currentRun: run,
    },
    preparations: [
      {
        ...run,
        ...fixture.runDetails,
        failureReason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
        retryable: true,
      },
    ],
  };
  let retried = false;
  await page.route(`**${historyPath}`, (route) =>
    route.fulfill({ json: { ok: true, data: history } }),
  );
  await page.route(
    `**${historyPath}/preparations/${run.preparationRunId}/retries`,
    async (route) => {
      retried = true;
      const next = {
        ...fixture.queuedRun,
        preparationRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      };
      history = {
        ...fixture.clean,
        preparation: {
          ...fixture.clean.preparation,
          canStart: false,
          refusalReason:
            RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
          currentRun: next,
        },
        preparations: [{ ...next, ...fixture.runDetails }],
      };
      await route.fulfill({ status: 202, json: { ok: true, data: next } });
    },
  );
  await page.goto("/admin/compliance-rule-sets");
  await expect(page.getByText("No rule set was submitted")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Prepare rule set", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Retry failed Rule Set Preparation",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Preparing rule set…", exact: true }),
  ).toBeDisabled();
  expect(retried).toBe(true);
});
