import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_STATUSES,
  CLASSIFICATION_REVIEW_DECISION_CODES,
  CLASSIFICATION_REVIEW_DECISIONS,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";

import type { CommandBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ResolveClassificationReviewCommand } from "../../application/commands/resolve-classification-review/resolve-classification-review.command.js";
import { ClassificationReviewResolutionController } from "./classification-review-resolution.controller.js";

const INPUT = {
  reviewRequestRef: "classification-review:review-request-1",
  decision: CLASSIFICATION_REVIEW_DECISIONS.approve,
  decisionCode: CLASSIFICATION_REVIEW_DECISION_CODES.evidenceSufficient,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
};

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "reviewer-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: SUBJECT_ROLES.manager,
      scope: null,
      grantedActions: [PBAC_ACTIONS.classificationReviewResolve],
      selectedAction: PBAC_ACTIONS.classificationReviewResolve,
      policyId: "policy-1",
      policyVersion: "1",
    },
  } as AuthenticatedRequest;
}

describe("ClassificationReviewResolutionController", () => {
  it("TC-03: rejects free-text and unexpected keys before dispatch", async () => {
    const execute = jest.fn<CommandBus["execute"]>();
    const controller = new ClassificationReviewResolutionController({
      execute,
    } as unknown as CommandBus);

    await expect(
      controller.resolveIndependentClassificationReview(
        "assessment-1",
        {
          ...INPUT,
          rationale: "human note",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only the stable decision contract", async () => {
    const execute = jest
      .fn<CommandBus["execute"]>()
      .mockResolvedValue({ status: AGENTIC_TOOL_STATUSES.ready });
    const controller = new ClassificationReviewResolutionController({
      execute,
    } as unknown as CommandBus);

    await controller.resolveIndependentClassificationReview(
      "assessment-1",
      INPUT,
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: INPUT,
      }) as ResolveClassificationReviewCommand,
    );
  });
});
