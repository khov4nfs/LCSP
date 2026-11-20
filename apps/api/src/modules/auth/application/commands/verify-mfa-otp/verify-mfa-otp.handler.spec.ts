import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { AuthApplicationError } from "../../errors/auth-application.error.ts";
import { MfaEnrollment } from "../../../domain/entities/mfa-enrollment.entity.ts";
import { Session } from "../../../domain/entities/session.entity.ts";
import {
  generateTotpSecret,
  totpForTime,
} from "../../../../../platform/security/totp.utils.js";
import { VerifyMfaOtpCommand } from "./verify-mfa-otp.command.ts";
import { VerifyMfaOtpHandler } from "./verify-mfa-otp.handler.ts";

const mockFn = <T = void>(val?: T) =>
  jest.fn((...args: unknown[]) => {
    void args;
    return Promise.resolve(val);
  });

describe("VerifyMfaOtpHandler", () => {
  const now = 1_700_000_000_000;
  const correlationId = "test-corr-id";
  const encryptedSecret = "encrypted-secret-payload";

  const createMockSupport = () => ({
    createCorrelationId: () => correlationId,
    now: () => now,
    recordAudit: mockFn(),
    findValidSession: mockFn(null),
  });

  it("rejects when session is invalid or expired", async () => {
    const support = createMockSupport();
    support.findValidSession.mockResolvedValue(null);

    const handler = new VerifyMfaOtpHandler(
      support as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const command = new VerifyMfaOtpCommand("invalid-token", "123456", {
      correlationId,
    });

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
  });

  it("rejects when rate limit is currently locked out", async () => {
    const support = createMockSupport();
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now + 3600_000,
    });
    support.findValidSession.mockResolvedValue(session as never);

    const mfaEnrollments = {
      findByUserId: mockFn(
        new MfaEnrollment({
          userId: "user-1",
          encryptedSecret,
          enrolledAt: now - 100_000,
        }),
      ),
    };

    const mfaRateLimits = {
      findByUserId: mockFn({
        isLocked: () => true,
      }),
      recordFailedAttempt: mockFn(),
    };

    const handler = new VerifyMfaOtpHandler(
      support as never,
      {} as never,
      {} as never,
      mfaEnrollments as never,
      mfaRateLimits as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const command = new VerifyMfaOtpCommand("valid-token", "123456", {
      correlationId,
    });

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRateLimited,
        actor_id: "user-1",
        decision: AUDIT_DECISIONS.deny,
      }),
    );
  });

  it("rejects when OTP is already used in replay protection table", async () => {
    const support = createMockSupport();
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now + 3600_000,
    });
    support.findValidSession.mockResolvedValue(session as never);

    const mfaEnrollments = {
      findByUserId: mockFn(
        new MfaEnrollment({
          userId: "user-1",
          encryptedSecret,
          enrolledAt: now - 100_000,
        }),
      ),
    };

    const mfaRateLimits = {
      findByUserId: mockFn({ isLocked: () => false }),
      recordFailedAttempt: mockFn(),
    };

    const mfaOtpUsed = {
      isUsed: mockFn(true),
    };

    const handler = new VerifyMfaOtpHandler(
      support as never,
      {} as never,
      {} as never,
      mfaEnrollments as never,
      mfaRateLimits as never,
      mfaOtpUsed as never,
      {} as never,
      {} as never,
    );

    const command = new VerifyMfaOtpCommand("valid-token", "123456", {
      correlationId,
    });

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(mfaRateLimits.recordFailedAttempt).toHaveBeenCalledWith(
      "user-1",
      now,
      5,
      15 * 60_000,
    );
  });

  it("rejects with retryRecovery required action when cipher decryption fails", async () => {
    const support = createMockSupport();
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now + 3600_000,
    });
    support.findValidSession.mockResolvedValue(session as never);

    const mfaEnrollments = {
      findByUserId: mockFn(
        new MfaEnrollment({
          userId: "user-1",
          encryptedSecret,
          enrolledAt: now - 100_000,
        }),
      ),
    };

    const mfaRateLimits = {
      findByUserId: mockFn({ isLocked: () => false }),
      recordFailedAttempt: mockFn(),
    };

    const mfaOtpUsed = {
      isUsed: mockFn(false),
    };

    const cipher = {
      decrypt: jest.fn((...args: unknown[]) => {
        void args;
        throw new Error("Corrupted ciphertext");
      }),
    };

    const handler = new VerifyMfaOtpHandler(
      support as never,
      {} as never,
      {} as never,
      mfaEnrollments as never,
      mfaRateLimits as never,
      mfaOtpUsed as never,
      cipher as never,
      {} as never,
    );

    const command = new VerifyMfaOtpCommand("valid-token", "123456", {
      correlationId,
    });

    try {
      await handler.execute(command);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthApplicationError);
      expect((error as AuthApplicationError).requiredAction).toBe(
        REQUIRED_ACTIONS.retryRecovery,
      );
    }
  });

  it("successfully elevates session on valid OTP", async () => {
    const support = createMockSupport();
    const freshSecret = generateTotpSecret();
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now + 3600_000,
    });
    support.findValidSession.mockResolvedValue(session as never);

    const mfaEnrollments = {
      findByUserId: mockFn(
        new MfaEnrollment({
          userId: "user-1",
          encryptedSecret,
          enrolledAt: now - 100_000,
        }),
      ),
    };

    const mfaRateLimits = {
      findByUserId: mockFn({ isLocked: () => false }),
      recordFailedAttempt: mockFn(),
    };

    const mfaOtpUsed = {
      isUsed: mockFn(false),
    };

    const cipher = {
      decrypt: jest.fn((...args: unknown[]) => {
        void args;
        return freshSecret;
      }),
    };

    const validOtp = totpForTime(freshSecret, now);

    const lifecycle = {
      verifyProof: mockFn({ ok: true }),
    };

    const handler = new VerifyMfaOtpHandler(
      support as never,
      {} as never,
      {} as never,
      mfaEnrollments as never,
      mfaRateLimits as never,
      mfaOtpUsed as never,
      cipher as never,
      lifecycle as never,
    );

    const command = new VerifyMfaOtpCommand("valid-token", validOtp, {
      correlationId,
    });

    const result = await handler.execute(command);
    expect(result).toEqual({ ok: true, correlationId });
    expect(lifecycle.verifyProof).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "session-1",
        proof: { kind: "OTP", otp: validOtp },
      }),
    );
  });
});
