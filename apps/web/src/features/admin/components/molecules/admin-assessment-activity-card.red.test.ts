import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminAssessmentActivityCard } from "./admin-assessment-activity-card";

test("A-03 zero admin metrics render as zero without fixture totals", () => {
  // Why: Zero is a valid count, but truthy fallback substitutes fictional dashboard numbers.
  // How: Server-render the production card with an explicit empty result.
  // Invariant: An empty cohort cannot display 876 users, 312 starts or 270 completions.
  const html = renderToStaticMarkup(
    createElement(AdminAssessmentActivityCard, {
      points: [],
      totalUsersCount: 0,
      totalStarted: 0,
      totalCompleted: 0,
    }),
  );
  assert.doesNotMatch(html, /876|312|270/);
  assert.doesNotMatch(html, /Started: 66/);
  assert.match(html, /0 (completed in cohort|hoàn thành trong nhóm)/);
});

test("activity bars keep accessible counts without HTML title hints", () => {
  // Why: Removing sample bars must not remove the meaning of real activity bars.
  // How: Render a real point and inspect its accessible label and hover primitive.
  // Invariant: Bar counts remain localized and no browser title attribute is introduced.
  const html = renderToStaticMarkup(
    createElement(AdminAssessmentActivityCard, {
      points: [
        {
          date: "2026-09-14",
          timestamp: "2026-09-14T00:00:00.000Z",
          startedCount: 2,
          completedCount: 1,
        },
      ],
      totalStarted: 2,
      totalCompleted: 1,
    }),
  );
  assert.doesNotMatch(html, /\stitle=/);
  assert.match(html, /aria-label="[^"]*2[^"]*1/);
});
