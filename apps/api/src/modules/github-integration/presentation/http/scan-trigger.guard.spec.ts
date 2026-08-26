import { describe, expect, it, jest } from "@jest/globals";
import {
  BadRequestException,
  type ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import { REPOSITORY_SCAN_TRIGGER_SOURCES } from "@lcsp/contracts/github-integration";

import type { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { ScanTriggerGuard } from "./scan-trigger.guard.js";

const WORKER_KEY = "worker-key-at-least-32-characters-long";

function buildGuard(input?: {
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  rbacAllowed?: boolean;
  configuredKey?: string;
}) {
  const request = {
    headers: input?.headers ?? {},
    body: input?.body ?? {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const canActivate = jest
    .fn<(context: ExecutionContext) => Promise<boolean>>()
    .mockResolvedValue(input?.rbacAllowed ?? true);
  const get = jest
    .fn<() => string>()
    .mockReturnValue(input?.configuredKey ?? WORKER_KEY);
  const guard = new ScanTriggerGuard(
    { canActivate } as unknown as RbacGuard,
    { get } as unknown as ConfigService,
  );
  return { guard, context, request, canActivate };
}

describe("ScanTriggerGuard", () => {
  it("accepts a trusted trigger only with the worker API key", async () => {
    const { guard, context, request, canActivate } = buildGuard({
      headers: { "x-worker-api-key": WORKER_KEY },
      body: { trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty(
      "scanTriggerSource",
      REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
    );
    expect(canActivate).not.toHaveBeenCalled();
  });

  it("rejects a missing or invalid worker API key", async () => {
    const missing = buildGuard({
      body: { trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted },
    });
    await expect(
      missing.guard.canActivate(missing.context),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const invalid = buildGuard({
      headers: { "x-worker-api-key": "wrong-key" },
    });
    await expect(
      invalid.guard.canActivate(invalid.context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("delegates manual triggers to RBAC", async () => {
    const { guard, context, request, canActivate } = buildGuard({
      body: { trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.manual },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(canActivate).toHaveBeenCalledWith(context);
    expect(request).toHaveProperty(
      "scanTriggerSource",
      REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
    );
  });

  it("rejects an invalid source and worker/manual source mismatch", async () => {
    const invalid = buildGuard({ body: { trigger_source: "webhook" } });
    await expect(
      invalid.guard.canActivate(invalid.context),
    ).rejects.toBeInstanceOf(BadRequestException);

    const mismatch = buildGuard({
      headers: { "x-worker-api-key": WORKER_KEY },
      body: { trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.manual },
    });
    await expect(
      mismatch.guard.canActivate(mismatch.context),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
