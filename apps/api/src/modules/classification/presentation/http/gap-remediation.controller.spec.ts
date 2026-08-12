import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { GAP_REMEDIATION_TEMPLATE_IDS } from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { GapRemediationController } from "./gap-remediation.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: "Manager",
      scope: null,
      grantedActions: [PBAC_ACTIONS.gapRemediationPropose],
      selectedAction: PBAC_ACTIONS.gapRemediationPropose,
    },
  } as AuthenticatedRequest;
}

describe("GapRemediationController", () => {
  it("TC-01: dispatches only allow-listed remediation inputs", async () => {
    const execute = jest.fn<QueryBus["execute"]>().mockResolvedValue({
      status: "READY",
    });
    const controller = new GapRemediationController({
      execute,
    } as unknown as QueryBus);

    await controller.proposeGapRemediation(
      "assessment-1",
      {
        rowRef: "gap-row:classification-1:system_type",
        templateId: GAP_REMEDIATION_TEMPLATE_IDS.collectEvidence,
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          rowRef: "gap-row:classification-1:system_type",
          templateId: GAP_REMEDIATION_TEMPLATE_IDS.collectEvidence,
        },
      }),
    );
  });

  it("TC-02: rejects unexpected payload keys before dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new GapRemediationController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.proposeGapRemediation(
        "assessment-1",
        {
          rowRef: "gap-row:classification-1:system_type",
          templateId: GAP_REMEDIATION_TEMPLATE_IDS.collectEvidence,
          prompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });
});
