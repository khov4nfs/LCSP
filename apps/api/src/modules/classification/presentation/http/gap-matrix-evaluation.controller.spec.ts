import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { EvaluateGapMatrixQuery } from "../../application/queries/evaluate-gap-matrix/evaluate-gap-matrix.query.js";
import { GapMatrixEvaluationController } from "./gap-matrix-evaluation.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    rbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
      scope: null,
    },
  } as AuthenticatedRequest;
}

describe("GapMatrixEvaluationController", () => {
  it("TC-02: rejects unexpected payload keys before dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new GapMatrixEvaluationController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.evaluateGapMatrix(
        "assessment-1",
        {
          matrixRef: "matrix:classification-1",
          evidenceRefs: ["citation:chunk_allow_1"],
          prompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only stable gap-matrix inputs", async () => {
    const execute = jest
      .fn<QueryBus["execute"]>()
      .mockResolvedValue({ status: "READY" });
    const controller = new GapMatrixEvaluationController({
      execute,
    } as unknown as QueryBus);

    await controller.evaluateGapMatrix(
      "assessment-1",
      {
        matrixRef: "matrix:classification-1",
        evidenceRefs: ["citation:chunk_allow_1"],
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          matrixRef: "matrix:classification-1",
          evidenceRefs: ["citation:chunk_allow_1"],
        },
        actorId: "user-1",
        correlationId: "correlation-1",
      }) as EvaluateGapMatrixQuery,
    );
  });
});
