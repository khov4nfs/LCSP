import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  VERIFIED_PROFILE_REQUIRED_FOR,
} from "@lcsp/contracts/evidence";
import { TARGET_CANDIDATE_KINDS } from "../../application/contracts/missing-target-proposal.contract.js";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { GetAssessmentContextQuery } from "../../application/queries/get-assessment-context/get-assessment-context.query.js";
import { GetVerifiedProfileQuery } from "../../application/queries/get-verified-profile/get-verified-profile.query.js";
import { ProposeMissingTargetsQuery } from "../../application/queries/propose-missing-targets/propose-missing-targets.query.js";
import { ReconciliationController } from "./reconciliation.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "corr-1",
    pbacContext: {
      organizationId: "org-1",
    },
  } as AuthenticatedRequest;
}

describe("ReconciliationController.getVerifiedProfile", () => {
  it("TC-03: forwards an exact profile version and named purpose to the protected query", async () => {
    const commandBus = {};
    const queryBus = {
      execute: jest
        .fn()
        .mockResolvedValue({ result: { profile_ref: "verified:vp-1" } }),
    };
    const controller = new ReconciliationController(
      commandBus as never,
      queryBus as never,
    );

    const response = await controller.getVerifiedProfile(
      "assessment-1",
      "vp-1",
      "3",
      VERIFIED_PROFILE_REQUIRED_FOR.legalMatching,
      request(),
    );

    expect(response).toEqual({
      ok: true,
      data: { result: { profile_ref: "verified:vp-1" } },
    });
    expect(queryBus.execute).toHaveBeenCalledWith(
      new GetVerifiedProfileQuery(
        "assessment-1",
        "org-1",
        "vp-1",
        "3",
        VERIFIED_PROFILE_REQUIRED_FOR.legalMatching,
        "corr-1",
      ),
    );
  });

  it("TC-03: rejects malformed version and unknown purpose before dispatch", async () => {
    const queryBus = { execute: jest.fn() };
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    await expect(
      controller.getVerifiedProfile(
        "assessment-1",
        "vp-1",
        "0",
        "UNKNOWN",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(queryBus.execute).not.toHaveBeenCalled();
    try {
      await controller.getVerifiedProfile(
        "assessment-1",
        "vp-1",
        "3",
        "UNKNOWN",
        request(),
      );
    } catch (error) {
      expect((error as HttpException).getResponse()).toMatchObject({
        problem: { code: ASSESSMENT_ERROR_CODES.invalidRequest },
      });
    }
  });
});

describe("ReconciliationController.getAssessmentContext", () => {
  it("forwards include and answer-field allow lists to the protected query", async () => {
    const queryBus = {
      execute: jest.fn().mockResolvedValue({ result: { wizard: {} } }),
    };
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    await controller.getAssessmentContext(
      "assessment-1",
      "wizard-1",
      [
        ASSESSMENT_CONTEXT_INCLUDES.submittedAnswers,
        ASSESSMENT_CONTEXT_INCLUDES.pinnedArtifacts,
      ].join(","),
      [
        ASSESSMENT_CONTEXT_ANSWER_FIELDS.systemPurpose,
        ASSESSMENT_CONTEXT_ANSWER_FIELDS.humanReviewDeclaration,
      ].join(","),
      request(),
    );

    expect(queryBus.execute).toHaveBeenCalledWith(
      new GetAssessmentContextQuery(
        "assessment-1",
        "org-1",
        "wizard-1",
        [
          ASSESSMENT_CONTEXT_INCLUDES.submittedAnswers,
          ASSESSMENT_CONTEXT_INCLUDES.pinnedArtifacts,
        ],
        [
          ASSESSMENT_CONTEXT_ANSWER_FIELDS.systemPurpose,
          ASSESSMENT_CONTEXT_ANSWER_FIELDS.humanReviewDeclaration,
        ],
        "corr-1",
      ),
    );
  });

  it("rejects missing includes and unknown answer fields before dispatch", async () => {
    const queryBus = { execute: jest.fn() };
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    await expect(
      controller.getAssessmentContext(
        "assessment-1",
        "wizard-1",
        undefined,
        undefined,
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      controller.getAssessmentContext(
        "assessment-1",
        "wizard-1",
        ASSESSMENT_CONTEXT_INCLUDES.submittedAnswers,
        "UNKNOWN_FIELD",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(queryBus.execute).not.toHaveBeenCalled();
  });
});

describe("ReconciliationController.proposeMissingTargets", () => {
  it("forwards candidate kinds, seed refs, excludes, and capped max results", async () => {
    const queryBus = {
      execute: jest.fn().mockResolvedValue({ result: { candidates: [] } }),
    };
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    await controller.proposeMissingTargets(
      "assessment-1",
      "wizard-1",
      "report-1",
      [
        TARGET_CANDIDATE_KINDS.providerUsage,
        TARGET_CANDIDATE_KINDS.humanReview,
      ].join(","),
      "finding:f_1,invocation:iv_1",
      "target:provider_openai",
      "5",
      request(),
    );

    expect(queryBus.execute).toHaveBeenCalledWith(
      new ProposeMissingTargetsQuery(
        "assessment-1",
        "org-1",
        "wizard-1",
        "report-1",
        [
          TARGET_CANDIDATE_KINDS.providerUsage,
          TARGET_CANDIDATE_KINDS.humanReview,
        ],
        ["finding:f_1", "invocation:iv_1"],
        ["target:provider_openai"],
        5,
        "corr-1",
      ),
    );
  });

  it("rejects missing kinds and malformed refs before dispatch", async () => {
    const queryBus = { execute: jest.fn() };
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    await expect(
      controller.proposeMissingTargets(
        "assessment-1",
        "wizard-1",
        "report-1",
        undefined,
        undefined,
        undefined,
        "5",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    await expect(
      controller.proposeMissingTargets(
        "assessment-1",
        "wizard-1",
        "report-1",
        TARGET_CANDIDATE_KINDS.providerUsage,
        "bad-ref",
        undefined,
        "5",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(queryBus.execute).not.toHaveBeenCalled();
  });
});
