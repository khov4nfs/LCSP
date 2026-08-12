import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";

import type { QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { GetGapRequirementsQuery } from "../../application/queries/get-gap-requirements/get-gap-requirements.query.js";
import { GapRequirementsController } from "./gap-requirements.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: SUBJECT_ROLES.manager,
      scope: null,
      grantedActions: [PBAC_ACTIONS.gapRequirementsRead],
      selectedAction: PBAC_ACTIONS.gapRequirementsRead,
      policyId: "policy-1",
      policyVersion: "2026-07-29",
    },
  } as AuthenticatedRequest;
}

describe("GapRequirementsController", () => {
  it("TC-02: rejects unpinned or unexpected payload keys before dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new GapRequirementsController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.getGapRequirements(
        "assessment-1",
        {
          classificationRef: "classification:classification-1",
          prompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only stable immutable gap-requirement inputs", async () => {
    const execute = jest
      .fn<QueryBus["execute"]>()
      .mockResolvedValue({ status: AGENTIC_TOOL_STATUSES.ready });
    const controller = new GapRequirementsController({
      execute,
    } as unknown as QueryBus);

    await controller.getGapRequirements(
      "assessment-1",
      {
        classificationRef: "classification:classification-1",
        policyProfileVersionId: "policy_policy-1_2026-07-29",
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          classificationRef: "classification:classification-1",
          policyProfileVersionId: "policy_policy-1_2026-07-29",
        },
      }) as GetGapRequirementsQuery,
    );
  });
});
