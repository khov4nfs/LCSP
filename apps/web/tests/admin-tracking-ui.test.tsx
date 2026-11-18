import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { setAppLocale } from "../src/lib/locale.ts";
import { AdminTrackingPage } from "../src/features/tracking/components/organisms/admin-tracking-page.tsx";
import { groupUsageByModel } from "../src/features/tracking/utils/tracking-display.ts";
import { installFetch, render, settle } from "./support/dom.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

setAppLocale("vi");

const sampleOperationalData = {
  platformHealth: {
    totalActiveAssessments: 10,
    totalFailedAssessments: 0,
    totalBlockedAssessments: 0,
    totalExecutionAnomalies: 0,
    totalUnreconciledUsageEvents: 3,
    totalUntrustedProjections: 0,
  },
  impactedAssessments: [],
  executionAnomalies: [],
  unreconciledUsage: [
    {
      eventId: "5d52c652-527e-4c3f-a797-2ffd5d083041",
      assessmentId: "abf07fb7-57ae-41b9-ab05-e57dc127e64f",
      model: "claude-sonnet-4-6",
      promptTokens: 120,
      completionTokens: 80,
      totalTokens: 200,
      reconciled: false,
      createdAt: "2026-11-18T14:00:00.000Z",
    },
    {
      eventId: "6219c6ae-8300-42cc-9f7c-71b1d6bcc513",
      assessmentId: "abf07fb7-57ae-41b9-ab05-e57dc127e64f",
      model: "claude-sonnet-4-6",
      promptTokens: 50,
      completionTokens: 50,
      totalTokens: 100,
      reconciled: false,
      createdAt: "2026-11-18T14:15:00.000Z",
    },
    {
      eventId: "8b33bd5c-5669-4b2b-bc0b-21fb83a264e4",
      assessmentId: null,
      model: "mercury-3",
      promptTokens: null,
      completionTokens: null,
      totalTokens: 450,
      reconciled: true,
      createdAt: "2026-11-18T14:30:00.000Z",
    },
  ],
  untrustedProjections: [],
  correlationId: "corr-12345",
  generatedAt: "2026-11-18T15:00:00.000Z",
};

test("groupUsageByModel aggregates usage events correctly", () => {
  const groups = groupUsageByModel(sampleOperationalData.unreconciledUsage);
  assert.equal(groups.length, 2);

  const claude = groups.find((g) => g.model === "claude-sonnet-4-6");
  assert.ok(claude);
  assert.equal(claude.runCount, 2);
  assert.equal(claude.totalTokens, 300);
  assert.equal(claude.promptTokens, 170);
  assert.equal(claude.completionTokens, 130);
  assert.equal(claude.unreconciledCount, 2);
  assert.equal(claude.reconciledCount, 0);

  const mercury = groups.find((g) => g.model === "mercury-3");
  assert.ok(mercury);
  assert.equal(mercury.runCount, 1);
  assert.equal(mercury.totalTokens, 450);
  assert.equal(mercury.reconciledCount, 1);
});

test("AdminTrackingPage groups token usage by model and toggles activity list on click", async () => {
  const { restore } = installFetch({
    "GET /api/admin/tracking/operational": sampleOperationalData,
  });

  try {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const root = render(
      <QueryClientProvider client={queryClient}>
        <AdminTrackingPage />
      </QueryClientProvider>,
    );

    await settle();

    const text = root.textContent ?? "";

    // 1. Check section ordering: "Đối soát mức sử dụng" appears above "Lượt chạy bất thường"
    const sectionTitles = Array.from(
      root.querySelectorAll('[data-slot="card-title"]'),
    ).map((el) => el.textContent?.trim());

    const usageIndex = sectionTitles.lastIndexOf("Đối soát mức sử dụng");
    const executionIndex = sectionTitles.lastIndexOf("Lượt chạy bất thường");
    assert.ok(
      usageIndex !== -1 && executionIndex !== -1 && usageIndex < executionIndex,
      `Expected usage section to appear above execution anomalies section, got: ${sectionTitles.join(", ")}`,
    );

    // 2. Check Execution Anomalies empty state
    assert.match(
      text,
      /Hệ thống hoạt động bình thường/,
      "Expected clean normal status when anomalies are empty",
    );

    // 3. Models are shown with aggregated metrics
    assert.match(text, /claude-sonnet-4-6/);
    assert.match(text, /2 lượt chạy/);
    assert.match(text, /300/); // 200 + 100 aggregated total

    assert.match(text, /mercury-3/);
    assert.match(text, /1 lượt chạy/);
    assert.match(text, /450/);

    // 4. Initially, activities list is NOT rendered
    assert.doesNotMatch(text, /Lịch sử hoạt động/);

    // 5. Raw UUIDs should NEVER appear
    assert.doesNotMatch(text, /5d52c652-527e-4c3f-a797-2ffd5d083041/);
    assert.doesNotMatch(text, /6219c6ae-8300-42cc-9f7c-71b1d6bcc513/);
    assert.doesNotMatch(text, /8b33bd5c-5669-4b2b-bc0b-21fb83a264e4/);

    // 6. Click on the first model card to toggle activities
    const buttons = root.querySelectorAll("button");
    const claudeButton = Array.from(buttons).find((b) =>
      b.textContent?.includes("claude-sonnet-4-6"),
    );
    assert.ok(claudeButton, "Expected button for claude-sonnet-4-6");

    act(() => {
      claudeButton.click();
    });
    await settle();

    const textAfterClick = root.textContent ?? "";
    assert.match(textAfterClick, /Lịch sử hoạt động/);
    assert.match(textAfterClick, /200/);
    assert.match(textAfterClick, /100/);
    assert.match(textAfterClick, /Ẩn hoạt động/);
  } finally {
    restore();
  }
});
