import { jest } from "@jest/globals";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  HttpStatus,
  type ExecutionContext,
  type HttpException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthorizationDecisionRepository } from "../../modules/auth-workspace/application/ports/persistence/authorization-decision.repository.js";
import { Session } from "../../modules/auth-workspace/domain/entities/session.entity.js";
import { User } from "../../modules/auth-workspace/domain/entities/user.entity.js";
import type { AuthorizationDecision } from "../../modules/auth-workspace/domain/models/auth-workspace.models.js";
import { RequireRoles } from "./decorators/require-roles.decorator.js";
import { RequireSession } from "./decorators/require-session.decorator.js";
import type { RbacRequestContext } from "./interfaces/rbac-request.interface.js";
import type {
  RbacContextLoader,
  RbacContextResult,
} from "./rbac-context.loader.js";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";
import { RbacGuard } from "./rbac.guard.js";

class DummyController {
  @RequireRoles(AUTH_USER_ROLES.customer)
  customerOnly(this: void): void {}

  @RequireRoles(AUTH_USER_ROLES.admin)
  adminOnly(this: void): void {}

  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  shared(this: void): void {}

  @RequireSession()
  sessionOnly(this: void): void {}

  noDecorator(this: void): void {}
}

function makeContext(options: {
  handler: () => void;
  authorization?: string;
  params?: Record<string, string>;
}): { context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = {
    headers: options.authorization
      ? { authorization: options.authorization }
      : {},
    method: "POST",
    params: options.params ?? {},
    route: { path: "/assessments/:assessmentId/conflicts/:conflictId/resolve" },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => options.handler,
    getClass: () => DummyController,
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeSession(): Session {
  return Session.rehydrate({
    id: "session-1",
    userId: "user-1",
    tokenHash: "hash",
    expiresAt: Date.now() + 60_000,
  });
}

function makeUser(role: AuthUserRole = AUTH_USER_ROLES.customer): User {
  return User.rehydrate({
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hash",
    emailVerified: true,
    failedLoginCount: 0,
    role,
  });
}

function makeOkLoadResult(): RbacContextResult {
  const user = makeUser();
  return {
    ok: true,
    session: makeSession(),
    user,
  };
}

function makeGuard(
  overrides: {
    loadResult?: RbacContextResult;
    appendImpl?: (decision: AuthorizationDecision) => Promise<void>;
  } = {},
) {
  const load = jest
    .fn<RbacContextLoader["load"]>()
    .mockResolvedValue(overrides.loadResult ?? makeOkLoadResult());
  const loader = { load } as unknown as RbacContextLoader;

  const append = jest
    .fn<AuthorizationDecisionRepository["append"]>()
    .mockImplementation(overrides.appendImpl ?? (() => Promise.resolve()));
  const decisions = { append } as unknown as AuthorizationDecisionRepository;

  const guard = new RbacGuard(new Reflector(), loader, decisions);

  return { guard, load, append };
}

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  return (await promise.catch((error: unknown) => error)) as HttpException;
}

describe("RbacGuard", () => {
  it("allows when the authenticated user's role is required", async () => {
    const { guard, append } = makeGuard();
    const { context, request } = makeContext({
      handler: DummyController.prototype.customerOnly,
      authorization: "Bearer valid-token",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: "user-1",
        session_id: "session-1",
        decision: "ALLOW",
        reason_code: RBAC_REASON_CODES.authorized,
      }),
    );
    expect(
      (request as { rbacContext?: RbacRequestContext }).rbacContext,
    ).toMatchObject({
      userId: "user-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
    });
  });

  it("returns 401 SESSION_INVALID when the Authorization header is missing", async () => {
    const { guard, load } = makeGuard();
    const { context } = makeContext({
      handler: DummyController.prototype.customerOnly,
    });

    const error = await captureError(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.getResponse()).toMatchObject({
      ok: false,
      problem: { code: RBAC_REASON_CODES.sessionInvalid },
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("returns 401 SESSION_INVALID when the loader rejects the session", async () => {
    const { guard } = makeGuard({
      loadResult: { ok: false, reason: RBAC_REASON_CODES.sessionInvalid },
    });
    const { context } = makeContext({
      handler: DummyController.prototype.customerOnly,
      authorization: "Bearer expired-token",
    });

    const error = await captureError(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.getResponse()).toMatchObject({
      ok: false,
      problem: { code: RBAC_REASON_CODES.sessionInvalid },
    });
  });

  it("returns 401 MFA_REQUIRED when the loaded session needs MFA", async () => {
    const { guard } = makeGuard({
      loadResult: {
        ok: false,
        reason: RBAC_REASON_CODES.mfaRequired,
        mfaEnrolled: true,
      },
    });
    const { context } = makeContext({
      handler: DummyController.prototype.customerOnly,
      authorization: "Bearer token",
    });

    const error = await captureError(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.getResponse()).toMatchObject({
      ok: false,
      problem: {
        code: RBAC_REASON_CODES.mfaRequired,
        meta: { mfaEnrolled: true },
      },
    });
  });

  it("returns 403 RBAC_DENIED on loader load errors", async () => {
    const { guard } = makeGuard({
      loadResult: { ok: false, reason: RBAC_REASON_CODES.loadError },
    });
    const { context } = makeContext({
      handler: DummyController.prototype.customerOnly,
      authorization: "Bearer token",
    });

    const error = await captureError(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(error.getResponse()).toMatchObject({
      ok: false,
      problem: { code: RBAC_REASON_CODES.denied },
    });
  });

  it("returns 403 RBAC_DENIED when the user role is not allowed", async () => {
    const { guard, append } = makeGuard();
    const { context } = makeContext({
      handler: DummyController.prototype.adminOnly,
      authorization: "Bearer token",
    });

    const error = await captureError(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(error.getResponse()).toMatchObject({
      ok: false,
      problem: { code: RBAC_REASON_CODES.denied },
    });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "DENY",
        reason_code: RBAC_REASON_CODES.denied,
      }),
    );
  });

  it("@RequireSession passes for an authenticated user regardless of role", async () => {
    const { guard, append } = makeGuard({
      loadResult: {
        ok: true,
        session: makeSession(),
        user: makeUser(AUTH_USER_ROLES.admin),
      },
    });
    const { context, request } = makeContext({
      handler: DummyController.prototype.sessionOnly,
      authorization: "Bearer token",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(
      (request as { rbacContext?: RbacRequestContext }).rbacContext,
    ).toMatchObject({
      role: AUTH_USER_ROLES.admin,
    });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "ALLOW" }),
    );
  });

  it("defaults to deny when no RBAC metadata is present", async () => {
    const { guard, load, append } = makeGuard();
    const { context } = makeContext({
      handler: DummyController.prototype.noDecorator,
      authorization: "Bearer token",
    });

    const error = await captureError(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(load).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "DENY",
        reason_code: RBAC_REASON_CODES.metadataMissing,
      }),
    );
  });

  it("allows when any role declared by @RequireRoles matches", async () => {
    const { guard, append } = makeGuard({
      loadResult: {
        ok: true,
        session: makeSession(),
        user: makeUser(AUTH_USER_ROLES.admin),
      },
    });
    const { context, request } = makeContext({
      handler: DummyController.prototype.shared,
      authorization: "Bearer token",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(
      (request as { rbacContext?: RbacRequestContext }).rbacContext,
    ).toMatchObject({ role: AUTH_USER_ROLES.admin });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "ALLOW",
        reason_code: RBAC_REASON_CODES.authorized,
      }),
    );
  });

  it("also allows the other role declared by @RequireRoles", async () => {
    const { guard, append } = makeGuard();
    const { context, request } = makeContext({
      handler: DummyController.prototype.shared,
      authorization: "Bearer token",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(
      (request as { rbacContext?: RbacRequestContext }).rbacContext,
    ).toMatchObject({ role: AUTH_USER_ROLES.customer });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "ALLOW" }),
    );
  });

  it("does not throw when decision logging fails after an allow", async () => {
    const { guard } = makeGuard({
      appendImpl: () => Promise.reject(new Error("db down")),
    });
    const { context } = makeContext({
      handler: DummyController.prototype.customerOnly,
      authorization: "Bearer token",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("records a domain resource id from route params when present", async () => {
    const { guard, append } = makeGuard();
    const { context } = makeContext({
      handler: DummyController.prototype.customerOnly,
      authorization: "Bearer token",
      params: { assessmentId: "assessment-1", conflictId: "conflict-1" },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: "assessment:assessment-1:conflict:conflict-1",
      }),
    );
  });
});
