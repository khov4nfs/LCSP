import { expect, it } from "@jest/globals";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as E,
  AGENT_STREAM_BOUNDARY_TYPES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { preparationActivityView } from "./preparation-activity-view.js";
const event: AssessmentAgentStreamEvent = {
  eventId: "fixture",
  sequence: 1,
  clientSequence: null,
  emittedAt: "2026-11-09T00:00:00Z",
  assessmentId: null,
  boundaryType: AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation,
  boundaryId: "run",
  preparationRunId: "run",
  runId: "run",
  correlationId: "correlation",
  eventType: E.customProgress,
  source: null,
  agentName: null,
  subagentName: null,
  namespace: [],
  nodeName: null,
  messageId: null,
  toolName: null,
  toolCallId: null,
  status: null,
  text: "private source body",
  data: {
    activity_kind: "PREPARATION_FAILURE",
    terminal_stage: "AGENT_GRAPH",
    prompt: "PRIVATE_PROMPT",
    raw_error_body: "PRIVATE_PROVIDER_BODY",
    failing_model_call: {
      provider: "inception",
      http_status: 429,
      raw_error_body: "PRIVATE_PROVIDER_BODY",
    },
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    review_frontier: {
      progress: { total: 10, blocked: 1 },
      sourceBody: "PRIVATE_SOURCE",
    },
  },
};
it("operations projection drops private model/content events and never mutates the journal", () => {
  expect(
    preparationActivityView({ ...event, eventType: E.modelReasoningDelta }),
  ).toBeNull();
  expect(
    preparationActivityView({ ...event, eventType: E.modelRequest }),
  ).toBeNull();
  const view = preparationActivityView(event);
  expect(view?.text).toBeNull();
  expect(JSON.stringify(view)).not.toContain("PRIVATE_");
  expect(view?.data).toEqual(
    expect.objectContaining({
      terminal_stage: "AGENT_GRAPH",
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    }),
  );
  expect(event.text).toBe("private source body");
});
