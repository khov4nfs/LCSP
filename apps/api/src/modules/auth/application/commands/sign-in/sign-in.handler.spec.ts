import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { AuthApplicationError } from "../../errors/auth-application.error.ts";
import { User } from "../../../domain/entities/user.entity.ts";
import { hashSecretSync } from "../../../../../platform/security/crypto.utils.js";
import { SignInCommand } from "./sign-in.command.ts";
import { SignInHandler } from "./sign-in.handler.ts";

const mockFn = <T = void>(val?: T) =>
  jest.fn((...args: unknown[]) => {
    void args;
    return Promise.resolve(val);
  });

describe("SignInHandler", () => {
  const now = 1_700_000_000_000;
  const correlationId = "test-corr-id";
  const rawPassword = "CorrectPassword123!";
  const passwordHash = hashSecretSync(rawPassword);

  const createMockSupport = () => ({
    createCorrelationId: () => correlationId,
    now: () => now,
    failedLoginLimit: 3,
    lockWindowMs: 5 * 60_000,
    recordAudit: mockFn(),
    createSession: mockFn({
      token: "issued-session-token",
      expiresAt: new Date(now + 8 * 3600_000),
    }),
    safeUserProjection: (user: User) => ({
      user_id: user.id,
      email: user.email.toString(),
      subject_attributes: { role: user.role },
    }),
    findMfaEnrollment: mockFn(null),
    isMfaRequired: mockFn(false),
    isMfaEnrolled: mockFn(false),
  });

  it("rejects when email does not exist and runs constant-time decoy comparison", async () => {
    const support = createMockSupport();
    const users = {
      findByPrimaryEmail: mockFn(null),
    };
    const sessions = {};
    const mfaEnrollments = {};

    const handler = new SignInHandler(
      support as never,
      users as never,
      sessions as never,
      mfaEnrollments as never,
    );

    const command = new SignInCommand(
      { email: "nonexistent@example.com", password: "SomePassword!" },
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: null,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidCredentials,
      }),
    );
  });

  it("rejects when account is currently locked out", async () => {
    const support = createMockSupport();
    const lockedUser = User.rehydrate({
      id: "locked-user",
      email: "locked@example.com",
      passwordHash,
      emailVerified: true,
      lockUntil: now + 60_000,
    });

    const users = {
      findByPrimaryEmail: mockFn(lockedUser),
    };
    const sessions = {};
    const mfaEnrollments = {};

    const handler = new SignInHandler(
      support as never,
      users as never,
      sessions as never,
      mfaEnrollments as never,
    );

    const command = new SignInCommand(
      { email: "locked@example.com", password: rawPassword },
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: "locked-user",
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.temporaryLock,
      }),
    );
  });

  it("rejects when password is wrong, records failed login attempt, and escalates lock", async () => {
    const support = createMockSupport();
    const activeUser = User.rehydrate({
      id: "active-user",
      email: "active@example.com",
      passwordHash,
      emailVerified: true,
    });

    const users = {
      findByPrimaryEmail: mockFn(activeUser),
      recordFailedLoginAttempt: mockFn({
        ...activeUser,
        lockUntil: now + 5 * 60_000,
      }),
    };
    const sessions = {};
    const mfaEnrollments = {};

    const handler = new SignInHandler(
      support as never,
      users as never,
      sessions as never,
      mfaEnrollments as never,
    );

    const command = new SignInCommand(
      { email: "active@example.com", password: "WrongPassword!" },
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(users.recordFailedLoginAttempt).toHaveBeenCalledWith(
      "active-user",
      passwordHash,
      now,
      3,
      300_000,
    );
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: "active-user",
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.temporaryLock,
      }),
    );
  });

  it("rejects when user accessStatus is suspended", async () => {
    const support = createMockSupport();
    const suspendedUser = User.rehydrate({
      id: "suspended-user",
      email: "suspended@example.com",
      passwordHash,
      emailVerified: true,
      accessStatus: USER_ACCESS_STATUSES.suspended,
    });

    const users = {
      findByPrimaryEmail: mockFn(suspendedUser),
    };
    const sessions = {};
    const mfaEnrollments = {};

    const handler = new SignInHandler(
      support as never,
      users as never,
      sessions as never,
      mfaEnrollments as never,
    );

    const command = new SignInCommand(
      { email: "suspended@example.com", password: rawPassword },
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
  });

  it("rejects when email is not verified", async () => {
    const support = createMockSupport();
    const unverifiedUser = User.rehydrate({
      id: "unverified-user",
      email: "unverified@example.com",
      passwordHash,
      emailVerified: false,
    });

    const users = {
      findByPrimaryEmail: mockFn(unverifiedUser),
      clearFailedLoginsIfCredentialsCurrent: mockFn(unverifiedUser),
    };
    const sessions = {};
    const mfaEnrollments = {};

    const handler = new SignInHandler(
      support as never,
      users as never,
      sessions as never,
      mfaEnrollments as never,
    );

    const command = new SignInCommand(
      { email: "unverified@example.com", password: rawPassword },
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: "unverified-user",
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.emailVerificationRequired,
      }),
    );
  });

  it("successfully signs in, creates session, and returns user projection", async () => {
    const support = createMockSupport();
    const activeUser = User.rehydrate({
      id: "user-1",
      email: "user@example.com",
      passwordHash,
      emailVerified: true,
    });

    const users = {
      findByPrimaryEmail: mockFn(activeUser),
      clearFailedLoginsIfCredentialsCurrent: mockFn(activeUser),
    };
    const sessions = {};
    const mfaEnrollments = {};

    const handler = new SignInHandler(
      support as never,
      users as never,
      sessions as never,
      mfaEnrollments as never,
    );

    const command = new SignInCommand(
      { email: "user@example.com", password: rawPassword },
      { correlationId },
    );

    const result = await handler.execute(command);
    expect(result.ok).toBe(true);
    expect(result.session_token).toBe("issued-session-token");
    expect(result.user.email).toBe("user@example.com");
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
        actor_id: "user-1",
        decision: AUDIT_DECISIONS.allow,
      }),
    );
  });
});
