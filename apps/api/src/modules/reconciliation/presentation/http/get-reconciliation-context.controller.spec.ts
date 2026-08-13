import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import {
  RECONCILIATION_CONTEXT_STATUSES,
  type ReconciliationContextStatus,
} from "../../application/contracts/reconciliation/reconciliation-context.contract.js";
import { GetReconciliationContextQuery } from "../../application/queries/get-reconciliation-context/get-reconciliation-context.query.js";
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

describe("ReconciliationController.getReconciliationContext", () => {
  it("forwards parsed flow ref, statuses, and max results to the protected query", async () => {
    const queryBus = queryBusWithResolvedValue({ result: { conflicts: [] } });
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    const statuses: ReconciliationContextStatus[] = [
      RECONCILIATION_CONTEXT_STATUSES.open,
      RECONCILIATION_CONTEXT_STATUSES.resolved,
    ];

    await controller.getReconciliationContext(
      "assessment-1",
      "flow:flow-1",
      statuses.join(","),
      "12",
      request(),
    );

    expect(queryBus.execute).toHaveBeenCalledWith(
      new GetReconciliationContextQuery(
        "assessment-1",
        "org-1",
        "corr-1",
        "flow-1",
        12,
        statuses,
      ),
    );
  });

  it("rejects malformed flow refs and invalid statuses before dispatch", async () => {
    const queryBus = { execute: jest.fn() };
    const controller = new ReconciliationController(
      {} as never,
      queryBus as never,
    );

    await expect(
      controller.getReconciliationContext(
        "assessment-1",
        "bad-flow",
        RECONCILIATION_CONTEXT_STATUSES.open,
        "12",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    await expect(
      controller.getReconciliationContext(
        "assessment-1",
        "flow:flow-1",
        "UNKNOWN_STATUS",
        "12",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(queryBus.execute).not.toHaveBeenCalled();
  });
});
