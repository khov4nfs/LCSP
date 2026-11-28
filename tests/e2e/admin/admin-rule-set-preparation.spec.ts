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

test("pending cancellation keeps Admin activity live until the terminal result", async ({
  page,
}) => {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);
  await page.addInitScript(() => {
    const state = window as unknown as {
      __preparationStreams: Array<{ closed: boolean }>;
    };
    state.__preparationStreams = [];
    // Why: Observe the production hook's subscription lifecycle without opening a paid worker run.
    // How: Replace only the browser EventSource transport and retain each instance's close state.
    // Invariant: A pending cancellation must remain subscribed; terminal cancellation must close it.
    window.EventSource = class {
      closed = false;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        state.__preparationStreams.push(this);
        queueMicrotask(() => this.onopen?.());
      }
      addEventListener() {}
      removeEventListener() {}
      close() {
        this.closed = true;
      }
    } as unknown as typeof EventSource;
  });
  const run = {
    ...fixture.queuedRun,
    ...fixture.runDetails,
    executionState: AGENT_EXECUTION_STATES.CANCEL_REQUESTED,
  };
  let executionState: string = AGENT_EXECUTION_STATES.CANCEL_REQUESTED;
  await page.route(`**${historyPath}`, (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          ...fixture.clean,
          preparation: {
            ...fixture.clean.preparation,
            canStart: false,
            refusalReason:
              RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
            currentRun: { ...fixture.queuedRun, executionState },
          },
          preparations: [{ ...run, executionState }],
        },
      },
    }),
  );
  await page.goto("/admin/compliance-rule-sets");
  await expect(
    page.locator('[data-preparation-state="CANCEL_REQUESTED"]'),
  ).toBeVisible();
  await expect(page.getByText("Cancellation requested").first()).toBeVisible();
  await page.waitForFunction(() =>
    Boolean(
      (
        window as unknown as {
          __preparationStreams: Array<{ closed: boolean }>;
        }
      ).__preparationStreams?.some((stream) => !stream.closed),
    ),
  );
  executionState = AGENT_EXECUTION_STATES.CANCELLED;
  await expect(page.locator('[data-preparation-state="CANCELLED"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.waitForFunction(() =>
    (
      window as unknown as {
        __preparationStreams: Array<{ closed: boolean }>;
      }
    ).__preparationStreams.every((stream) => stream.closed),
  );
});
