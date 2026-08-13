import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  ARTIFACT_CHAIN_STAGES,
  type ArtifactChainStage,
} from "@lcsp/contracts/evidence";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { GetArtifactChainQuery } from "../../application/queries/get-artifact-chain/get-artifact-chain.query.js";
import { ReconciliationController } from "./reconciliation.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "corr-1",
    pbacContext: {
      organizationId: "org-1",
    },
  } as AuthenticatedRequest;
}

function queryBusWithResolvedValue(value: unknown) {
  return {
    execute: jest
      .fn<(query: unknown) => Promise<unknown>>()
      .mockResolvedValue(value),
  };
}

describe("ReconciliationController.getArtifactChain", () => {
  it("forwards required stages and exact-version mode to the protected query", async () => {
    const queryBus = queryBusWithResolvedValue({ result: { chain: [] } });
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );
    const requiredStages: ArtifactChainStage[] = [
      ARTIFACT_CHAIN_STAGES.technicalEvidence,
      ARTIFACT_CHAIN_STAGES.verifiedProfile,
    ];

    await controller.getArtifactChain(
      "assessment-1",
      requiredStages.join(","),
      "true",
      request(),
    );

    expect(queryBus.execute).toHaveBeenCalledWith(
      new GetArtifactChainQuery(
        "assessment-1",
        "org-1",
        "corr-1",
        requiredStages,
        true,
      ),
    );
  });

  it("rejects unknown artifact stages before dispatch", async () => {
    const queryBus = { execute: jest.fn() };
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    await expect(
      controller.getArtifactChain(
        "assessment-1",
        "TECHNICAL_EVIDENCE_REPORT,UNKNOWN_STAGE",
        "false",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(queryBus.execute).not.toHaveBeenCalled();
  });
});
