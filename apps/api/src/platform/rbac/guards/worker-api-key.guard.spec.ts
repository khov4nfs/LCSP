import { describe, expect, it } from "@jest/globals";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import { WorkerApiKeyGuard } from "./worker-api-key.guard.js";

const VALID_KEY = "test-secret-worker-key-12345";

function makeContext(
  headers: Record<string, string | string[] | undefined> = {},
): ExecutionContext {
  const req = {
    headers: { ...headers },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(
  configuredKey: string = VALID_KEY,
  previousKey?: string,
): WorkerApiKeyGuard {
  const configService = {
    get: (key: string, fallback?: unknown) => {
      if (key === "worker.apiKey") return configuredKey ?? fallback;
      if (key === "worker.previousApiKey") return previousKey ?? fallback;
      return fallback;
    },
  } as unknown as ConfigService;
  return new WorkerApiKeyGuard(configService);
}

describe("WorkerApiKeyGuard", () => {
  it("rejects request when x-worker-api-key header is missing", () => {
    const guard = makeGuard();
    const ctx = makeContext({});

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    try {
      guard.canActivate(ctx);
    } catch (err) {
      const response = (err as UnauthorizedException).getResponse() as {
        ok: boolean;
        problem: { code: string; status: number };
      };
      expect(response.ok).toBe(false);
      expect(response.problem.code).toBe(AUTH_ERROR_CODES.sessionInvalid);
    }
  });

  it("rejects request when x-worker-api-key header does not match expected key", () => {
    const guard = makeGuard();
    const ctx = makeContext({ "x-worker-api-key": "wrong-key" });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects request when worker.apiKey is not configured", () => {
    const guard = makeGuard("");
    const ctx = makeContext({ "x-worker-api-key": VALID_KEY });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("allows request when x-worker-api-key matches configured key", () => {
    const guard = makeGuard();
    const ctx = makeContext({ "x-worker-api-key": VALID_KEY });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("accepts only the configured WORKER_API_KEY even if a previous key is present", () => {
    const previousKey = "previous-secret-worker-key-67890";
    const guard = makeGuard(VALID_KEY, previousKey);

    // Why: ASM-WORKER-01 was withdrawn when the product accepted one worker key.
    // How: A stale key is rejected even if legacy config exposes it, while the current key works.
    // Invariant: This test must not force previous-key rotation into production authorization.
    expect(() =>
      guard.canActivate(makeContext({ "x-worker-api-key": previousKey })),
    ).toThrow(UnauthorizedException);
    expect(
      guard.canActivate(makeContext({ "x-worker-api-key": VALID_KEY })),
    ).toBe(true);
  });

  it("preserves correlationId from header when rejecting", () => {
    const guard = makeGuard();
    const ctx = makeContext({
      "x-worker-api-key": "wrong",
      "x-correlation-id": "trace-corr-99",
    });

    try {
      guard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (err) {
      const response = (err as UnauthorizedException).getResponse() as {
        problem: { correlationId: string };
      };
      expect(response.problem.correlationId).toBe("trace-corr-99");
    }
  });
});
