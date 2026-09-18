import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { Session, User } from "../../../domain/models/auth-workspace.models.ts";
import { GetWorkspaceHandler } from "./get-workspace.handler.ts";
import { GetWorkspaceQuery } from "./get-workspace.query.ts";

describe("GetWorkspaceHandler", () => {
  it("rejects when the backing session does not exist", async () => {
    const support = {
      createCorrelationId: () => "corr-123",
      resolveUserById: jest.fn(() =>
        Promise.resolve(
          User.rehydrate({
            id: "user-1",
            email: "test@example.com",
            displayName: "Test User",
            passwordHash: "hash",
            emailVerified: true,
            role: AUTH_USER_ROLES.customer,
          }),
        ),
      ),
      now: () => Date.now(),
      recordAudit: jest.fn(() => Promise.resolve()),
    };

    const repositories = {
      sessions: {
        findById: jest.fn(() => Promise.resolve(null)),
      },
    };

    const handler = new GetWorkspaceHandler(
      support as never,
      repositories as never,
    );

    const query = new GetWorkspaceQuery(
      {
        userId: "user-1",
        sessionId: "non-existent-session",
      } as never,
      "corr-123",
    );

    const result = await handler.execute(query);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe(AUTH_ERROR_CODES.sessionInvalid);
    }
  });

  it("rejects when the session belongs to a different user", async () => {
    const expiresAt = Date.now() + 3600_000;
    const session = Session.rehydrate({
      id: "session-2",
      userId: "user-2",
      tokenHash: "hash",
      expiresAt,
      mfaVerifiedAt: Date.now(),
    });

    const user = User.rehydrate({
      id: "user-1",
      email: "test@example.com",
      displayName: "Test User",
      passwordHash: "hash",
      emailVerified: true,
      role: AUTH_USER_ROLES.customer,
    });

    const support = {
      createCorrelationId: () => "corr-123",
      resolveUserById: jest.fn(() => Promise.resolve(user)),
      now: () => Date.now(),
      recordAudit: jest.fn(() => Promise.resolve()),
    };

    const repositories = {
      sessions: {
        findById: jest.fn(() => Promise.resolve(session)),
      },
    };

    const handler = new GetWorkspaceHandler(
      support as never,
      repositories as never,
    );

    const query = new GetWorkspaceQuery(
      {
        userId: "user-1",
        sessionId: "session-2",
      } as never,
      "corr-123",
    );

    const result = await handler.execute(query);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe(AUTH_ERROR_CODES.sessionInvalid);
    }
  });

  it("returns authentic session expiration and MFA status when valid session exists", async () => {
    const expiresAt = Date.now() + 3600_000;
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt,
      mfaVerifiedAt: Date.now(),
    });

    const user = User.rehydrate({
      id: "user-1",
      email: "test@example.com",
      displayName: "Test User",
      passwordHash: "hash",
      emailVerified: true,
      role: AUTH_USER_ROLES.customer,
    });

    const support = {
      createCorrelationId: () => "corr-123",
      resolveUserById: jest.fn(() => Promise.resolve(user)),
      now: () => Date.now(),
      authorizeWorkspace: jest.fn(() =>
        Promise.resolve({
          ok: true,
          role: AUTH_USER_ROLES.customer,
          organizationId: null,
        }),
      ),
      recordAudit: jest.fn(() => Promise.resolve()),
    };

    const repositories = {
      sessions: {
        findById: jest.fn(() => Promise.resolve(session)),
      },
    };

    const handler = new GetWorkspaceHandler(
      support as never,
      repositories as never,
    );

    const query = new GetWorkspaceQuery(
      {
        userId: "user-1",
        sessionId: "session-1",
      } as never,
      "corr-123",
    );

    const result = await handler.execute(query);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session_expires_at).toBe(new Date(expiresAt).toISOString());
      expect(result.mfa_verified).toBe(true);
      expect(result.user_id).toBe("user-1");
    }
  });
});
