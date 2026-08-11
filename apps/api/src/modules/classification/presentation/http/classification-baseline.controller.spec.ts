import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { GetClassificationBaselineQuery } from "../../application/queries/get-classification-baseline/get-classification-baseline.query.js";
import { ClassificationBaselineController } from "./classification-baseline.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: "Manager",
      scope: null,
      grantedActions: [PBAC_ACTIONS.classificationBaselineRead],
      selectedAction: PBAC_ACTIONS.classificationBaselineRead,
      policyId: "policy-1",
      policyVersion: "2026-07-29",
    },
  } as AuthenticatedRequest;
}

describe("ClassificationBaselineController", () => {
  it("TC-02: rejects unpinned or unexpected payload keys before dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new ClassificationBaselineController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.getClassificationBaseline(
        "assessment-1",
        {
          verifiedProfileId: "profile_verified1",
          ruleMatchRef: "rule-match:match1",
          prompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only stable immutable baseline inputs", async () => {
    const execute = jest
      .fn<QueryBus["execute"]>()
      .mockResolvedValue({ status: "READY" });
    const controller = new ClassificationBaselineController({
      execute,
    } as unknown as QueryBus);

    await controller.getClassificationBaseline(
      "assessment-1",
      {
        verifiedProfileId: "profile_verified1",
        ruleMatchRef: "rule-match:match1",
        policyProfileVersionId: "policy_policy-1_2026-07-29",
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          verifiedProfileId: "profile_verified1",
          ruleMatchRef: "rule-match:match1",
          policyProfileVersionId: "policy_policy-1_2026-07-29",
        },
      }) as GetClassificationBaselineQuery,
    );
  });
});
