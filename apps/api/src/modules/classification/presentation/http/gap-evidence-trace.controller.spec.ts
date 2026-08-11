import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { GetGapEvidenceTraceQuery } from "../../application/queries/get-gap-evidence-trace/get-gap-evidence-trace.query.js";
import { GapEvidenceTraceController } from "./gap-evidence-trace.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: "Manager",
      scope: null,
      grantedActions: [PBAC_ACTIONS.gapEvidenceTraceRead],
      selectedAction: PBAC_ACTIONS.gapEvidenceTraceRead,
    },
  } as AuthenticatedRequest;
}

describe("GapEvidenceTraceController", () => {
  it("TC-02: rejects unexpected payload keys before dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new GapEvidenceTraceController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.getGapEvidenceTrace(
        "assessment-1",
        {
          rowRef: "gap-row:classification-1:system_type",
          prompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only stable gap row inputs", async () => {
    const execute = jest
      .fn<QueryBus["execute"]>()
      .mockResolvedValue({ status: "READY" });
    const controller = new GapEvidenceTraceController({
      execute,
    } as unknown as QueryBus);

    await controller.getGapEvidenceTrace(
      "assessment-1",
      {
        rowRef: "gap-row:classification-1:system_type",
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          rowRef: "gap-row:classification-1:system_type",
        },
      }) as GetGapEvidenceTraceQuery,
    );
  });
});
