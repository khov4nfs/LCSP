import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { AuthApplicationError } from "../../errors/auth-application.error.ts";
import { Session, User } from "../../../domain/models/auth.models.ts";
import { hashSecretSync } from "../../../../../platform/security/crypto.utils.js";
import { ReauthenticatePasswordCommand } from "./reauthenticate-password.command.ts";
import { ReauthenticatePasswordHandler } from "./reauthenticate-password.handler.ts";

const mockFn = <T = void>(val?: T) =>
  jest.fn((...args: unknown[]) => {
    void args;
    return Promise.resolve(val);
  });

describe("ReauthenticatePasswordHandler", () => {
  const now = 1_700_000_000_000;
  const correlationId = "test-corr-id";
  const password = "ValidPassword123!";
  const passwordHash = hashSecretSync(password);

  const createMockSupport = () => ({
    createCorrelationId: () => correlationId,
    now: () => now,
    recordAudit: mockFn(),
  });

  it("rejects when userId or sessionId is missing", async () => {
    const support = createMockSupport();
    const sessions = { findById: mockFn(null) };
    const users = { findById: mockFn(null) };

    const handler = new ReauthenticatePasswordHandler(
      support as never,
      sessions as never,
      users as never,
    );

    const command = new ReauthenticatePasswordCommand(
      password,
      "",
      "session-1",
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
  });

  it("rejects when session is invalid, expired, or belongs to another user", async () => {
    const support = createMockSupport();
    const expiredSession = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now - 1000,
    });

    const sessions = {
      findById: mockFn(expiredSession),
    };
    const users = { findById: mockFn(null) };

    const handler = new ReauthenticatePasswordHandler(
      support as never,
      sessions as never,
      users as never,
    );

    const command = new ReauthenticatePasswordCommand(
      password,
      "user-1",
      "session-1",
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
  });

  it("rejects when user is suspended", async () => {
    const support = createMockSupport();
    const activeSession = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now + 3600_000,
    });

    const suspendedUser = User.rehydrate({
      id: "user-1",
      email: "user@example.com",
      passwordHash,
      emailVerified: true,
      accessStatus: USER_ACCESS_STATUSES.suspended,
    });

    const sessions = {
      findById: mockFn(activeSession),
    };
    const users = {
      findById: mockFn(suspendedUser),
    };

    const handler = new ReauthenticatePasswordHandler(
      support as never,
      sessions as never,
      users as never,
    );

    const command = new ReauthenticatePasswordCommand(
      password,
      "user-1",
      "session-1",
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
  });

  it("rejects when password does not match and records loginFailed audit", async () => {
    const support = createMockSupport();
    const activeSession = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now + 3600_000,
    });

    const activeUser = User.rehydrate({
      id: "user-1",
      email: "user@example.com",
      passwordHash,
      emailVerified: true,
      accessStatus: USER_ACCESS_STATUSES.active,
    });

    const sessions = {
      findById: mockFn(activeSession),
      save: mockFn(),
    };
    const users = {
      findById: mockFn(activeUser),
    };

    const handler = new ReauthenticatePasswordHandler(
      support as never,
      sessions as never,
      users as never,
    );

    const command = new ReauthenticatePasswordCommand(
      "WrongPassword!",
      "user-1",
      "session-1",
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(sessions.save).not.toHaveBeenCalled();
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: "user-1",
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidCredentials,
      }),
    );
  });

  it("elevates session and records loginSucceeded audit when password is valid", async () => {
    const support = createMockSupport();
    const activeSession = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now + 3600_000,
    });

    const activeUser = User.rehydrate({
      id: "user-1",
      email: "user@example.com",
      passwordHash,
      emailVerified: true,
      accessStatus: USER_ACCESS_STATUSES.active,
    });

    const sessions = {
      findById: mockFn(activeSession),
      save: mockFn(),
    };
    const users = {
      findById: mockFn(activeUser),
    };

    const handler = new ReauthenticatePasswordHandler(
      support as never,
      sessions as never,
      users as never,
    );

    const command = new ReauthenticatePasswordCommand(
      password,
      "user-1",
      "session-1",
      { correlationId },
    );

    const result = await handler.execute(command);
    expect(result).toEqual({
      ok: true,
      correlationId,
      verified: true,
    });
    expect(activeSession.sensitiveActionVerifiedAt).toBe(now);
    expect(activeSession.passwordReauthenticatedAt).toBe(now);
    expect(sessions.save).toHaveBeenCalledWith(activeSession);
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
        actor_id: "user-1",
        decision: AUDIT_DECISIONS.allow,
      }),
    );
  });
});
