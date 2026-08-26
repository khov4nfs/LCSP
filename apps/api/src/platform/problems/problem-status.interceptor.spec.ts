import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AUTH_ERROR_CODES,
  createProblemResult,
  type ProblemResult,
} from "@lcsp/contracts/auth";
import { lastValueFrom, of } from "rxjs";

import { ProblemStatusInterceptor } from "./problem-status.interceptor.js";

describe("ProblemStatusInterceptor", () => {
  it("sets the HTTP status from ProblemResult body status", async () => {
    const response = { status: jest.fn(), locals: {} };
    const interceptor = new ProblemStatusInterceptor();
    const body: ProblemResult = createProblemResult(
      AUTH_ERROR_CODES.rbacDenied,
      "correlation-1",
    );

    const result = await lastValueFrom(
      interceptor.intercept(
        createExecutionContext(response),
        createCallHandler(body),
      ),
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.locals).toEqual({
      problemResponse: {
        code: AUTH_ERROR_CODES.rbacDenied,
        correlationId: "correlation-1",
        requiredAction: body.problem.requiredAction,
      },
    });
    expect(result).toBe(body);
  });

  it("does not change status for successful payloads", async () => {
    const response = { status: jest.fn(), locals: {} };
    const interceptor = new ProblemStatusInterceptor();
    const body = { ok: true, data: { id: "assessment-1" } };

    const result = await lastValueFrom(
      interceptor.intercept(
        createExecutionContext(response),
        createCallHandler(body),
      ),
    );

    expect(response.status).not.toHaveBeenCalled();
    expect(response.locals).toEqual({});
    expect(result).toBe(body);
  });
});

function createExecutionContext(response: {
  status: jest.Mock;
  locals: Record<string, unknown>;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as ExecutionContext;
}

function createCallHandler(body: unknown): CallHandler {
  return {
    handle: () => of(body),
  };
}
