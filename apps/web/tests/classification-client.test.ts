import * as assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import {
  getClassificationActionVisibility,
  sanitizeAssessmentDetailPayload,
  toClassificationStatusOutcome,
} from "../src/lib/api/classification-client.ts";

test("classification outcome maps locked state correctly", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: true },
      guardrail_status: null,
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "locked");
    assert.equal(result.data.hasClassification, false);
    assert.equal(result.data.titleKey, "pages.classification.states.lockedTitle");
    assert.equal(result.data.badgeKey, "pages.classification.states.lockedBadge");
    assert.equal(result.data.descriptionKey, "pages.classification.states.lockedDescription");
  }
});

test("classification outcome maps passed state with real result data and final report action", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: "passed",
      classification_result: {
        risk_level: "HIGH",
        applicability_assessment: "applicable",
        citation_basis: ["LAW-134-2025-QH15::art-33"],
        rationale: "The applicable legal rule is backed by the cited article.",
      },
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "passed");
    assert.equal(result.data.hasClassification, true);
    assert.equal(result.data.summaryKey, "pages.classification.states.passedSummary");
    assert.equal(
      result.data.summaryText,
      "The applicable legal rule is backed by the cited article.",
    );
    assert.deepEqual(result.data.references, [
      "LAW-134-2025-QH15::art-33",
    ]);
    assert.deepEqual(getClassificationActionVisibility(result.data), {
      showFinalReport: true,
      showGapAnalysis: true,
      showRerunClassification: false,
    });
  }
});

test("processing classification exposes a pending Manager profile review", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: null,
      can_rerun_classification: false,
      verified_profile_review: {
        verified_profile_id: "vp-1",
        status: "PENDING_APPROVAL",
        provider_version: "lcsp.verified-profile-worker.v1",
        verified_claims: [
          {
            claim_id: "claim-1",
            claim_category: "MODEL_INVOCATION",
            evidence_refs: ["evidence-1"],
          },
        ],
        verification_source: "TECHNICAL_PLUS_WIZARD",
        conflict_resolutions: [{ conflict_id: "conflict-1", status: "RESOLVED" }],
        gates_passed_at: { conflicts_resolved: "2026-08-11T00:00:00.000Z" },
        evidence_chain_integrity: true,
        created_at: "2026-08-11T00:01:00.000Z",
        approved_at: null,
        approved_by_id: null,
      },
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "processing");
    assert.equal(result.data.verifiedProfileReview?.verifiedProfileId, "vp-1");
    assert.equal(result.data.verifiedProfileReview?.status, "PENDING_APPROVAL");
    assert.equal(result.data.verifiedProfileReview?.evidenceChainIntegrity, true);
    assert.deepEqual(result.data.verifiedProfileReview?.verifiedClaims[0], {
      claim_id: "claim-1",
      claim_category: "MODEL_INVOCATION",
      evidence_refs: ["evidence-1"],
    });
  }
});

test("processing classification exposes a retry action only before a result exists", () => {
  const result = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: null,
      can_rerun_classification: true,
    },
    true,
    200,
  );

  assert.equal(result.kind, "loaded");
  if (result.kind === "loaded") {
    assert.equal(result.data.state, "processing");
    assert.deepEqual(getClassificationActionVisibility(result.data), {
      showFinalReport: false,
      showGapAnalysis: false,
      showRerunClassification: true,
    });
  }
});

test("degraded and blocked states keep business language and gated actions", () => {
  const degraded = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: "degraded",
    },
    true,
    200,
  );
  const blocked = toClassificationStatusOutcome(
    {
      readiness_state: { classification_locked: false },
      guardrail_status: "blocked",
    },
    true,
    200,
  );

  assert.equal(degraded.kind, "loaded");
  assert.equal(blocked.kind, "loaded");
  if (degraded.kind === "loaded" && blocked.kind === "loaded") {
    assert.equal(degraded.data.state, "degraded");
    assert.equal(blocked.data.state, "blocked");
    assert.equal(getClassificationActionVisibility(degraded.data).showFinalReport, false);
    assert.equal(getClassificationActionVisibility(blocked.data).showFinalReport, false);
    assert.equal(getClassificationActionVisibility(degraded.data).showGapAnalysis, true);
    assert.equal(getClassificationActionVisibility(blocked.data).showGapAnalysis, true);

    const combinedText = JSON.stringify([degraded.data, blocked.data]);
    assert.doesNotMatch(combinedText, /risk|severity|violation|non-compliant|certified|compliant/i);
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

test("sanitizeAssessmentDetailPayload accepts valid classification payloads", () => {
  const payload = sanitizeAssessmentDetailPayload({
    readiness_state: { classification_locked: false },
    guardrail_status: "passed",
    classification_result: {
      risk_level: "HIGH",
      applicability_assessment: "applicable",
      citation_basis: ["chunk-1", " chunk-2 "],
      rationale: "Citation-backed rationale",
    },
  });

  assert.deepEqual(payload, {
    readiness_state: { classification_locked: false },
    guardrail_status: "passed",
    classification_result: {
      risk_level: "HIGH",
      applicability_assessment: "applicable",
      citation_basis: ["chunk-1", "chunk-2"],
      rationale: "Citation-backed rationale",
    },
  });
});

test("sanitizeAssessmentDetailPayload rejects invalid payloads", () => {
  assert.equal(
    sanitizeAssessmentDetailPayload({
      readiness_state: { classification_locked: "true" },
      guardrail_status: 123,
    }),
    null,
  );
  assert.equal(
    sanitizeAssessmentDetailPayload({
      readiness_state: { classification_locked: false },
      guardrail_status: "passed",
      classification_result: {
        citation_basis: ["chunk-1", 2],
      },
    }),
    null,
  );
  assert.equal(
    sanitizeAssessmentDetailPayload({
      readiness_state: { classification_locked: false },
      guardrail_status: null,
      verified_profile_review: {
        verified_profile_id: "vp-1",
        status: "PENDING_APPROVAL",
        provider_version: "worker-v1",
        verified_claims: "not-an-array",
        conflict_resolutions: [],
        gates_passed_at: {},
        evidence_chain_integrity: true,
        created_at: "2026-08-11T00:01:00.000Z",
        approved_at: null,
        approved_by_id: null,
        verification_source: null,
      },
    }),
    null,
  );
});
