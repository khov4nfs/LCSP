import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";

import type { CommandBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { proposalGateRef } from "../../application/queries/validate-classification-proposal/validate-classification-proposal.handler.js";
import { SubmitClassificationReviewCommand } from "../../application/commands/submit-classification-review/submit-classification-review.command.js";
import { ClassificationReviewSubmissionController } from "./classification-review-submission.controller.js";

const INPUT = {
  baselineRef: "baseline:match1",
  candidateLabel: "CLASSIFICATION_CANDIDATE_A",
  citationRefs: ["citation:chunk_123456"],
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
};

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: SUBJECT_ROLES.manager,
      scope: null,
      grantedActions: [PBAC_ACTIONS.classificationReviewSubmit],
      selectedAction: PBAC_ACTIONS.classificationReviewSubmit,
      policyId: "policy-1",
      policyVersion: "1",
    },
  } as AuthenticatedRequest;
}

describe("ClassificationReviewSubmissionController", () => {
  it("TC-03: rejects duplicate citations and unexpected payload keys before dispatch", async () => {
    const execute = jest.fn<CommandBus["execute"]>();
    const controller = new ClassificationReviewSubmissionController({
      execute,
    } as unknown as CommandBus);

    await expect(
      controller.submitClassificationForIndependentReview(
        "assessment-1",
        {
          ...INPUT,
          proposalGateRef: proposalGateRef(INPUT),
          citationRefs: ["citation:chunk_123456", "citation:chunk_123456"],
          prompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only stable immutable review request inputs", async () => {
    const execute = jest
      .fn<CommandBus["execute"]>()
      .mockResolvedValue({ status: AGENTIC_TOOL_STATUSES.ready });
    const controller = new ClassificationReviewSubmissionController({
      execute,
    } as unknown as CommandBus);
    const proposalGate = proposalGateRef(INPUT);

    await controller.submitClassificationForIndependentReview(
      "assessment-1",
      {
        ...INPUT,
        proposalGateRef: proposalGate,
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          ...INPUT,
          proposalGateRef: proposalGate,
        },
      }) as SubmitClassificationReviewCommand,
    );
  });
});
