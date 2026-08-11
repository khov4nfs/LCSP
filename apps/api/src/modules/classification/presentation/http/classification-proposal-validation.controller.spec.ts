import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";

import type { QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ValidateClassificationProposalQuery } from "../../application/queries/validate-classification-proposal/validate-classification-proposal.query.js";
import { ClassificationProposalValidationController } from "./classification-proposal-validation.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: SUBJECT_ROLES.manager,
      scope: null,
      grantedActions: [PBAC_ACTIONS.classificationProposalValidate],
      selectedAction: PBAC_ACTIONS.classificationProposalValidate,
      policyId: "policy-1",
      policyVersion: "1",
    },
  } as AuthenticatedRequest;
}

describe("ClassificationProposalValidationController", () => {
  it("TC-03: rejects duplicate citations and unexpected payload keys before dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new ClassificationProposalValidationController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.validateClassificationProposal(
        "assessment-1",
        {
          baselineRef: "baseline:match1",
          candidateLabel: "CLASSIFICATION_CANDIDATE_A",
          citationRefs: ["citation:chunk_123456", "citation:chunk_123456"],
          prompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only stable immutable proposal inputs", async () => {
    const execute = jest
      .fn<QueryBus["execute"]>()
      .mockResolvedValue({ status: AGENTIC_TOOL_STATUSES.ready });
    const controller = new ClassificationProposalValidationController({
      execute,
    } as unknown as QueryBus);

    await controller.validateClassificationProposal(
      "assessment-1",
      {
        baselineRef: "baseline:match1",
        candidateLabel: "CLASSIFICATION_CANDIDATE_A",
        citationRefs: ["citation:chunk_123456"],
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          baselineRef: "baseline:match1",
          candidateLabel: "CLASSIFICATION_CANDIDATE_A",
          citationRefs: ["citation:chunk_123456"],
        },
      }) as ValidateClassificationProposalQuery,
    );
  });
});
