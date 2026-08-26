import { jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import { RbacPreflightController } from "./rbac-preflight.controller.js";
import { LOCAL_RBAC_REASON_CODES } from "./rbac-reason-codes.js";
import type { RbacPreflightService } from "./rbac-preflight.service.js";

const VALID_KEY = "correct-worker-api-key-value-1234";

function makeController(
  overrides: {
    evaluateImpl?: RbacPreflightService["evaluate"];
  } = {},
) {
  const evaluate = jest
    .fn<RbacPreflightService["evaluate"]>()
    .mockImplementation(
      overrides.evaluateImpl ??
        (() =>
          Promise.resolve({
            decision: "ALLOW",
            reasonCode: null,
            correlationId: "corr-1",
          })),
    );
  const preflightService = { evaluate } as unknown as RbacPreflightService;
  const configService = {
    get: (_key: string, fallback?: unknown) => VALID_KEY ?? fallback,
  } as unknown as ConfigService;

  return {
    controller: new RbacPreflightController(preflightService, configService),
    evaluate,
  };
}

describe("RbacPreflightController", () => {
  it("rejects a missing worker API key", async () => {
    const { controller } = makeController();

    await expect(
      controller.preflight(
        {
          user_id: "u",
          required_roles: [AUTH_USER_ROLES.customer],
          correlationId: "c",
        },
        undefined,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects an invalid worker API key", async () => {
    const { controller } = makeController();

    await expect(
      controller.preflight(
        {
          user_id: "u",
          required_roles: [AUTH_USER_ROLES.customer],
          correlationId: "c",
        },
        "wrong-key",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("passes required roles to the role-only preflight service", async () => {
    const { controller, evaluate } = makeController();

    const response = await controller.preflight(
      {
        user_id: "u",
        required_roles: [AUTH_USER_ROLES.customer],
        correlationId: "camel-corr-1",
      },
      VALID_KEY,
    );

    expect(evaluate).toHaveBeenCalledWith({
      userId: "u",
      requiredRoles: [AUTH_USER_ROLES.customer],
      correlationId: "camel-corr-1",
    });
    expect(response).toEqual({
      ok: true,
      data: {
        decision: "ALLOW",
        reason_code: null,
        correlationId: "corr-1",
      },
    });
  });

  it("returns a deny decision without throwing", async () => {
    const { controller } = makeController({
      evaluateImpl: () =>
        Promise.resolve({
          decision: "DENY",
          reasonCode: LOCAL_RBAC_REASON_CODES.denied,
          correlationId: "corr-1",
        }),
    });

    await expect(
      controller.preflight(
        {
          user_id: "u",
          required_roles: [AUTH_USER_ROLES.admin],
          correlationId: "c",
        },
        VALID_KEY,
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        decision: "DENY",
        reason_code: LOCAL_RBAC_REASON_CODES.denied,
        correlationId: "corr-1",
      },
    });
  });

  it("drops invalid role values before evaluation", async () => {
    const { controller, evaluate } = makeController();

    await controller.preflight(
      {
        user_id: "u",
        required_roles: [AUTH_USER_ROLES.customer, "MANAGER", 123],
        correlationId: "corr-2",
      },
      VALID_KEY,
    );

    expect(evaluate).toHaveBeenCalledWith({
      userId: "u",
      requiredRoles: [AUTH_USER_ROLES.customer],
      correlationId: "corr-2",
    });
  });
});
