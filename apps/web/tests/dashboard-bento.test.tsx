import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { act } from "react";
import { LOCALES } from "@lcsp/contracts/shared";
import type { CustomerTrackingOverview } from "@lcsp/contracts/assessment-domain";

import { setAppLocale } from "../src/lib/locale.ts";
import { render } from "./support/dom.ts";
import { CoverageDonut } from "../src/components/molecules/coverage-donut.tsx";
import { OutcomeLegend } from "../src/components/molecules/outcome-legend.tsx";
import { NextMetricCard } from "../src/components/molecules/next-metric-card.tsx";
import {
  DASHBOARD_SURFACES,
  NEXT_METRIC_VARIANTS,
} from "../src/components/types/dashboard-primitives.types.ts";
import { DashboardBento } from "../src/features/tracking/components/organisms/dashboard-bento.tsx";
import { QuickActionsDialog } from "../src/features/workspace/components/molecules/quick-actions-dialog.tsx";

afterEach(() => {
  document.body.replaceChildren();
  setAppLocale(LOCALES[0]);
});

const populatedOverview: CustomerTrackingOverview = {
  actions: [
    {
      requestId: "11111111-1111-4111-8111-111111111111",
      assessmentId: "11111111-1111-4111-8111-111111111111",
      assessmentName: "Social network",
      assessmentRuleId: "RULE-1",
      question: "Where is user data stored?",
      unresolvedFact: "Data storage location",
      actionReason: "HUMAN_FACT_REQUIRED",
      createdAt: "2026-11-18T00:00:00.000Z",
      destinationUrl: "/assessments/11111111-1111-4111-8111-111111111111",
    },
  ],
  changes: [],
  actionsPagination: { total: 2, limit: 8, offset: 0, hasMore: false },
  complianceSummary: {
    compliantCount: 60,
    nonCompliantCount: 24,
    notApplicableCount: 8,
    unresolvedCount: 12,
    totalRulesEvaluated: 120,
  },
  assessments: [
    {
      assessmentId: "11111111-1111-4111-8111-111111111111",
      name: "Social network",
      lifecycleState: "ACTIVE",
      executionState: "ACTIVE",
      repository: {
        name: "social-app",
        owner: "org",
        pinnedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        latestCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        observedAt: "2026-11-18T00:00:00.000Z",
        freshnessStatus: "FRESHNESS_CURRENT",
        isStale: false,
      },
      ruleSet: {
        ruleSetVersionId: "11111111-1111-4111-8111-111111111111",
        ruleSetName: "Decree 13",
        ruleSetVersion: "v1",
        isCurrent: true,
      },
      trust: {
        isTrustworthy: true,
        trustStatus: "IN_PROGRESS",
        reason: null,
      },
      compliance: {
        compliantCount: 4,
        nonCompliantCount: 1,
        notApplicableCount: 1,
        unresolvedCount: 2,
      },
      report: {
        hasFinalReport: false,
        finalReportArtifactId: null,
        finalReportCreatedAt: null,
        isReady: false,
      },
      pendingActionCount: 1,
      updatedAt: "2026-11-18T14:10:00.000Z",
    },
    {
      assessmentId: "22222222-2222-4222-8222-222222222222",
      name: "Checkout & payment",
      lifecycleState: "ACTIVE",
      executionState: "COMPLETED",
      repository: {
        name: "checkout",
        owner: "org",
        pinnedCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        latestCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        observedAt: "2026-11-18T00:00:00.000Z",
        freshnessStatus: "FRESHNESS_CURRENT",
        isStale: false,
      },
      ruleSet: {
        ruleSetVersionId: "11111111-1111-4111-8111-111111111111",
        ruleSetName: "Decree 13",
        ruleSetVersion: "v1",
        isCurrent: true,
      },
      trust: {
        isTrustworthy: true,
        trustStatus: "TRUSTED",
        reason: null,
      },
      compliance: {
        compliantCount: 8,
        nonCompliantCount: 1,
        notApplicableCount: 1,
        unresolvedCount: 0,
      },
      report: {
        hasFinalReport: true,
        finalReportArtifactId: "22222222-2222-4222-8222-222222222222",
        finalReportCreatedAt: "2026-11-18T12:35:00.000Z",
        isReady: true,
      },
      pendingActionCount: 0,
      updatedAt: "2026-11-18T12:35:00.000Z",
    },
  ],
  pagination: { total: 2, limit: 50, offset: 0, hasMore: false },
  correlationId: "corr-test",
  generatedAt: "2026-11-18T15:00:00.000Z",
};

