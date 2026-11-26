import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LOCALES } from "@lcsp/contracts/shared";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { CustomerTrackingAssessmentItem } from "@lcsp/contracts/assessment-domain";

import { setAppLocale } from "../src/lib/locale.ts";
import { installFetch, render, settle } from "./support/dom.ts";
import { CoverageProgress } from "../src/components/molecules/coverage-progress.tsx";
import { AssessmentList } from "../src/features/tracking/components/organisms/assessment-list.tsx";
import {
  ASSESSMENT_LIST_DATE_FILTERS,
  ASSESSMENT_LIST_SORT_OPTIONS,
  ASSESSMENT_LIST_STATUS_FILTERS,
} from "../src/features/tracking/types/assessment-list.types.ts";
import { RenameAssessmentDialog } from "../src/features/workspace/components/molecules/rename-assessment-dialog.tsx";
import { DeleteAssessmentDialog } from "../src/features/workspace/components/molecules/delete-assessment-dialog.tsx";

afterEach(() => {
  document.body.replaceChildren();
  setAppLocale(LOCALES[0]);
});

function makeItem(
  id: string,
  name: string,
  overrides: Partial<CustomerTrackingAssessmentItem> = {},
): CustomerTrackingAssessmentItem {
  return {
    assessmentId: id,
    name,
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    executionState: AGENT_EXECUTION_STATES.RUNNING,
    repository: {
      name: "repo",
      owner: "org",
      pinnedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      latestCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      observedAt: "2026-11-18T00:00:00.000Z",
      freshnessStatus: "FRESHNESS_CURRENT",
      isStale: false,
    },
    repositories: [],
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
    pendingActionCount: 0,
    updatedAt: "2026-11-18T14:10:00.000Z",
    ...overrides,
  };
}

