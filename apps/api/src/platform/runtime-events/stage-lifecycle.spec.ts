import { describe, expect, it } from "@jest/globals";
import {
  ASSESSMENT_STAGE_LIFECYCLE_STATES,
  type AssessmentRuntimeEngineeringProgress,
} from "@lcsp/contracts/evidence";

import {
  deriveStageLifecycles,
  type StageLifecycleInput,
} from "./stage-lifecycle.js";

const STATES = ASSESSMENT_STAGE_LIFECYCLE_STATES;

function progress(
  overrides: Partial<AssessmentRuntimeEngineeringProgress> = {},
) {
  return [
    {
      assessmentId: "assessment-1",
      runId: "run-1",
      contextRevision: 4,
      engineeringRuleCount: 41,
      eligibleCount: 40,
      completed: 0,
      needsContext: 0,
      unresolved: 0,
      failed: 0,
      ...overrides,
    },
  ];
}

function derive(overrides: Partial<StageLifecycleInput> = {}) {
  const input: StageLifecycleInput = {
    assessmentIds: ["assessment-1"],
    scanJobs: [
      {
        assessmentId: "assessment-1",
        status: "COMPLETED",
        updatedAt: "2026-09-28T10:00:00.000Z",
      },
    ],
    evidenceReports: [{ assessmentId: "assessment-1", status: "ACCEPTED" }],
    interviewThreads: [
      {
        assessmentId: "assessment-1",
        contextRevision: 4,
        processedRevision: 4,
        activeQuestionId: null,
      },
    ],
    engineeringProgress: progress(),
    liveAssessmentIds: new Set<string>(),
    ...overrides,
  };
  return deriveStageLifecycles(input)[0];
}

describe("deriveStageLifecycles", () => {
  it("keeps the scanner done while a downstream dispatch is active", () => {
    // Repository analysis runs under the same scan job and post SCAN-tagged
    // bookkeeping; that must never reopen a finished scan.
    const lifecycle = derive({
      liveAssessmentIds: new Set(["assessment-1"]),
    });

    expect(lifecycle.scanner.state).toBe(STATES.done);
    expect(lifecycle.scanner.source).toBe("acceptedEvidence");
    expect(lifecycle.ruleAnalysis.state).toBe(STATES.running);
  });

  it("keeps the investigator queued while the scan is the only thing running", () => {
    // Reproduces the sidebar showing Scanner and Investigate both running: a
    // live Scanner dispatch made `isLive` true for every artifact-less stage.
    const lifecycle = derive({
      scanJobs: [
        {
          assessmentId: "assessment-1",
          status: "RUNNING",
          updatedAt: "2026-09-28T10:00:00.000Z",
        },
      ],
      evidenceReports: [],
      engineeringProgress: [],
      liveAssessmentIds: new Set(["assessment-1"]),
    });

    expect(lifecycle.scanner.state).toBe(STATES.running);
    expect(lifecycle.ruleAnalysis.state).toBe(STATES.queued);
    expect(lifecycle.gate.state).toBe(STATES.queued);
  });

  it("keeps the investigator queued until the interview has confirmed context", () => {
    const lifecycle = derive({
      engineeringProgress: [],
      interviewThreads: [
        {
          assessmentId: "assessment-1",
          contextRevision: 5,
          processedRevision: 4,
          activeQuestionId: null,
        },
      ],
      liveAssessmentIds: new Set(["assessment-1"]),
    });

    expect(lifecycle.interview.state).toBe(STATES.running);
    expect(lifecycle.ruleAnalysis.state).toBe(STATES.queued);
  });

  it("does not mark the investigator or gate done while rules wait for context", () => {
    const lifecycle = derive({
      engineeringProgress: progress({ completed: 1, needsContext: 39 }),
    });

    expect(lifecycle.ruleAnalysis.state).toBe(STATES.needsContext);
    expect(lifecycle.gate.state).toBe(STATES.queued);
  });

  it("starts the investigator once scan and context are ready and the dispatch is live", () => {
    const lifecycle = derive({
      // Progress exists; no rule has settled yet.
      engineeringProgress: progress({ eligibleCount: 0 }),
      liveAssessmentIds: new Set(["assessment-1"]),
    });

    expect(lifecycle.ruleAnalysis.state).toBe(STATES.running);
  });

  it("does not run the investigator on a live scan with no evidence", () => {
    const lifecycle = derive({
      engineeringProgress: [],
      evidenceReports: [],
      scanJobs: [
        {
          assessmentId: "assessment-1",
          status: "QUEUED",
          updatedAt: "2026-09-28T10:00:00.000Z",
        },
      ],
      liveAssessmentIds: new Set(["assessment-1"]),
    });

    expect(lifecycle.scanner.state).toBe(STATES.queued);
    expect(lifecycle.ruleAnalysis.state).toBe(STATES.queued);
  });

  it("shows the scanner running only for a real active scan job", () => {
    const lifecycle = derive({
      scanJobs: [
        {
          assessmentId: "assessment-1",
          status: "RUNNING",
          updatedAt: "2026-09-28T11:00:00.000Z",
        },
      ],
      evidenceReports: [],
    });

    expect(lifecycle.scanner.state).toBe(STATES.running);
    expect(lifecycle.scanner.source).toBe("scanJob");
  });

  it("prefers the newest scan job when an assessment was rescanned", () => {
    const lifecycle = derive({
      scanJobs: [
        {
          assessmentId: "assessment-1",
          status: "FAILED",
          updatedAt: "2026-09-28T09:00:00.000Z",
        },
        {
          assessmentId: "assessment-1",
          status: "RUNNING",
          updatedAt: "2026-09-28T12:00:00.000Z",
        },
      ],
      evidenceReports: [],
    });

    expect(lifecycle.scanner.state).toBe(STATES.running);
  });

  it("reports the interview waiting only while a question is open", () => {
    expect(derive().interview.state).toBe(STATES.contextConfirmed);
    expect(
      derive({
        interviewThreads: [
          {
            assessmentId: "assessment-1",
            contextRevision: 5,
            processedRevision: 4,
            activeQuestionId: "question-1",
          },
        ],
      }).interview.state,
    ).toBe(STATES.waitingForCustomer);
  });

  it("separates partial claims from complete claims", () => {
    expect(
      derive({
        engineeringProgress: progress({ completed: 40 }),
      }).ruleAnalysis.state,
    ).toBe(STATES.claimsComplete);

    expect(
      derive({
        engineeringProgress: progress({
          completed: 38,
          unresolved: 1,
          failed: 1,
        }),
      }).ruleAnalysis.state,
    ).toBe(STATES.claimsPartial);
  });

  it("opens the gate only once no selected rule is still pending", () => {
    expect(derive().gate.state).toBe(STATES.queued);
    expect(
      derive({
        engineeringProgress: progress({ completed: 40 }),
      }).gate.state,
    ).toBe(STATES.ready);
  });

  it("does not crash for an assessment with no artifacts at all", () => {
    const lifecycle = derive({
      scanJobs: [],
      evidenceReports: [],
      interviewThreads: [],
      engineeringProgress: [],
    });

    expect(lifecycle.scanner.state).toBe(STATES.queued);
    expect(lifecycle.interview.state).toBe(STATES.queued);
    expect(lifecycle.ruleAnalysis.state).toBe(STATES.queued);
    expect(lifecycle.gate.state).toBe(STATES.queued);
  });
});
