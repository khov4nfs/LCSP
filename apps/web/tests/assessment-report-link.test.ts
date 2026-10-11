import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setAppLocale } from "../src/lib/locale.ts";
import { AssessmentReportActions } from "../src/features/assessment-runtime/components/molecules/assessment-report-actions.tsx";

setAppLocale("en");

test("report actions are native links: view in the app, download the stored artifact", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssessmentReportActions, {
      assessmentId: "a 1",
      artifactId: "art 1",
    }),
  );
  assert.match(html, /<a [^>]*href="\/assessments\/a%201\/report"[^>]*>[\s\S]*View report/);
  assert.match(
    html,
    /<a [^>]*href="\/api\/assessments\/a%201\/artifacts\/art%201\/download"[^>]*>[\s\S]*Download report/,
  );
  assert.doesNotMatch(html, /role=/);
});
