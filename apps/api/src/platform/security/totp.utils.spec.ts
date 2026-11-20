import { describe, expect, it } from "@jest/globals";
import {
  generateTotpSecret,
  resetTotpReplayTracker,
  totpForTime,
  unconsumeTotpOtp,
  verifyTotpOtp,
} from "./totp.utils.js";

describe("TotpUtils — RFC 6238 Replay Attack Reproducer", () => {
  it("rejects replayed OTP submission within the 150-second validity window (RED reproducer)", () => {
    resetTotpReplayTracker();
    const secret = generateTotpSecret();
    const t0 = 1700000000000;
    const otp = totpForTime(secret, t0);

    // First attempt must succeed
    const firstAttempt = verifyTotpOtp(secret, otp, t0);
    expect(firstAttempt).toBe(true);

    // Immediate replay attempt with the same OTP within active window must be rejected
    const replayAttemptImmediate = verifyTotpOtp(secret, otp, t0 + 5000);
    expect(replayAttemptImmediate).toBe(false);

    // Replay attempt at the boundary of the window must also be rejected
    const replayAttemptLater = verifyTotpOtp(secret, otp, t0 + 30000);
    expect(replayAttemptLater).toBe(false);
  });

  it("permits verification again after resetTotpReplayTracker is invoked", () => {
    resetTotpReplayTracker();
    const secret = generateTotpSecret();
    const t0 = 1700000000000;
    const otp = totpForTime(secret, t0);

    expect(verifyTotpOtp(secret, otp, t0)).toBe(true);
    expect(verifyTotpOtp(secret, otp, t0)).toBe(false);

    resetTotpReplayTracker();
    expect(verifyTotpOtp(secret, otp, t0)).toBe(true);
  });

  it("permits retry when unconsumeTotpOtp is called on transactional rollback", () => {
    resetTotpReplayTracker();
    const secret = generateTotpSecret();
    const t0 = 1700000000000;
    const otp = totpForTime(secret, t0);

    // Initial attempt marks step as consumed
    expect(verifyTotpOtp(secret, otp, t0)).toBe(true);
    expect(verifyTotpOtp(secret, otp, t0)).toBe(false);

    // Transaction fails, unconsume the step
    unconsumeTotpOtp(secret, t0);

    // Retry should now succeed
    expect(verifyTotpOtp(secret, otp, t0)).toBe(true);
  });

  it("does not cross-contaminate replay protection across distinct secrets", () => {
    resetTotpReplayTracker();
    const secret1 = generateTotpSecret();
    const secret2 = generateTotpSecret();
    const t0 = 1700000000000;
    const otp1 = totpForTime(secret1, t0);
    const otp2 = totpForTime(secret2, t0);

    expect(verifyTotpOtp(secret1, otp1, t0)).toBe(true);
    expect(verifyTotpOtp(secret2, otp2, t0)).toBe(true);

    expect(verifyTotpOtp(secret1, otp1, t0)).toBe(false);
    expect(verifyTotpOtp(secret2, otp2, t0)).toBe(false);
  });

  it("rejects non-digit or invalid length OTPs", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpOtp(secret, "abcdef", 1700000000000)).toBe(false);
    expect(verifyTotpOtp(secret, "12345", 1700000000000)).toBe(false);
    expect(verifyTotpOtp(secret, "1234567", 1700000000000)).toBe(false);
  });

  it("handles corrupted base32 secrets safely without throwing", () => {
    expect(
      verifyTotpOtp("invalid!base32!secret", "123456", 1700000000000),
    ).toBe(false);
  });
});
