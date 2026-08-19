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
      technical_evidence: [
        {
          kind: "HUMAN_REVIEW",
          label: "Manual approval",
          file_path: "src/review.ts",
          symbol_ref: "approveRequest",
          start_line: 42,
          end_line: 48,
        },
      ],
      source_chunk_ids: ["LAW-134-2025-QH15:art-14::cl-2"],
      source_locators: ["art-14::cl-2"],
      legal_provisions: [
        {
          document_id: "LAW-134-2025-QH15",
          locator: "art-14::cl-2",
          article_number: "14",
          clause_number: "2",
          point_code: null,
          content: "2. Yêu cầu phải có cơ chế xem xét của con người.",
        },
      ],
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
      technical_evidence: [
        {
          kind: "LOG_SINK",
          label: "Audit log",
          file_path: "src/audit.ts",
          symbol_ref: "writeAuditLog",
          start_line: 15,
          end_line: 15,
        },
      ],
      source_chunk_ids: ["LAW-134-2025-QH15:art-12::cl-1"],
      source_locators: ["art-12::cl-1"],
      legal_provisions: [
        {
          document_id: "LAW-134-2025-QH15",
          locator: "art-12::cl-1",
          article_number: "12",
          clause_number: "1",
          point_code: null,
          content: "1. Hệ thống phải lưu nhật ký phục vụ kiểm tra.",
        },
      ],
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

test("direct EngineeringRule result exposes readable evidence and legal provisions", () => {
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
    assert.equal(result.data.evaluations[0]?.technicalEvidenceCount, 1);
    assert.deepEqual(result.data.evaluations[0]?.technicalEvidence, [
      {
        kind: "HUMAN_REVIEW",
        label: "Manual approval",
        filePath: "src/review.ts",
        symbolRef: "approveRequest",
        startLine: 42,
        endLine: 48,
      },
    ]);
    assert.deepEqual(result.data.evaluations[0]?.legalProvisions, [
      {
        documentId: "LAW-134-2025-QH15",
        locator: "art-14::cl-2",
        articleNumber: "14",
        clauseNumber: "2",
        pointCode: null,
        content: "2. Yêu cầu phải có cơ chế xem xét của con người.",
      },
    ]);
    assert.deepEqual(getClassificationActionVisibility(result.data), {
      showFinalReport: true,
      showGapAnalysis: true,
      showRerunClassification: false,
    });
  }
});

test("unknown EngineeringRule outcomes remain guardrail-passed when runtime completed", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: "passed",
      classification_result: {
        ...directResult,
        status: "COMPLETE",
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
        limitations: [],
      },
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "passed");
    assert.equal(result.data.evaluations[0]?.status, "UNKNOWN");
    assert.equal(getClassificationActionVisibility(result.data).showFinalReport, true);
    assert.equal(getClassificationActionVisibility(result.data).showGapAnalysis, true);
  }
});

test("degraded state remains reserved for partial runtime execution", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: "degraded",
      classification_result: {
        ...directResult,
        status: "PARTIAL",
        limitations: ["ENGINEERING_INVESTIGATION_FAILED"],
      },
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") assert.equal(result.data.state, "degraded");
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
