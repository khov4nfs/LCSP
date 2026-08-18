import * as assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import {
  getClassificationActionVisibility,
  sanitizeAssessmentDetailPayload,
  toClassificationStatusOutcome,
} from "../src/lib/api/classification-client.ts";

const directResult = {
  mode: "ENGINEERING_RULE_EVALUATION",
  status: "COMPLETE",
  engineering_summary: {
    compliant: 1,
    non_compliant: 1,
    unknown: 0,
    total: 2,
  },
  evaluations: [
    {
      engineering_rule_id: "ENG-HUMAN-REVIEW",
      legal_rule_id: "LAW-134-ART-14",
      concept: "HUMAN_REVIEW",
      status: "NON_COMPLIANT",
      reason: "Repository evidence demonstrates that the engineering requirement is not met.",
      evidence_refs: ["graph:path:1"],
      source_chunk_ids: ["LAW-134:art-14::cl-2"],
      source_locators: ["art-14::cl-2"],
      confidence: 0.95,
      limitations: [],
    },
    {
      engineering_rule_id: "ENG-LOGGING",
      legal_rule_id: "LAW-134-ART-12",
      concept: "INCIDENT_LOGGING",
      status: "COMPLIANT",
      reason: "Repository evidence demonstrates that the engineering requirement is met.",
      evidence_refs: ["graph:path:2"],
      source_chunk_ids: ["LAW-134:art-12::cl-1"],
      source_locators: ["art-12::cl-1"],
      confidence: 0.9,
      limitations: [],
    },
  ],
  limitations: [],
  technical_evidence_report_id: "report-1",
  snapshot_id: "snapshot-1",
};

test("classification outcome maps locked state correctly", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: true },
      guardrail_status: null,
      classification_result: null,
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "locked");
    assert.equal(result.data.hasClassification, false);
  }
});

test("direct EngineeringRule result exposes evaluations and report actions", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: "passed",
      classification_result: directResult,
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "passed");
    assert.equal(result.data.hasClassification, true);
    assert.equal(result.data.engineeringSummary?.compliant, 1);
    assert.equal(result.data.engineeringSummary?.nonCompliant, 1);
    assert.equal(result.data.evaluations[0]?.status, "NON_COMPLIANT");
    assert.deepEqual(result.data.references, [
      "art-14::cl-2",
      "LAW-134:art-14::cl-2",
      "art-12::cl-1",
      "LAW-134:art-12::cl-1",
    ]);
    assert.deepEqual(getClassificationActionVisibility(result.data), {
      showFinalReport: true,
      showGapAnalysis: true,
      showRerunClassification: false,
    });
  }
});

test("degraded direct assessment remains reportable with explicit unknowns", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: "degraded",
      classification_result: {
        ...directResult,
        status: "PARTIAL",
        engineering_summary: {
          compliant: 0,
          non_compliant: 0,
          unknown: 1,
          total: 1,
        },
        evaluations: [
          {
            ...directResult.evaluations[0],
            status: "UNKNOWN",
            limitations: ["DYNAMIC_PATH_UNRESOLVED"],
          },
        ],
        limitations: ["DYNAMIC_PATH_UNRESOLVED"],
      },
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "degraded");
    assert.equal(result.data.evaluations[0]?.status, "UNKNOWN");
    assert.equal(getClassificationActionVisibility(result.data).showFinalReport, true);
    assert.equal(getClassificationActionVisibility(result.data).showGapAnalysis, true);
  }
});

test("processing is returned after evidence acceptance while worker is still running", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: null,
      classification_result: null,
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "processing");
    assert.equal(result.data.hasClassification, false);
  }
});

test("classification outcome maps auth errors to redirect", () => {
  assert.deepEqual(
    toClassificationStatusOutcome(
      { problem: { code: AUTH_ERROR_CODES.sessionInvalid } },
      false,
      401,
    ),
    { kind: "redirect", location: "/sign-in" },
  );
});

test("sanitizeAssessmentDetailPayload validates direct evaluation shape", () => {
  const payload = sanitizeAssessmentDetailPayload({
    readiness_state: { classification_locked: false },
    guardrail_status: "passed",
    classification_result: directResult,
  });

  assert.notEqual(payload, null);
  assert.equal(payload?.classification_result?.evaluations.length, 2);
  assert.equal(
    payload?.classification_result?.technical_evidence_report_id,
    "report-1",
  );
});

test("sanitizeAssessmentDetailPayload rejects invalid direct evaluation status", () => {
  assert.equal(
    sanitizeAssessmentDetailPayload({
      readiness_state: { classification_locked: false },
      guardrail_status: "passed",
      classification_result: {
        ...directResult,
        evaluations: [
          {
            ...directResult.evaluations[0],
            status: "VIOLATION",
          },
        ],
      },
    }),
    null,
  );
});
