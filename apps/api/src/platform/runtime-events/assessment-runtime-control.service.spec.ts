import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES as Problems,
} from "@lcsp/contracts/evidence";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../outbox/outbox.repository.js";
import type { AssessmentRuntimeEventService } from "./assessment-runtime-event.service.js";
import { AssessmentRuntimeControlService } from "./assessment-runtime-control.service.js";

describe("runtime control registration", () => {
  it.each([Actions.stop, Actions.resume])(
    "rejects %s without a native registration instead of reporting completion",
    async (action) => {
      const tx = {
        assessmentRuntimeTurn: {
          findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
        },
      };
      const prisma = {
        $transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
          work(tx),
      };
      const outbox = { enqueue: jest.fn() };
      const events = { publishAgentStreamEvent: jest.fn() };
      const controls = new AssessmentRuntimeControlService(
        prisma as unknown as PrismaService,
        outbox as unknown as OutboxRepository,
        events as unknown as AssessmentRuntimeEventService,
      );
      await expect(
        controls.request({
          assessmentId: "assessment",
          actorId: "actor",
          correlationId: "correlation",
          action,
          targetRunId: "visible-run",
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          ok: false,
          problem: {
            code: Problems.staleTarget,
            status: 409,
            correlationId: "correlation",
          },
        },
      });
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(events.publishAgentStreamEvent).not.toHaveBeenCalled();
    },
  );
});
