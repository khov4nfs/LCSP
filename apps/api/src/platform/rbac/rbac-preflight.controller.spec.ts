import { jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";

import { WorkerApiKeyGuard } from "./guards/worker-api-key.guard.js";
import { RbacPreflightController } from "./rbac-preflight.controller.js";
import { rbacPreflightSchema } from "./rbac-preflight.dto.js";
import type { RbacPreflightService } from "./rbac-preflight.service.js";

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

  return {
    controller: new RbacPreflightController(preflightService),
    evaluate,
  };
}

describe("RbacPreflightController", () => {
  it("has WorkerApiKeyGuard attached to controller class", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      RbacPreflightController,
    ) as unknown[];
    expect(guards).toBeDefined();
    expect(guards).toContain(WorkerApiKeyGuard);
  });

  it("passes required roles to the role-only preflight service and returns canonical result envelope", async () => {
    const { controller, evaluate } = makeController();

    const response = await controller.preflight({
      user_id: "u",
      required_roles: [AUTH_USER_ROLES.customer],
      correlationId: "camel-corr-1",
    });

    expect(evaluate).toHaveBeenCalledWith({
      userId: "u",
      requiredRoles: [AUTH_USER_ROLES.customer],
      correlationId: "camel-corr-1",
    });
    expect(response).toEqual({
      ok: true,
      data: {
        decision: "ALLOW",
        reasonCode: null,
        reason_code: null,
        correlationId: "corr-1",
      },
    });
  });

  it("supports camelCase fields userId and requiredRoles", async () => {
    const { controller, evaluate } = makeController();

    const response = await controller.preflight({
      userId: "u2",
      requiredRoles: [AUTH_USER_ROLES.admin],
      correlationId: "camel-corr-2",
    });

    expect(evaluate).toHaveBeenCalledWith({
      userId: "u2",
      requiredRoles: [AUTH_USER_ROLES.admin],
      correlationId: "camel-corr-2",
    });
    expect(response.ok).toBe(true);
    expect(response.data.decision).toBe("ALLOW");
  });

  it("returns a deny decision in canonical envelope without throwing", async () => {
    const { controller } = makeController({
      evaluateImpl: () =>
        Promise.resolve({
          decision: "DENY",
          reasonCode: RBAC_REASON_CODES.denied,
          correlationId: "corr-1",
        }),
    });

    const response = await controller.preflight({
      user_id: "u",
      required_roles: [AUTH_USER_ROLES.admin],
      correlationId: "c",
    });

    expect(response).toEqual({
      ok: true,
      data: {
        decision: "DENY",
        reasonCode: RBAC_REASON_CODES.denied,
        reason_code: RBAC_REASON_CODES.denied,
        correlationId: "corr-1",
      },
    });
  });

  it("drops invalid role values before evaluation", async () => {
    const { controller, evaluate } = makeController();

    await controller.preflight({
      user_id: "u",
      required_roles: [AUTH_USER_ROLES.customer, "MANAGER", 123],
      correlationId: "corr-2",
    });

    expect(evaluate).toHaveBeenCalledWith({
      userId: "u",
      requiredRoles: [AUTH_USER_ROLES.customer],
      correlationId: "corr-2",
    });
  });

  it("rejects unsafe worker correlation IDs at the DTO boundary", () => {
    expect(
      rbacPreflightSchema.safeParse({
        user_id: "u",
        required_roles: [AUTH_USER_ROLES.customer],
        correlationId: "unsafe\nlog-entry",
      }).success,
    ).toBe(false);
    expect(
      rbacPreflightSchema.safeParse({ correlationId: "x".repeat(129) }).success,
    ).toBe(false);
  });

  it("normalizes missing correlation IDs before worker evaluation", async () => {
    const { controller, evaluate } = makeController();

    await controller.preflight({
      user_id: "u",
      required_roles: [AUTH_USER_ROLES.customer],
    });

    expect(evaluate.mock.calls[0]?.[0].correlationId).toMatch(
      /^[A-Za-z0-9._:-]{1,128}$/,
    );
  });
});
