import { jest } from "@jest/globals";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";

import {
  HttpLoggerMiddleware,
  sanitizeUrlForLogging,
} from "./http-logger.middleware.js";

describe("HttpLoggerMiddleware", () => {
  it("logs problem metadata for 4xx responses", () => {
    const middleware = new HttpLoggerMiddleware();
    const warnSpy = jest.spyOn(
      Reflect.get(middleware, "logger") as { warn: (message: string) => void },
      "warn",
    );
    const request = {
      method: "POST",
      originalUrl: "/auth/sign-in",
    };
    let finishListener: (() => void) | undefined;
    const response = {
      statusCode: 401,
      locals: {
        problemResponse: {
          code: AUTH_ERROR_CODES.invalidCredentials,
          requiredAction: REQUIRED_ACTIONS.signIn,
          correlationId: "corr-401",
        },
      },
      on: jest.fn((_event: string, listener: () => void) => {
        finishListener = listener;
      }),
    };
    const next = jest.fn();

    middleware.use(
      request as Parameters<HttpLoggerMiddleware["use"]>[0],
      response as unknown as Parameters<HttpLoggerMiddleware["use"]>[1],
      next,
    );
    finishListener?.();

    expect(next).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`code=${AUTH_ERROR_CODES.invalidCredentials}`),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`requiredAction=${REQUIRED_ACTIONS.signIn}`),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("correlationId=corr-401"),
    );
  });

  it("redacts sensitive query parameters in originalUrl during logging", () => {
    const middleware = new HttpLoggerMiddleware();
    const logSpy = jest.spyOn(
      Reflect.get(middleware, "logger") as { log: (message: string) => void },
      "log",
    );
    const request = {
      method: "GET",
      originalUrl:
        "/auth/oauth/callback?code=sensitive_oauth_code_123&state=sensitive_state_nonce_456&scope=openid%20profile&other=safe",
    };
    let finishListener: (() => void) | undefined;
    const response = {
      statusCode: 200,
      locals: {},
      on: jest.fn((_event: string, listener: () => void) => {
        finishListener = listener;
      }),
    };
    const next = jest.fn();

    middleware.use(
      request as Parameters<HttpLoggerMiddleware["use"]>[0],
      response as unknown as Parameters<HttpLoggerMiddleware["use"]>[1],
      next,
    );
    finishListener?.();

    expect(logSpy).toHaveBeenCalled();
    const logMessage = logSpy.mock.calls[0][0];
    expect(logMessage).not.toContain("sensitive_oauth_code_123");
    expect(logMessage).not.toContain("sensitive_state_nonce_456");
    expect(logMessage).toContain("code=[REDACTED]");
    expect(logMessage).toContain("state=[REDACTED]");
    expect(logMessage).toContain("other=safe");
  });

  it("sanitizeUrlForLogging helper redacts sensitive query parameters", () => {
    const url =
      "/billing/sepay/webhook?signature=abc123secret&token=tok_456&order_id=ord_999";
    const sanitized = sanitizeUrlForLogging(url);
    expect(sanitized).toBe(
      "/billing/sepay/webhook?signature=[REDACTED]&token=[REDACTED]&order_id=ord_999",
    );
  });
});
