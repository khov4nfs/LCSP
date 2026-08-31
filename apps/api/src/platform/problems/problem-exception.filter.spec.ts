import { HttpException, HttpStatus } from "@nestjs/common";
import { jest } from "@jest/globals";
import { AUTH_ERROR_CODES, createProblemResult } from "@lcsp/contracts/auth";

import { ProblemExceptionFilter } from "./problem-exception.filter.js";

describe("ProblemExceptionFilter", () => {
  it("stores problem metadata on the response for HTTP logging", () => {
    const filter = new ProblemExceptionFilter();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = {
      locals: {},
      status,
    };
    const request = {
      method: "POST",
      url: "/auth/sign-in",
      headers: {},
    };
    const problem = createProblemResult(
      AUTH_ERROR_CODES.invalidCredentials,
      "corr-401",
    );
    const exception = new HttpException(problem, HttpStatus.UNAUTHORIZED);

    filter.catch(exception, createArgumentsHost(request, response));

    expect(response.locals).toEqual({
      problemResponse: {
        code: AUTH_ERROR_CODES.invalidCredentials,
        correlationId: "corr-401",
        requiredAction: problem.problem.requiredAction,
      },
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(json).toHaveBeenCalledWith(problem);
  });

  it("does not classify unknown internal failures as sign-in actions", () => {
    const filter = new ProblemExceptionFilter();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { locals: {}, status };

    filter.catch(
      new Error("credential_store_operation_failed"),
      createArgumentsHost(
        { method: "POST", url: "/provider-credentials", headers: {} },
        response,
      ),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        problem: expect.objectContaining({
          code: "INTERNAL_ERROR",
          requiredAction: "none",
          status: HttpStatus.INTERNAL_SERVER_ERROR,
        }),
      }),
    );
  });
});

function createArgumentsHost(
  request: object,
  response: object,
): Parameters<ProblemExceptionFilter["catch"]>[1] {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as Parameters<ProblemExceptionFilter["catch"]>[1];
}
