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
      canStart: true,
      refusalReason: null,
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
  await page
    .getByRole("button", {
      name: "Retry failed Rule Set Preparation",
      exact: true,
    })
    .click();
  await expect(page.locator('[data-preparation-state="QUEUED"]')).toBeVisible();
  expect(retried).toBe(true);
});
