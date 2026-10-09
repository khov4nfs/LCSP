import { expect, test, type Page, type Route } from "@playwright/test";

const ASSESSMENT_ID = "00000000-0000-4000-8000-000000000101";
const THREAD_ID = "00000000-0000-4000-8000-000000000102";
const CHECKPOINT_NAMESPACE = "00000000-0000-4000-8000-000000000103";
const EXECUTION_ID = "00000000-0000-4000-8000-000000000104";
const lifecycle = {
  state: "WAITING_FOR_REQUIRED_INPUT",
  assessmentRevision: 1,
};
const runtime = {
  threadId: THREAD_ID,
  rootAgentVersion: "playwright-fixture",
  checkpointNamespace: CHECKPOINT_NAMESPACE,
  checkpointId: null,
  currentExecutionId: EXECUTION_ID,
  executionState: "RUNNING",
  eventSequence: 1,
  startedAt: "2026-10-08T00:00:00.000Z",
  lastResumedAt: null,
  updatedAt: "2026-10-08T00:00:00.000Z",
};
type Control =
  "FREE_TEXT" | "BOOLEAN" | "SINGLE_SELECT" | "MULTI_SELECT" | "CONFIRM_ADJUST";
type InterviewState = ReturnType<typeof interviewState>;
function envelope(data: unknown) {
  return JSON.stringify({ ok: true, data });
}
function problemEnvelope() {
  return JSON.stringify({
    ok: false,
    problem: {
      type: "problem/upstream-unavailable",
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
      titleKey: "errors.upstreamUnavailable.title",
      detailKey: "errors.upstreamUnavailable.detail",
      requiredAction: "none",
      correlationId: "playwright-interview",
    },
  });
}
function assessmentDetail(currentLifecycle = lifecycle) {
  return {
    assessment_id: ASSESSMENT_ID,
    name: "Playwright Interview assessment",
    owner_id: "playwright-owner",
    lifecycle: currentLifecycle,
    runtime,
    case: null,
    created_at: "2026-10-08T00:00:00.000Z",
    updated_at: "2026-10-08T00:00:00.000Z",
    correlationId: "playwright-correlation",
  };
}
function interviewState(
  control: Control = "FREE_TEXT",
  questionId = "q-playwright-1",
  answerHistory: unknown[] = [],
) {
  const choices =
    control === "BOOLEAN"
      ? [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ]
      : control === "SINGLE_SELECT"
        ? [
            { id: "standard", label: "Standard" },
            { id: "other", label: "Other", requiresFreeText: true },
          ]
        : control === "MULTI_SELECT"
          ? [
              { id: "records", label: "Customer records" },
              { id: "metadata", label: "Workflow metadata" },
              { id: "other", label: "Other", requiresFreeText: true },
            ]
          : undefined;
  return {
    outcome: "WAITING_FOR_CUSTOMER",
    threadId: THREAD_ID,
    contextRevision: 1,
    activeQuestion: {
      id: questionId,
      intent: "ASK",
      control,
      prompt:
        control === "CONFIRM_ADJUST"
          ? "Confirm this interpretation of the workflow?"
          : "What data does this workflow process?",
      ...(choices ? { choices } : {}),
      ...(control === "CONFIRM_ADJUST"
        ? { proposedInterpretation: "The workflow processes customer records." }
        : {}),
    },
    answerHistory,
  };
}
function runtimeSse(currentLifecycle = lifecycle) {
  return [
    "event: workspace.runtime",
    `data: ${JSON.stringify({ emitted_at: "2026-10-08T00:00:00.000Z", canonical_assessments: [{ assessmentId: ASSESSMENT_ID, lifecycle: currentLifecycle, runtime }], canonical_events: [] })}`,
    "",
    "",
  ].join("\n");
}
type MutationResponse = { status: number; body?: string };
const unexpectedRequestsByPage = new WeakMap<Page, string[]>();

test.afterEach(async ({ page }) => {
  expect(unexpectedRequestsByPage.get(page) ?? []).toEqual([]);
});

