import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { TransitionAssessmentLifecycleCommand } from "./transition-lifecycle.command.js";
import { TransitionAssessmentLifecycleHandler } from "./transition-lifecycle.handler.js";

describe("TransitionAssessmentLifecycleHandler", () => {
  it("delegates lifecycle transition requests to AssessmentLifecycleCoordinator", async () => {
    const transitionResult = {
      assessmentId: randomUUID(),
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      revision: 2,
    };
    const lifecycle = {
      transition: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(transitionResult),
    };
    const handler = new TransitionAssessmentLifecycleHandler(
      lifecycle as unknown as AssessmentLifecycleCoordinator,
    );

    const command = new TransitionAssessmentLifecycleCommand(
      transitionResult.assessmentId,
      "actor-1",
      1,
      ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      "corr-trans-1",
      "event-1",
    );
    const result = await handler.execute(command);

    expect(result).toEqual(transitionResult);
    expect(lifecycle.transition).toHaveBeenCalledWith({
      assessmentId: transitionResult.assessmentId,
      actorId: "actor-1",
      expectedRevision: 1,
      toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      correlationId: "corr-trans-1",
      eventId: "event-1",
      blocker: undefined,
    });
  });
});