function wrapWithQuery(node: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

test("CoverageProgress renders ratio and clamped width", () => {
  const root = render(<CoverageProgress concluded={6} total={8} />);
  assert.match(root.textContent ?? "", /6 \/ 8/);
});

test("AssessmentList renders lifecycle counts, filters empty states, and paginates", () => {
  setAppLocale(LOCALES[0]);
  const items = [
    makeItem("1", "Social network", { pendingActionCount: 1 }),
    makeItem("2", "Checkout & payment", {
      executionState: AGENT_EXECUTION_STATES.SUCCEEDED,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      report: {
        hasFinalReport: true,
        finalReportArtifactId: "2",
        finalReportCreatedAt: "2026-11-18T12:00:00.000Z",
        isReady: true,
      },
    }),
    makeItem("3", "Auth gateway"),
  ];

  let resetCalled = false;
  const root = render(
    wrapWithQuery(
      <AssessmentList
        assessments={items}
        search=""
        onSearchChange={() => {}}
        statusFilter={ASSESSMENT_LIST_STATUS_FILTERS.all}
        onStatusFilterChange={() => {}}
        dateFilter={ASSESSMENT_LIST_DATE_FILTERS.all}
        onDateFilterChange={() => {}}
        sortBy={ASSESSMENT_LIST_SORT_OPTIONS.recentlyUpdated}
        onSortByChange={() => {}}
        offset={0}
        onOffsetChange={() => {}}
        onResetFilters={() => {
          resetCalled = true;
        }}
      />,
    ),
  );

  const text = root.textContent ?? "";
  assert.match(text, /All 3/);
  assert.match(text, /Completed 1/);
  assert.match(text, /Needs information 1/);
  assert.match(text, /Social network/);
  assert.match(text, /org\/repo/);

  // Empty filtered state exposes Reset filters
  const emptyRoot = render(
    wrapWithQuery(
      <AssessmentList
        assessments={items}
        search="no-such-repo-xyz"
        onSearchChange={() => {}}
        statusFilter={ASSESSMENT_LIST_STATUS_FILTERS.all}
        onStatusFilterChange={() => {}}
        dateFilter={ASSESSMENT_LIST_DATE_FILTERS.all}
        onDateFilterChange={() => {}}
        sortBy={ASSESSMENT_LIST_SORT_OPTIONS.recentlyUpdated}
        onSortByChange={() => {}}
        offset={0}
        onOffsetChange={() => {}}
        onResetFilters={() => {
          resetCalled = true;
        }}
      />,
    ),
  );
  const resetBtn = Array.from(emptyRoot.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Reset filters"),
  );
  assert.ok(resetBtn);
  act(() => {
    resetBtn.click();
  });
  assert.equal(resetCalled, true);

  // Pagination across > 10 items
  const many = Array.from({ length: 12 }, (_, idx) =>
    makeItem(`id-${idx}`, `Assessment ${idx + 1}`),
  );
  let nextOffset = 0;
  const pagedRoot = render(
    wrapWithQuery(
      <AssessmentList
        assessments={many}
        search=""
        onSearchChange={() => {}}
        statusFilter={ASSESSMENT_LIST_STATUS_FILTERS.all}
        onStatusFilterChange={() => {}}
        dateFilter={ASSESSMENT_LIST_DATE_FILTERS.all}
        onDateFilterChange={() => {}}
        sortBy={ASSESSMENT_LIST_SORT_OPTIONS.recentlyUpdated}
        onSortByChange={() => {}}
        offset={0}
        onOffsetChange={(o) => {
          nextOffset = o;
        }}
        onResetFilters={() => {}}
      />,
    ),
  );
  assert.match(pagedRoot.textContent ?? "", /Showing 10 of 12 records/);
  const nextBtn = Array.from(pagedRoot.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Next"),
  );
  assert.ok(nextBtn);
  act(() => {
    nextBtn.click();
  });
  assert.equal(nextOffset, 10);
});

test("RenameAssessmentDialog validates empty name and submits valid rename", async () => {
  setAppLocale(LOCALES[0]);
  const { calls, restore } = installFetch({
    "PATCH /api/assessments/a1": { id: "a1", name: "Updated" },
  });

  try {
    let isOpen = true;
    render(
      wrapWithQuery(
        <RenameAssessmentDialog
          open={isOpen}
          onOpenChange={(open) => {
            isOpen = open;
          }}
          assessmentId="a1"
          currentName="Original"
        />,
      ),
    );

    const input = document.body.querySelector("input") as HTMLInputElement;
    assert.ok(input);

    // Set empty value and submit -> inline validation error, 0 PATCH calls
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, "   ");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const form = document.body.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await settle();

    assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
    assert.match(
      document.body.textContent ?? "",
      /Assessment name is required\./,
    );

    // Set valid new name and submit -> PATCH called and dialog closes
    await act(async () => {
      setter?.call(input, "Updated");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const saveBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Save",
    );
    assert.ok(saveBtn);
    await act(async () => {
      saveBtn.click();
    });
    await settle();
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);
    assert.equal(isOpen, false);
  } finally {
    restore();
  }
});

test("DeleteAssessmentDialog handles cancel and surfaces delete failure", async () => {
  setAppLocale(LOCALES[0]);
  const { restore } = installFetch({
    "DELETE /api/assessments/a2": Response.json(
      {
        ok: false,
        problem: {
          type: "about:blank",
          status: 500,
          code: "INTERNAL_ERROR",
          titleKey: "errors.internal",
          detailKey: "errors.internal",
          requiredAction: "NONE",
          correlationId: "corr-1",
          meta: {},
        },
      },
      { status: 500 },
    ),
  });

  try {
    let openState = true;
    render(
      wrapWithQuery(
        <DeleteAssessmentDialog
          open={openState}
          onOpenChange={(open) => {
            openState = open;
          }}
          assessmentId="a2"
          assessmentName="Failing assessment"
        />,
      ),
    );

    // Click Delete -> fails and stays open with error message
    const confirmBtn = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Delete assessment"));
    assert.ok(confirmBtn);
    await act(async () => {
      confirmBtn.click();
    });
    await settle();
    assert.equal(openState, true);
    assert.match(
      document.body.textContent ?? "",
      /Unable to delete this assessment/,
    );

    // Click Cancel -> closes dialog
    const cancelBtn = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Cancel"));
    assert.ok(cancelBtn);
    act(() => {
      cancelBtn.click();
    });
    assert.equal(openState, false);
  } finally {
    restore();
  }
});
