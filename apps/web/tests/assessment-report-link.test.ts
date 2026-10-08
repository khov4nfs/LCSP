import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";
import { AssessmentReportLink } from "../src/features/workspace/components/molecules/assessment-report-link.tsx";

const detail = (state: string, artifactState: string) =>
  ({
    assessment_id: "a1",
    lifecycle: { state },
    case: { artifacts: [{ artifactId: "art 1", lifecycleState: artifactState }] },
  }) as unknown as AssessmentDetail;

test("complete assessment renders a native download anchor, not a role=button", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssessmentReportLink, {
      assessment: detail(ASSESSMENT_LIFECYCLE_STATES.COMPLETE, ARTIFACT_LIFECYCLE_STATES.ACTIVE),
    }),
  );
  assert.match(html, /^<a [^>]*href="\/api\/assessments\/a1\/artifacts\/art%201\/download"/);
  assert.doesNotMatch(html, /role=/);
});

test("no link before COMPLETE or without an ACTIVE artifact", () => {
  for (const [s, a] of [
    [ASSESSMENT_LIFECYCLE_STATES.ACTIVE, ARTIFACT_LIFECYCLE_STATES.ACTIVE],
    [ASSESSMENT_LIFECYCLE_STATES.COMPLETE, ARTIFACT_LIFECYCLE_STATES.BUILDING],
  ] as const)
    assert.equal(renderToStaticMarkup(React.createElement(AssessmentReportLink, { assessment: detail(s, a) })), "");
});
