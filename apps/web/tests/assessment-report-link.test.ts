import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setAppLocale } from "../src/lib/locale.ts";
import { AssessmentReportActions } from "../src/features/assessment-runtime/components/molecules/assessment-report-actions.tsx";

setAppLocale("en");

test("V1 report actions retain the report and expose a separate PDF download", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssessmentReportActions, {
      assessmentId: "a 1",
      artifactId: "art 1",
    }),
  );
  assert.match(
    html,
    /<a\b(?=[^>]*data-report-action="view")(?=[^>]*href="\/assessments\/a%201\/report\?artifactId=art%201")[^>]*>[\s\S]*View report<\/a>/,
  );
  assert.match(
    html,
    /<a [^>]*href="\/api\/assessments\/a%201\/artifacts\/art%201\/download"[^>]*>[\s\S]*Download report/,
  );
  assert.match(
    html,
    /<a [^>]*href="\/api\/assessments\/a%201\/artifacts\/art%201\/report\.pdf"[^>]*>[\s\S]*Download PDF/,
  );
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

test("PDF export action uses the Vietnamese label for Vietnamese users", () => {
  setAppLocale("vi");
  try {
    const html = renderToStaticMarkup(
      React.createElement(AssessmentReportActions, {
        assessmentId: "assessment-1",
        artifactId: "artifact-1",
        pdfSupported: true,
      }),
    );
    assert.match(html, /Tải PDF/);
  } finally {
    setAppLocale("en");
  }
});
