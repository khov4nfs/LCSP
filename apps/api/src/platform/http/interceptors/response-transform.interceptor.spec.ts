import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { jest } from "@jest/globals";
import { lastValueFrom, of } from "rxjs";

import { ResponseTransformInterceptor } from "./response-transform.interceptor.js";
import { BYPASS_ENVELOPE_KEY } from "./bypass-envelope.decorator.js";

describe("ResponseTransformInterceptor", () => {
  it("automatically wraps bare payload in result envelope { ok: true, data }", async () => {
    const response = { headersSent: false };
    const interceptor = new ResponseTransformInterceptor();
    const rawData = { id: "assessment-1", name: "Project Audit" };

    const result = await lastValueFrom(
      interceptor.intercept(
        createExecutionContext(response),
        createCallHandler(rawData),
      ),
    );

    expect(result).toEqual({
      ok: true,
      data: rawData,
    });
  });

  it("bypasses wrapping when response.headersSent is true (streaming / download)", async () => {
    const response = { headersSent: true };
    const interceptor = new ResponseTransformInterceptor();
    const rawStreamOutput = "raw stream bytes";

    const result = await lastValueFrom(
      interceptor.intercept(
        createExecutionContext(response),
        createCallHandler(rawStreamOutput),
      ),
    );

    expect(result).toBe(rawStreamOutput);
  });

  it("bypasses wrapping when handler has bypassEnvelope metadata", async () => {
    const response = { headersSent: false };
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => key === BYPASS_ENVELOPE_KEY),
    } as unknown as Reflector;
    const interceptor = new ResponseTransformInterceptor(reflector);
    const rawData = { raw: "data" };

    const result = await lastValueFrom(
      interceptor.intercept(
        createExecutionContext(response),
        createCallHandler(rawData),
      ),
    );

    expect(result).toBe(rawData);
  });

  it("does not double-wrap already enveloped payloads", async () => {
    const response = { headersSent: false };
    const interceptor = new ResponseTransformInterceptor();
    const alreadyEnveloped = {
      ok: true,
      data: { id: "order-1", status: "PENDING" },
    };

    const result = await lastValueFrom(
      interceptor.intercept(
        createExecutionContext(response),
        createCallHandler(alreadyEnveloped),
      ),
    );

    expect(result).toEqual(alreadyEnveloped);
  });

  it("passes through non-http execution contexts unchanged", async () => {
    const interceptor = new ResponseTransformInterceptor();
    const nonHttpContext = {
      getType: () => "rpc",
    } as unknown as ExecutionContext;
    const payload = { rpc: true };

    const result = await lastValueFrom(
      interceptor.intercept(nonHttpContext, createCallHandler(payload)),
    );

    expect(result).toBe(payload);
  });
});

function createExecutionContext(response: {
  headersSent?: boolean;
}): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function createCallHandler(body: unknown): CallHandler {
  return {
    handle: () => of(body),
  };
}
