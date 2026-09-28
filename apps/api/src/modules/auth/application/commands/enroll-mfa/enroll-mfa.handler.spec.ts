import { AUTH_ERROR_CODES, USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";
import { HttpException } from "@nestjs/common";

import { Session, User } from "../../../domain/models/auth.models.ts";
import { MfaEnrollment } from "../../../domain/entities/mfa-enrollment.entity.ts";
import { EnrollMfaCommand } from "./enroll-mfa.command.ts";
import { EnrollMfaHandler } from "./enroll-mfa.handler.ts";

describe("EnrollMfaHandler", () => {
  const createMockSupport = () => ({
    createCorrelationId: () => "corr-123",
    now: () => 1_700_000_000_000,
    recordAudit: jest.fn(() => Promise.resolve()),
  });

  it("rejects when the user is suspended even if an unverified MFA enrollment exists", async () => {
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: 1_800_000_000_000,
      mfaVerifiedAt: null,
    });

    const suspendedUser = User.rehydrate({
      id: "user-1",
      email: "suspended@example.com",
      passwordHash: "hash",
      emailVerified: true,
      accessStatus: USER_ACCESS_STATUSES.suspended,
    });

    const existingEnrollment = new MfaEnrollment({
      userId: "user-1",
      encryptedSecret: "ciphertext:iv:tag",
      enrolledAt: 1_650_000_000_000,
      verifiedAt: 1_650_000_000_000,
    });

    const support = createMockSupport();
    const sessions = {
      findById: jest.fn(() => Promise.resolve(session)),
    };
    const users = {
      findById: jest.fn(() => Promise.resolve(suspendedUser)),
    };
    const mfaEnrollments = {
      findByUserId: jest.fn(() => Promise.resolve(existingEnrollment)),
      save: jest.fn(() => Promise.resolve()),
    };
    const mfaOtpUsed = {
      deleteByUserId: jest.fn(() => Promise.resolve()),
    };
    const mfaRateLimits = {
      resetByUserId: jest.fn(() => Promise.resolve()),
    };
    const mfaRecoveryCodes = {
      findByUserId: jest.fn(() => Promise.resolve([])),
      saveBatch: jest.fn(() => Promise.resolve()),
    };

    const handler = new EnrollMfaHandler(
      support as never,
      sessions as never,
      mfaEnrollments as never,
      mfaOtpUsed as never,
      mfaRateLimits as never,
      mfaRecoveryCodes as never,
      users as never,
    );

    let thrown: unknown;
    try {
      await handler.execute(
        new EnrollMfaCommand("user-1", "session-1", {
          correlationId: "corr-123",
        }),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.accountSuspended },
    });
  });

  it("rejects with sessionInvalid when user is not found in database", async () => {
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-unknown",
      tokenHash: "hash",
      expiresAt: 1_800_000_000_000,
      mfaVerifiedAt: null,
    });

    const support = createMockSupport();
    const sessions = {
      findById: jest.fn(() => Promise.resolve(session)),
    };
    const users = {
      findById: jest.fn(() => Promise.resolve(null)),
    };
    const mfaEnrollments = {
      findByUserId: jest.fn(() => Promise.resolve(null)),
      save: jest.fn(() => Promise.resolve()),
    };
    const mfaOtpUsed = {
      deleteByUserId: jest.fn(() => Promise.resolve()),
    };
    const mfaRateLimits = {
      resetByUserId: jest.fn(() => Promise.resolve()),
    };
    const mfaRecoveryCodes = {
      findByUserId: jest.fn(() => Promise.resolve([])),
      saveBatch: jest.fn(() => Promise.resolve()),
    };

    const handler = new EnrollMfaHandler(
      support as never,
      sessions as never,
      mfaEnrollments as never,
      mfaOtpUsed as never,
      mfaRateLimits as never,
      mfaRecoveryCodes as never,
      users as never,
    );

    let thrown: unknown;
    try {
      await handler.execute(
        new EnrollMfaCommand("user-unknown", "session-1", {
          correlationId: "corr-123",
        }),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.sessionInvalid },
    });
  });
});
