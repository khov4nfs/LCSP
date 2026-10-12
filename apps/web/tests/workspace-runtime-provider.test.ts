import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
} from "@lcsp/contracts/assessment";
import {
  parseRuntimeEvent,
  runtimeFingerprint,
} from "../src/features/workspace/utils/workspace-runtime-parser.ts";

test("workspace runtime parser preserves canonical ALS/AES and event-only activity", () => {
  const assessmentId = "11111111-1111-4111-8111-111111111111";
  const executionId = "22222222-2222-4222-8222-222222222222";
  const parsed = parseRuntimeEvent(
    JSON.stringify({
      emitted_at: "2026-08-13T11:00:00.000Z",
      canonical_assessments: [
        {
          assessmentId,
          lifecycle: { state: "ACTIVE", assessmentRevision: 3 },
          runtime: {
            threadId: "33333333-3333-4333-8333-333333333333",
            rootAgentVersion: "runtime-v2",
            checkpointNamespace: "44444444-4444-4444-8444-444444444444",
            checkpointId: null,
            currentExecutionId: executionId,
            executionState: "RUNNING",
            eventSequence: 7,
            startedAt: "2026-08-13T10:59:00.000Z",
            lastResumedAt: null,
            updatedAt: "2026-08-13T11:00:00.000Z",
          },
        },
      ],
      canonical_events: [
        {
          eventId: "55555555-5555-4555-8555-555555555555",
          assessmentId,
          threadId: "33333333-3333-4333-8333-333333333333",
          sequence: 7,
          timestamp: "2026-08-13T11:00:00.000Z",
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
          executionId,
          eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
          payload: { kind: "TASK", labelKey: "pages.runtime.activity.running" },
        },
        {
          eventId: "66666666-6666-4666-8666-666666666666",
          assessmentId,
          threadId: "33333333-3333-4333-8333-333333333333",
          sequence: 6,
          timestamp: "2026-08-13T10:59:00.000Z",
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
          eventType:
            AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
          payload: {
            fromState: "PREPARING",
            toState: "ACTIVE",
            assessmentRevision: 3,
          },
        },
      ],
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed?.canonicalAssessments.length, 1);
  assert.equal(
    parsed?.getAssessmentRuntime(assessmentId).canonicalAssessment?.runtime
      ?.executionState,
    "RUNNING",
  );
  assert.equal(parsed?.canonicalEvents.length, 2);
  const runtime = parsed?.getAssessmentRuntime(assessmentId);
  assert.ok(runtime);
  assert.ok(runtime.canonicalEvents);
  assert.equal(runtime.canonicalEvents.length, 2);
  assert.equal(
    runtime.canonicalEvents[1]?.eventType,
    AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
  );
});

test("workspace runtime fingerprint ignores emission time for identical canonical state", () => {
  const snapshot = (emittedAt: string) =>
    parseRuntimeEvent(
      JSON.stringify({
        emitted_at: emittedAt,
        canonical_assessments: [],
        canonical_events: [],
      }),
    );
  const first = snapshot("2026-08-13T11:00:00.000Z");
  const next = snapshot("2026-08-13T11:00:02.000Z");

  assert.ok(first);
  assert.ok(next);
  assert.equal(runtimeFingerprint(first), runtimeFingerprint(next));
});
