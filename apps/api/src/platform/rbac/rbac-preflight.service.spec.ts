import { jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { UserRepository } from "../../modules/auth-workspace/application/ports/persistence/user.repository.js";
import type { AuthorizationDecisionRepository } from "../../modules/auth-workspace/application/ports/persistence/authorization-decision.repository.js";
import { User } from "../../modules/auth-workspace/domain/entities/user.entity.js";
import type { AuthorizationDecision } from "../../modules/auth-workspace/domain/models/auth-workspace.models.js";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";
import {
  RbacPreflightService,
  type RbacPreflightInput,
} from "./rbac-preflight.service.js";

function makeUser(
  overrides: Partial<Parameters<typeof User.rehydrate>[0]> = {},
): User {
  return User.rehydrate({
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hash",
    emailVerified: true,
    failedLoginCount: 0,
    role: AUTH_USER_ROLES.customer,
    ...overrides,
  });
}

function makeInput(
  overrides: Partial<RbacPreflightInput> = {},
): RbacPreflightInput {
  return {
    userId: "user-1",
    requiredRoles: [AUTH_USER_ROLES.customer],
    correlationId: "corr-1",
    ...overrides,
  };
}

function makeService(
  overrides: {
    user?: User | null;
    usersThrow?: Error;
    appendImpl?: (decision: AuthorizationDecision) => Promise<void>;
  } = {},
) {
  const findById = overrides.usersThrow
    ? jest
        .fn<UserRepository["findById"]>()
        .mockRejectedValue(overrides.usersThrow)
    : jest
        .fn<UserRepository["findById"]>()
        .mockResolvedValue(
          overrides.user === undefined ? makeUser() : overrides.user,
        );
  const users = {
    nextId: () => "user-1",
    save: () => Promise.resolve(),
    findById,
    findByEmail: () => Promise.resolve(null),
    findByRecoveryEmail: () => Promise.resolve(null),
    findByPrimaryEmail: () => Promise.resolve(null),
  } as unknown as UserRepository;

  const append = jest
    .fn<AuthorizationDecisionRepository["append"]>()
    .mockImplementation(overrides.appendImpl ?? (() => Promise.resolve()));
  const decisions = { append } as unknown as AuthorizationDecisionRepository;
  const service = new RbacPreflightService(users, decisions);

  return { service, findById, append };
}

describe("RbacPreflightService", () => {
  it("allows and logs when the user's role is required", async () => {
    const { service, append } = makeService();

    await expect(service.evaluate(makeInput())).resolves.toEqual({
      decision: "ALLOW",
      reasonCode: null,
      correlationId: "corr-1",
    });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: "user-1",
        session_id: null,
        resource_id: AUTH_USER_ROLES.customer,
        decision: "ALLOW",
        reason_code: RBAC_REASON_CODES.authorized,
      }),
    );
  });

  it("denies and logs when the user's role is not required", async () => {
    const { service, append } = makeService();

    await expect(
      service.evaluate(makeInput({ requiredRoles: [AUTH_USER_ROLES.admin] })),
    ).resolves.toEqual({
      decision: "DENY",
      reasonCode: RBAC_REASON_CODES.denied,
      correlationId: "corr-1",
    });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: AUTH_USER_ROLES.admin,
        decision: "DENY",
        reason_code: RBAC_REASON_CODES.denied,
      }),
    );
  });

  it("allows admin users when admin is one of the required roles", async () => {
    const { service } = makeService({
      user: makeUser({ role: AUTH_USER_ROLES.admin }),
    });

    await expect(
      service.evaluate(
        makeInput({
          requiredRoles: [AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin],
        }),
      ),
    ).resolves.toEqual({
      decision: "ALLOW",
      reasonCode: null,
      correlationId: "corr-1",
    });
  });

  it("denies with LOAD_ERROR when the user cannot be found", async () => {
    const { service } = makeService({ user: null });

    await expect(service.evaluate(makeInput())).resolves.toEqual({
      decision: "DENY",
      reasonCode: RBAC_REASON_CODES.loadError,
      correlationId: "corr-1",
    });
  });

  it("denies with LOAD_ERROR when user lookup throws", async () => {
    const { service } = makeService({
      usersThrow: new Error("db unavailable"),
    });

    await expect(service.evaluate(makeInput())).resolves.toEqual({
      decision: "DENY",
      reasonCode: RBAC_REASON_CODES.loadError,
      correlationId: "corr-1",
    });
  });

  it("does not throw when the decision-log write fails", async () => {
    const { service } = makeService({
      appendImpl: () => Promise.reject(new Error("db down")),
    });

    await expect(service.evaluate(makeInput())).resolves.toEqual({
      decision: "ALLOW",
      reasonCode: null,
      correlationId: "corr-1",
    });
  });
});
