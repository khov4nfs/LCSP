import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { TARGET_CANDIDATE_KINDS } from "../../application/contracts/missing-target-proposal.contract.js";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ProposeMissingTargetsQuery } from "../../application/queries/propose-missing-targets/propose-missing-targets.query.js";
import { ReconciliationController } from "./reconciliation.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "corr-1",
    rbacContext: {},
  } as AuthenticatedRequest;
}

function queryBusWithResolvedValue(value: unknown) {
  return {
    execute: jest
      .fn<(query: unknown) => Promise<unknown>>()
      .mockResolvedValue(value),
  };
}

describe("ReconciliationController.proposeMissingTargets", () => {
  it("forwards candidate kinds, seed refs, excludes, and capped max results", async () => {
    const queryBus = queryBusWithResolvedValue({ result: { candidates: [] } });
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    await controller.proposeMissingTargets(
      "assessment-1",
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