async function installFixture(
  page: Page,
  options: {
    initialInterview?: InterviewState;
    currentLifecycle?: typeof lifecycle;
  } = {},
) {
  let currentInterview = options.initialInterview ?? interviewState();
  const currentLifecycle = options.currentLifecycle ?? lifecycle;
  const submissions: unknown[] = [];
  const mutationResponses: MutationResponse[] = [];
  let holdNextMutation = false;
  let releaseHeldMutation: (() => void) | undefined;
  const unexpectedRequests: string[] = [];
  unexpectedRequestsByPage.set(page, unexpectedRequests);
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/workspace/runtime-events") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: runtimeSse(currentLifecycle),
      });
      return;
    }
    if (path === `/api/assessments/${ASSESSMENT_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope(assessmentDetail(currentLifecycle)),
      });
      return;
    }
    if (path === `/api/assessments/${ASSESSMENT_ID}/interview`) {
      if (request.method() === "POST") {
        submissions.push(request.postDataJSON());
        if (holdNextMutation) {
          await new Promise<void>((resolve) => {
            releaseHeldMutation = resolve;
          });
        }
        const response = mutationResponses.shift();
        await route.fulfill({
          status: response?.status ?? 201,
          contentType: "application/json",
          body: response?.body ?? envelope(currentInterview),
        });
      } else
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: envelope(currentInterview),
        });
      return;
    }
    if (path === `/api/assessments/${ASSESSMENT_ID}/human-requests`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope({ caseRevision: 1, requests: [] }),
      });
      return;
    }
    if (path === `/api/assessments/${ASSESSMENT_ID}/artifacts`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope(null),
      });
      return;
    }
    if (
      path === `/api/assessments/${ASSESSMENT_ID}/repository-setup` ||
      path === `/api/assessments/${ASSESSMENT_ID}/runtime/control` ||
      path === "/api/assessments" ||
      path === "/api/workspace"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope(null),
      });
      return;
    }
    if (path === "/api/auth/profile") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope({
          user: {
            id: "playwright-owner",
            email: "playwright@example.com",
            role: "CUSTOMER",
          },
        }),
      });
      return;
    }
    const requestDescription = `${request.method()} ${path}`;
    unexpectedRequests.push(requestDescription);
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: problemEnvelope(),
    });
  });
  await page.context().addCookies([
    {
      name: "lcsp_session",
      value: "billing-e2e-customer",
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "lcsp_locale",
      value: "en",
      url: "http://127.0.0.1:3100",
      sameSite: "Lax",
    },
  ]);
  return {
    submissions,
    unexpectedRequests,
    setInterviewState(next: InterviewState) {
      currentInterview = next;
    },
    queueMutationResponse(response: MutationResponse) {
      mutationResponses.push(response);
    },
    holdNextRequest() {
      holdNextMutation = true;
    },
    releaseHeldRequest() {
      holdNextMutation = false;
      releaseHeldMutation?.();
      releaseHeldMutation = undefined;
    },
  };
}
async function openAssessment(page: Page) {
  await page.goto(`/assessments/${ASSESSMENT_ID}`);
  await expect(page.locator("main[data-assessment-id]")).toBeVisible();
  await expect(
    page.locator("[data-slot='canonical-interview-panel']"),
  ).toBeVisible();
}
function interviewPostCount(fixture: { submissions: unknown[] }) {
  return fixture.submissions.length;
}

test("canonical assessment renders Interview and owns FREE_TEXT submission", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await openAssessment(page);
  await expect(
    page.locator("[data-canonical-status='PRESENT']").first(),
  ).toBeVisible();
  await expect(
    page.getByText("What data does this workflow process?"),
  ).toBeVisible();
  const composer = page.locator("[data-slot='assessment-composer'] textarea");
  await expect(composer).toBeEnabled();
  await composer.fill("Customer records and workflow metadata.");
  await expect(
    page.locator("[data-slot='assessment-composer'] button[type='submit']"),
  ).toBeEnabled();
  await page
    .locator("[data-slot='assessment-composer'] button[type='submit']")
    .click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(1);
  const payload = fixture.submissions[0] as {
    answer?: { kind?: string; text?: string };
  };
  expect(payload.answer?.kind).toBe("FREE_TEXT");
  expect(payload.answer?.text).toBe("Customer records and workflow metadata.");
  await expect(composer).toBeDisabled();
});

test("SINGLE_SELECT requiresFreeText keeps shared structured ownership", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    initialInterview: interviewState("SINGLE_SELECT"),
  });
  await openAssessment(page);
  await page.getByRole("radio", { name: "Other" }).click();
  const composer = page.locator("[data-slot='assessment-composer'] textarea");
  const action = page.locator("[data-slot='selection-submit-action'] button");
  await expect(composer).toBeEnabled();
  await expect(action).toBeVisible();
  await expect(action).toBeDisabled();
  await expect(
    page.locator("[data-slot='assessment-composer'] button[type='submit']"),
  ).toBeDisabled();
  await composer.fill("Customer records.");
  await expect(action).toBeEnabled();
  await composer.press("Enter");
  await expect.poll(() => interviewPostCount(fixture)).toBe(0);
  await action.click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(1);
  const payload = fixture.submissions[0] as {
    answer?: { kind?: string; value?: string; comment?: string };
  };
  expect(payload.answer?.kind).toBe("SINGLE_SELECT");
  expect(payload.answer?.value).toBe("other");
  expect(payload.answer?.comment).toBe("Customer records.");
  await expect(composer).toBeDisabled();
  await expect(action).toBeDisabled();
});

test("MULTI_SELECT requiresFreeText uses shared action for all selected values", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    initialInterview: interviewState("MULTI_SELECT"),
  });
  await openAssessment(page);
  await page.getByRole("checkbox", { name: "Customer records" }).check();
  await page.getByRole("checkbox", { name: "Other" }).check();
  const composer = page.locator("[data-slot='assessment-composer'] textarea");
  const action = page.locator("[data-slot='selection-submit-action'] button");
  await expect(composer).toBeEnabled();
  await expect(action).toBeVisible();
  await expect(action).toBeDisabled();
  await composer.fill("Sensitive records require a business review.");
  await expect(action).toBeEnabled();
  await expect(
    page.locator("[data-slot='assessment-composer'] button[type='submit']"),
  ).toBeDisabled();
  await composer.press("Enter");
  await expect.poll(() => interviewPostCount(fixture)).toBe(0);
  await action.click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(1);
  const payload = fixture.submissions[0] as {
    answer?: { kind?: string; values?: string[]; comment?: string };
  };
  expect(payload.answer?.kind).toBe("MULTI_SELECT");
  expect(payload.answer?.values).toEqual(["records", "other"]);
  expect(payload.answer?.comment).toBe(
    "Sensitive records require a business review.",
  );
  await expect(composer).toBeDisabled();
});

test("BOOLEAN and normal MULTI_SELECT submit through structured actions", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    initialInterview: interviewState("BOOLEAN"),
  });
  await openAssessment(page);
  await page.getByRole("radio", { name: "Yes" }).click();
  await expect(
    page.locator("[data-slot='assessment-composer'] textarea"),
  ).toBeDisabled();
  await page.locator("[data-slot='selection-submit-action'] button").click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(1);
  expect((fixture.submissions[0] as { answer?: unknown }).answer).toMatchObject(
    { kind: "BOOLEAN", value: true },
  );
});

test("CONFIRM_ADJUST preserves distinct Confirm and Adjust payloads", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    initialInterview: interviewState("CONFIRM_ADJUST"),
  });
  await openAssessment(page);
  await expect(
    page.getByText("Confirm this interpretation of the workflow?"),
  ).toBeVisible();
  await page.getByRole("button", { name: /confirm/i }).click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(1);
  expect((fixture.submissions[0] as { answer?: unknown }).answer).toMatchObject(
    { kind: "CONFIRM_ADJUST", action: "CONFIRM" },
  );
  const adjustFixture = await installFixture(page, {
    initialInterview: interviewState("CONFIRM_ADJUST", "q-playwright-adjust"),
  });
  await page.reload();
  await page.getByRole("button", { name: /adjust/i }).click();
  const composer = page.locator("[data-slot='assessment-composer'] textarea");
  await composer.fill("The workflow also processes audit metadata.");
  await page
    .locator("[data-slot='assessment-composer'] button[type='submit']")
    .click();
  await expect.poll(() => interviewPostCount(adjustFixture)).toBe(1);
  expect(
    (adjustFixture.submissions[0] as { answer?: unknown }).answer,
  ).toMatchObject({
    kind: "CONFIRM_ADJUST",
    action: "ADJUST",
    adjustmentText: "The workflow also processes audit metadata.",
  });
});

test("same-question success remains locked, then a new question resets interaction", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    initialInterview: interviewState("SINGLE_SELECT"),
  });
  await openAssessment(page);
  await page.getByRole("radio", { name: "Standard" }).click();
  fixture.holdNextRequest();
  await page.locator("[data-slot='selection-submit-action'] button").click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(1);
  await expect(
    page.locator("[data-slot='selection-submit-action'] button"),
  ).toBeDisabled();
  fixture.releaseHeldRequest();
  await expect(
    page.locator("[data-slot='selection-submit-action'] button"),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.locator("[data-slot='selection-submit-action'] button"),
  ).toBeDisabled();
  expect(fixture.submissions).toHaveLength(1);
  fixture.setInterviewState(interviewState("SINGLE_SELECT", "q-playwright-2"));
  await page.reload();
  await page.getByRole("radio", { name: "Standard" }).click();
  await page.locator("[data-slot='selection-submit-action'] button").click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(2);
  const second = fixture.submissions[1] as {
    questionRef?: string;
    answer?: { value?: string };
  };
  expect(second.questionRef).toBe("q-playwright-2");
  expect(second.answer?.value).toBe("standard");
});

test("ordinary submission failure unlocks the draft for one explicit retry", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    initialInterview: interviewState("SINGLE_SELECT"),
  });
  fixture.queueMutationResponse({ status: 503, body: problemEnvelope() });
  await openAssessment(page);
  await page.getByRole("radio", { name: "Other" }).click();
  const composer = page.locator("[data-slot='assessment-composer'] textarea");
  await composer.fill("Retryable explanation.");
  const action = page.locator("[data-slot='selection-submit-action'] button");
  await action.click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(1);
  await expect(action).toBeEnabled();
  await expect(composer).toHaveValue("Retryable explanation.");
  await action.click();
  await expect.poll(() => interviewPostCount(fixture)).toBe(2);
  await expect(action).toBeDisabled();
  const first = fixture.submissions[0] as { clientRequestId?: string };
  const second = fixture.submissions[1] as { clientRequestId?: string };
  expect(first.clientRequestId).toBe(second.clientRequestId);
});

test("read-only canonical lifecycle does not submit an Interview answer", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    initialInterview: interviewState("SINGLE_SELECT", "q-playwright-readonly", [
      {
        questionId: "q-history",
        summary: "Previously answered question",
        answeredAt: "2026-10-08T00:00:00.000Z",
        question: { prompt: "A historical prompt" },
      },
    ]),
    currentLifecycle: { state: "PAUSED", assessmentRevision: 1 },
  });
  await openAssessment(page);
  await expect(
    page.locator("[data-canonical-status='PRESENT']").first(),
  ).toBeVisible();
  await expect(
    page.locator("[data-slot='canonical-interview-history']"),
  ).toBeVisible();
  await expect(
    page.locator("[data-slot='selection-submit-action'] button"),
  ).toBeDisabled();
  await expect(page.locator("[data-slot='assessment-composer']")).toHaveCount(
    0,
  );
  expect(fixture.submissions).toHaveLength(0);
});

test("historical CONFIRM_ADJUST entries preserve original interpretations without actions", async ({
  page,
}) => {
  const fixture = await installFixture(page, {
    initialInterview: interviewState("SINGLE_SELECT", "q-active-history", [
      {
        questionId: "q-history-confirmed",
        summary: "Confirmed answer",
        answeredAt: "2026-10-08T00:00:00.000Z",
        question: {
          id: "q-history-confirmed",
          intent: "CLARIFY",
          control: "CONFIRM_ADJUST",
          prompt: "Confirm the original statement?",
          proposedInterpretation: "Original statement A",
        },
      },
      {
        questionId: "q-history-adjusted",
        summary: "Adjusted answer",
        comment: "Customer correction B",
        answeredAt: "2026-10-08T00:01:00.000Z",
        question: {
          id: "q-history-adjusted",
          intent: "CLARIFY",
          control: "CONFIRM_ADJUST",
          prompt: "Confirm the original statement for adjustment?",
          proposedInterpretation: "Original statement for adjustment",
        },
      },
    ]),
  });
  await openAssessment(page);
  const history = page.locator("[data-slot='canonical-interview-history']");
  await expect(history).toContainText("Original statement A");
  await expect(history).toContainText("Original statement for adjustment");
  await expect(history).toContainText("Customer correction B");
  await expect(
    history.locator("[data-slot='proposed-interpretation']"),
  ).toHaveCount(2);
  await expect(history.getByRole("button")).toHaveCount(0);
  expect(fixture.submissions).toHaveLength(0);
});
