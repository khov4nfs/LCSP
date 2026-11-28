import { describe, expect, it, jest } from "@jest/globals";
import { firstValueFrom, of } from "rxjs";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";

import type { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { PreparationActivityController } from "./preparation-activity.controller.js";

const preparationRunId = "11111111-1111-4111-8111-111111111111";

function preparationEvent(
  overrides: Partial<AssessmentAgentStreamEvent> = {},
): AssessmentAgentStreamEvent {
  return {
    eventId: "event-1",
    sequence: 1,
    clientSequence: 1,
    emittedAt: "2026-11-23T00:00:00.000Z",
    assessmentId: null,
    boundaryType: AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation,
    boundaryId: preparationRunId,
    preparationRunId,
    runId: preparationRunId,
    correlationId: "corr-1",
    eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.customProgress,
    source: null,
    agentName: "rule-set-preparation",
    subagentName: null,
    namespace: [],
    nodeName: null,
    messageId: null,
    toolName: null,
    toolCallId: null,
    status: "RUNNING",
    text: "private prompt must be removed",
    data: {
      source_nodes_reviewed: 2,
      prompt: "private prompt must be removed",
    },
    ...overrides,
  };
}

describe("PreparationActivityController admin stream", () => {
  it("streams only the selected sanitized preparation activity", async () => {
    const observeAgentStreamEvents = jest.fn<
      AssessmentRuntimeEventService["observeAgentStreamEvents"]
    >(() => of(preparationEvent()));
    const controller = new PreparationActivityController({
      observeAgentStreamEvents,
    } as unknown as AssessmentRuntimeEventService);

    const message = await firstValueFrom(controller.stream(preparationRunId));

    expect(observeAgentStreamEvents).toHaveBeenCalledWith(
      `preparation:${preparationRunId}`,
      { preparationRunId },
    );
    expect(message.type).toBe("preparation.activity");
    expect(message.data).toMatchObject({
      preparationRunId,
      text: null,
      data: { source_nodes_reviewed: 2 },
    });
    expect(JSON.stringify(message.data)).not.toContain("private prompt");
  });

  it("drops events outside the exact Preparation boundary", async () => {
    const observeAgentStreamEvents = jest.fn<
      AssessmentRuntimeEventService["observeAgentStreamEvents"]
    >(() =>
      of(
        preparationEvent({
          eventId: "foreign-boundary",
          boundaryType: AGENT_STREAM_BOUNDARY_TYPES.assessment,
        }),
        preparationEvent({ eventId: "selected-preparation" }),
      ),
    );
    const controller = new PreparationActivityController({
      observeAgentStreamEvents,
    } as unknown as AssessmentRuntimeEventService);

    const message = await firstValueFrom(controller.stream(preparationRunId));

    expect(message.data).toMatchObject({ eventId: "selected-preparation" });
  });
});
