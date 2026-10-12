import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { jest } from "@jest/globals";
import { AUTH_ERROR_CODES, createProblemResult } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";

import { HttpExceptionFilter } from "./http-exception.filter.js";

describe("HttpExceptionFilter", () => {
  it("stores problem metadata on the response for HTTP logging", () => {
    const filter = new HttpExceptionFilter();
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

  it("maps generic 404 NotFoundException to NOT_FOUND and preserves error message in meta", () => {
    const filter = new HttpExceptionFilter();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { locals: {}, status };

    filter.catch(
      new NotFoundException("Technical evidence not found"),
      createArgumentsHost(
        {
          method: "GET",
          url: "/assessments/a/evidence-graph/overview",
          headers: {},
        },
        response,
      ),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        problem: expect.objectContaining({
          code: SHARED_ERROR_CODES.notFound,
          requiredAction: "none",
          status: HttpStatus.NOT_FOUND,
          meta: { message: "Technical evidence not found" },
        }),
      }),
    );
  });

  it("preserves multiple validation messages from BadRequestException in meta", () => {
    const filter = new HttpExceptionFilter();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { locals: {}, status };

    filter.catch(
      new BadRequestException({
        message: ["email must be an email", "password is too short"],
        error: "Bad Request",
      }),
      createArgumentsHost(
        { method: "POST", url: "/users", headers: {} },
        response,
      ),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        problem: expect.objectContaining({
          code: SHARED_ERROR_CODES.badRequest,
          status: HttpStatus.BAD_REQUEST,
          meta: {
            message: "email must be an email; password is too short",
          },
        }),
      }),
    );
  });

  it("safely ignores non-HTTP contexts without throwing errors", () => {
    const filter = new HttpExceptionFilter();
    const nonHttpHost = {
      getType: () => "rpc",
      switchToHttp: () => {
        throw new Error("switchToHttp should not be called in RPC context");
      },
    } as unknown as Parameters<HttpExceptionFilter["catch"]>[1];

    expect(() => {
      filter.catch(new Error("rpc failure"), nonHttpHost);
    }).not.toThrow();
  });

  it("does not classify unknown internal failures as sign-in actions", () => {
    const filter = new HttpExceptionFilter();
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
          code: SHARED_ERROR_CODES.internalError,
          requiredAction: "none",
          status: HttpStatus.INTERNAL_SERVER_ERROR,
        }),
      }),
    );
  });

  it("resolves correlation ID from x-correlation-id header when exception has empty correlation ID", () => {
    const filter = new HttpExceptionFilter();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { locals: {}, status };
    const request = {
      method: "POST",
      url: "/auth/password-recovery/confirm",
      headers: { "x-correlation-id": "client-correlation-123" },
    };
    const problem = createProblemResult(AUTH_ERROR_CODES.validationFailed, "");
    const exception = new HttpException(problem, HttpStatus.BAD_REQUEST);

    filter.catch(exception, createArgumentsHost(request, response));

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        problem: expect.objectContaining({
          code: AUTH_ERROR_CODES.validationFailed,
          correlationId: "client-correlation-123",
          status: HttpStatus.BAD_REQUEST,
        }),
      }),
    );
  });

  it("resolves correlation ID from request.correlationId when exception has empty correlation ID and no header", () => {
    const filter = new HttpExceptionFilter();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { locals: {}, status };
    const request = {
      method: "POST",
      url: "/auth/reauthenticate",
      headers: {},
      correlationId: "guard-assigned-correlation-456",
    };
    const problem = createProblemResult(AUTH_ERROR_CODES.validationFailed, "");
    const exception = new HttpException(problem, HttpStatus.BAD_REQUEST);

    filter.catch(exception, createArgumentsHost(request, response));

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        problem: expect.objectContaining({
          code: AUTH_ERROR_CODES.validationFailed,
          correlationId: "guard-assigned-correlation-456",
          status: HttpStatus.BAD_REQUEST,
        }),
      }),
    );
  });

  it("generates a fallback UUID when exception has empty correlation ID and no correlation header", () => {
    const filter = new HttpExceptionFilter();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = { locals: {}, status };
    const request = {
      method: "POST",
      url: "/auth/password-recovery/confirm",
      headers: {},
    };
    const problem = createProblemResult(AUTH_ERROR_CODES.validationFailed, "");
    const exception = new HttpException(problem, HttpStatus.BAD_REQUEST);

    filter.catch(exception, createArgumentsHost(request, response));

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        problem: expect.objectContaining({
          code: AUTH_ERROR_CODES.validationFailed,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          correlationId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          ),
          status: HttpStatus.BAD_REQUEST,
        }),
      }),
    );
  });
});

function createArgumentsHost(
  request: object,
  response: object,
): Parameters<HttpExceptionFilter["catch"]>[1] {
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as Parameters<HttpExceptionFilter["catch"]>[1];
}
