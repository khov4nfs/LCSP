import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const mock = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../apps/web/src/public/assets/mocks/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const catalog = mock("selected-rule-audit-catalog");
const queued = mock("selected-rule-audit-request");
const ready = mock("selected-rule-audit-ready-request");
const initialDetail = mock("selected-rule-audit-detail");
const readyDetail = mock("selected-rule-audit-ready-detail");
const readyEvents = mock("selected-rule-audit-ready-events");
const partialExport = mock("selected-rule-audit-partial-export");
const provenance = mock("selected-rule-audit-provenance");
const id = catalog.assessmentId as string;

async function openSelectedAudit(page: Page) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("Playwright baseURL is required");
  await page.context().addCookies([
    {
      name: "lcsp_session",
      value: "billing-e2e-customer",
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const sent: unknown[] = [];
  let accepted = false;
  let resultReady = false;
  await page.route(`**/api/assessments/${id}**`, async (route) => {
    const url = new URL(route.request().url());
    const suffix = url.pathname.slice(`/api/assessments/${id}`.length);
    let data: unknown;
    if (suffix === "" || suffix === "/")
      data = resultReady ? readyDetail : initialDetail;
    else if (suffix === "/rules")
      data = {
        ...catalog,
        latestRequestId: accepted ? queued.requestId : null,
        latestRequestStatus: accepted
          ? resultReady
            ? "RUNNING"
            : "QUEUED"
          : null,
        auditRevision: accepted ? 1 : 0,
        rules: resultReady
          ? catalog.rules.map((rule: { assessmentRuleId: string }) => {
              const state = ready.rules.find(
                (item: { assessmentRuleId: string }) =>
                  item.assessmentRuleId === rule.assessmentRuleId,
              );
              return state
                ? {
                    ...rule,
                    progress: state.progress,
                    decisionId: state.decisionId,
                  }
                : rule;
            })
          : catalog.rules,
      };
    else if (suffix === "/rule-audits" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      sent.push(body);
      accepted = true;
      data = {
        ...queued,
        requested: body.rules.length,
        notRequested: 20 - body.rules.length,
        rules: body.rules.map(
          (
            rule: { assessmentRuleId: string; assessmentRuleVersion: string },
            ordinal: number,
          ) => ({ ...rule, ordinal, progress: "QUEUED", decisionId: null }),
        ),
      };
    } else if (suffix === `/rule-audits/${queued.requestId}`)
      data = resultReady ? ready : queued;
    else if (
      suffix === `/rule-audits/${queued.requestId}/exports` &&
      route.request().method() === "POST"
    )
      data = {
        exportId: partialExport.exportId,
        requestId: queued.requestId,
        contentSha256: "b".repeat(64),
        createdAt: partialExport.exportedAt,
      };
    else if (
      suffix ===
      `/rule-audits/${queued.requestId}/exports/${partialExport.exportId}/download`
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "content-disposition": `attachment; filename="rule-audit-${partialExport.exportId}.json"`,
        },
        body: JSON.stringify(partialExport),
      });
      return;
    } else if (suffix === "/events")
      data = resultReady
        ? readyEvents
        : {
            assessmentId: id,
            events: [],
            hasMore: false,
            nextAfterSequence: null,
          };
    else if (suffix === "/provenance") data = provenance;
    else if (suffix === "/human-requests")
      data = { caseRevision: 1, requests: [] };
    else if (suffix === "/repository-setup")
      data = {
        assessmentId: id,
        lifecycle: initialDetail.lifecycle,
        connection: null,
        snapshot: null,
        scanJob: null,
      };
    else return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data }),
    });
  });
  await page.goto(`/assessments/${id}`);
  await expect(page.locator('[data-slot="rule-audit-picker"]')).toBeVisible();
  return {
    sent,
    showResult: () => {
      resultReady = true;
    },
  };
}

test("customer chooses Rule 3 from twenty without an implicit full audit", async ({
  page,
}) => {
  const state = await openSelectedAudit(page);
  await expect(
    page.getByRole("button", { name: "Audit selected rules" }),
  ).toBeDisabled();
  await expect(page.locator('[data-rule-id^="Rule-"]')).toHaveCount(20);
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText("Selected 20/20")).toBeVisible();
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.locator('[data-rule-id="Rule-3"] input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Audit selected rules" }).click();
  await expect.poll(() => state.sent.length).toBe(1);
  expect(
    (state.sent[0] as { rules: Array<{ assessmentRuleId: string }> }).rules.map(
      (rule) => rule.assessmentRuleId,
    ),
  ).toEqual(["Rule-3"]);
});

test("Rule 3 result stays available while Rule 9 is investigating after reload", async ({
  page,
}) => {
  const state = await openSelectedAudit(page);
  await page.locator('[data-rule-id="Rule-3"] input[type="checkbox"]').check();
  await page.locator('[data-rule-id="Rule-9"] input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Audit selected rules" }).click();
  await expect.poll(() => state.sent.length).toBe(1);
  state.showResult();
  await page.reload();

  await expect(page.getByText("Results ready: 1/2 selected")).toBeVisible();
  await expect(
    page.getByText("18 rules not requested", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-rule-id="Rule-3"]')).toContainText(
    "Result ready",
  );
  await expect(page.locator('[data-rule-id="Rule-9"]')).toContainText(
    "Investigating",
  );
  await page
    .locator('[data-rule-id="Rule-3"]')
    .getByRole("button", { name: "View result" })
    .click();
  await expect(
    page.locator('[data-decision-id="66666666-6666-4666-8666-666666666666"]'),
  ).toBeVisible();
});

test("partial download names only accepted Rule 3 and keeps Rule 9 pending", async ({
  page,
}) => {
  const state = await openSelectedAudit(page);
  await page.locator('[data-rule-id="Rule-3"] input[type="checkbox"]').check();
  await page.locator('[data-rule-id="Rule-9"] input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Audit selected rules" }).click();
  await expect.poll(() => state.sent.length).toBe(1);
  state.showResult();
  await page.reload();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Download partial selected-rule result" })
      .click(),
  ]);
  const saved = await download.path();
  if (!saved) throw new Error("Partial export download did not produce a file");
  const content = JSON.parse(readFileSync(saved, "utf8"));
  expect(content.kind).toBe("PARTIAL_SELECTED_RULE_AUDIT");
  expect(content.requestedRuleIds).toEqual(["Rule-3", "Rule-9"]);
  expect(content.includedRuleIds).toEqual(["Rule-3"]);
  expect(content.notRequestedRuleCount).toBe(18);
  expect(content.results[0].evidence).toHaveLength(1);
});

test("provenance labels selected coverage without claiming a full Rule Set audit", async ({
  page,
}) => {
  await openSelectedAudit(page);
  await page.goto(`/assessments/${id}/provenance`);

  await expect(page.getByText("Selected-rule audit scope")).toBeVisible();
  await expect(
    page.getByText("1 / 2 requested rules ready", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("18 rules not requested", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Rules in pinned Rule Set", { exact: false }),
  ).toBeVisible();
});
