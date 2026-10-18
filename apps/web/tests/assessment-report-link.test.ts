import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setAppLocale } from "../src/lib/locale.ts";
import { AssessmentReportActions } from "../src/features/assessment-runtime/components/molecules/assessment-report-actions.tsx";

setAppLocale("en");

test("V1 report actions expose view and JSON only", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssessmentReportActions, {
      assessmentId: "a 1",
      artifactId: "art 1",
    }),
  );
  assert.match(
    html,
    /<a [^>]*href="\/assessments\/a%201\/report"[^>]*>[\s\S]*View report/,
  );
  assert.match(
    html,
    /<a [^>]*href="\/api\/assessments\/a%201\/artifacts\/art%201\/download"[^>]*>[\s\S]*Download report/,
  );
  assert.doesNotMatch(html, /data-report-action="download-pdf"/);
  assert.doesNotMatch(html, /role=/);
});

test("V2 report actions add PDF to the native JSON download link", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssessmentReportActions, {
      assessmentId: "a 1",
      artifactId: "art 1",
      pdfSupported: true,
    }),
  );
  assert.match(html, /data-report-action="download"/);
  assert.match(
    html,
    /<a [^>]*href="\/api\/assessments\/a%201\/artifacts\/art%201\/report\.pdf"[^>]*>[\s\S]*Download PDF/,
  );
});