test("CoverageDonut and OutcomeLegend reconcile counts and handle empty denominator without NaN", () => {
  const segments = [
    { key: "COMPLIANT", label: "Compliant", count: 60, color: "#46d5b5" },
    { key: "NON_COMPLIANT", label: "Non-compliant", count: 24, color: "#fb808b" },
    { key: "NOT_APPLICABLE", label: "Not applicable", count: 8, color: "#b3c5d4" },
  ];

  const root = render(
    <div>
      <CoverageDonut
        segments={segments}
        total={120}
        centerValue={84}
        centerLabel="results ready"
        surface={DASHBOARD_SURFACES.dark}
      />
      <OutcomeLegend
        items={segments}
        denominator={120}
        surface={DASHBOARD_SURFACES.dark}
      />
    </div>,
  );

  const text = root.textContent ?? "";
  assert.match(text, /84results ready/);
  assert.match(text, /50%/);
  assert.match(text, /20%/);
  assert.match(text, /6\.7%/);

  const emptyRoot = render(
    <div>
      <CoverageDonut
        segments={segments.map((s) => ({ ...s, count: 0 }))}
        total={0}
        centerValue={0}
        centerLabel="No evaluations yet"
        surface={DASHBOARD_SURFACES.light}
      />
      <OutcomeLegend
        items={segments.map((s) => ({ ...s, count: 0 }))}
        denominator={0}
        surface={DASHBOARD_SURFACES.light}
      />
    </div>,
  );
  assert.doesNotMatch(emptyRoot.textContent ?? "", /NaN/);
  assert.match(emptyRoot.textContent ?? "", /0%/);
});

test("NextMetricCard shows arrow only when interactive and fires onAction", () => {
  let clicked = false;
  const interactive = render(
    <NextMetricCard
      variant={NEXT_METRIC_VARIANTS.attention}
      label="Open requests"
      value={2}
      context="Requires your response"
      onAction={() => {
        clicked = true;
      }}
    />,
  );
  assert.equal(interactive.querySelectorAll("svg").length, 1);
  const button = interactive.querySelector("button");
  assert.ok(button);
  act(() => {
    button.click();
  });
  assert.equal(clicked, true);

  const staticCard = render(
    <NextMetricCard
      variant={NEXT_METRIC_VARIANTS.ready}
      label="Reports ready"
      value={7}
      context="Review available results"
    />,
  );
  assert.equal(staticCard.querySelectorAll("svg").length, 0);
  assert.equal(staticCard.querySelector("button"), null);
});

test("DashboardBento reconciles populated and empty states in EN and VI", () => {
  setAppLocale(LOCALES[0]);
  const root = render(
    <DashboardBento
      overview={populatedOverview}
      reportsReadyCount={7}
      onOffsetChange={() => {}}
    />,
  );

  const text = root.textContent ?? "";
  assert.match(text, /Legal evaluation coverage/);
  assert.match(text, /Needs your attention/);
  assert.match(text, /Data storage location/);
  assert.match(text, /Social network/);
  assert.match(text, /6 \/ 8/);
  assert.match(text, /10 \/ 10/);
  assert.match(text, /Reports ready/);

  setAppLocale(LOCALES[1]);
  const viRoot = render(
    <DashboardBento
      overview={{
        ...populatedOverview,
        actions: [],
        actionsPagination: { total: 0, limit: 8, offset: 0, hasMore: false },
        assessments: [],
        complianceSummary: {
          compliantCount: 0,
          nonCompliantCount: 0,
          notApplicableCount: 0,
          unresolvedCount: 0,
          totalRulesEvaluated: 0,
        },
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      }}
      reportsReadyCount={0}
      onOffsetChange={() => {}}
    />,
  );
  const viText = viRoot.textContent ?? "";
  assert.match(viText, /Phạm vi đánh giá pháp lý/);
  assert.match(viText, /Cần bạn xử lý/);
  assert.match(viText, /Assessment gần đây/);
  assert.doesNotMatch(viText, /NaN/);
});

test("QuickActionsDialog renders workspace destinations and triggers Settings callback", () => {
  setAppLocale(LOCALES[0]);
  let settingsOpened = false;
  const root = render(
    <QuickActionsDialog
      open={true}
      onOpenChange={() => {}}
      onOpenSettings={() => {
        settingsOpened = true;
      }}
    />,
  );

  const text = document.body.textContent ?? root.textContent ?? "";
  assert.match(text, /Quick actions/);
  assert.match(text, /Information requests/);
  assert.match(text, /Legal Library/i);

  const settingsButton = Array.from(document.body.querySelectorAll("button")).find(
    (btn) => btn.textContent?.includes("Settings"),
  );
  assert.ok(settingsButton);
  act(() => {
    settingsButton.click();
  });
  assert.equal(settingsOpened, true);
});
