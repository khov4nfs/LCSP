import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  AuditSanitizer,
  sanitizeRecordSecrets,
  sanitizeStringSecrets,
} from "./audit-sanitizer.js";

describe("AuditSanitizer", () => {
  it("returns undefined payload and no removed keys when payload is absent", () => {
    const result = AuditSanitizer.sanitize(undefined);

    expect(result).toEqual({ payload: undefined, removedKeys: [] });
  });

  it("keeps all fields when none match the sensitive pattern", () => {
    const result = AuditSanitizer.sanitize({ userId: "u-1", action: "login" });

    expect(result).toEqual({
      payload: { userId: "u-1", action: "login" },
      removedKeys: [],
    });
  });

  it.each([
    "password",
    "passwordHash",
    "sessionToken",
    "apiSecret",
    "apiKey",
    "mfaNonce",
    "verificationCode",
    "contentHash",
    "otp",
    "totp",
    "setupUri",
    "setup_uri",
    "qrCode",
    "qr_code",
    "signature",
    "credential",
    "cookie",
    "authorization",
  ])("strips sensitive-keyed field %s and reports it as removed", (key) => {
    const result = AuditSanitizer.sanitize({
      [key]: "sensitive-value",
      safe: "ok",
    });

    expect(result.payload).toEqual({ safe: "ok" });
    expect(result.removedKeys).toEqual([key]);
  });

  it("strips multiple sensitive fields at once", () => {
    const result = AuditSanitizer.sanitize({
      passwordHash: "x",
      sessionToken: "y",
      userId: "u-1",
    });

    expect(result.payload).toEqual({ userId: "u-1" });
    expect(result.removedKeys.sort()).toEqual(["passwordHash", "sessionToken"]);
  });

  it("removes sensitive keys recursively", () => {
    const result = AuditSanitizer.sanitize({
      safe: true,
      details: {
        apiKey: "secret",
        attempts: [{ recoveryCode: "secret", result: "ok" }],
      },
    });

    expect(result.payload).toEqual({
      safe: true,
      details: { attempts: [{ result: "ok" }] },
    });
    expect(result.removedKeys).toEqual([
      "details.apiKey",
      "details.attempts[0].recoveryCode",
    ]);
  });

  it("retains audit reason code fields while still stripping other code secrets", () => {
    const result = AuditSanitizer.sanitize({
      reason_code: AUTH_ERROR_CODES.invalidCredentials,
      reasonCode: AUTH_ERROR_CODES.invalidCredentials,
      verificationCode: "123456",
    });

    expect(result.payload).toEqual({
      reason_code: AUTH_ERROR_CODES.invalidCredentials,
      reasonCode: AUTH_ERROR_CODES.invalidCredentials,
    });
    expect(result.removedKeys).toEqual(["verificationCode"]);
  });

  it("redacts secrets embedded in free-text values", () => {
    const result = AuditSanitizer.sanitize({
      statementValue:
        "Customer pasted api_key=super-secret-value and Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    });

    expect(result.payload?.statementValue).toBe(
      "Customer pasted api_key=[REDACTED] and [REDACTED]",
    );
    expect(result.removedKeys).toEqual(["statementValue"]);
  });

  it("redacts secrets inside primitive array values", () => {
    const result = AuditSanitizer.sanitize({
      notes: ["safe note", "password=hunter2", "Bearer abc.def.ghi"],
    });

    expect(result.payload?.notes).toEqual([
      "safe note",
      "password=[REDACTED]",
      "[REDACTED]",
    ]);
    expect(result.removedKeys).toEqual(["notes[1]", "notes[2]"]);
  });

  it("bounds oversized free-text values to avoid raw source dumps in audit payloads", () => {
    const value = "x".repeat(5000);
    const result = AuditSanitizer.sanitize({ interpretation: value });

    const sanitized = result.payload?.interpretation;
    expect(typeof sanitized).toBe("string");
    expect((sanitized as string).length).toBeLessThan(value.length);
    expect(sanitized).toContain("...[TRUNCATED]");
    expect(result.removedKeys).toEqual(["interpretation"]);
  });

  it("retains extended safe code and id keys without stripping them", () => {
    const result = AuditSanitizer.sanitize({
      error_code: "INTERNAL_ERROR",
      errorCode: "NOT_FOUND",
      status_code: 500,
      statusCode: 404,
      correlation_id: "corr-123",
      correlationId: "corr-456",
      otp_failure_reason: "invalid",
      otpFailureReason: "replayed",
      recovery_code_failure_reason: "exhausted",
      recoveryCodeFailureReason: "invalid",
      actualSecretCode: "secret-123",
      actualOtpSecret: "654321",
    });

    expect(result.payload).toEqual({
      error_code: "INTERNAL_ERROR",
      errorCode: "NOT_FOUND",
      status_code: 500,
      statusCode: 404,
      correlation_id: "corr-123",
      correlationId: "corr-456",
      otp_failure_reason: "invalid",
      otpFailureReason: "replayed",
      recovery_code_failure_reason: "exhausted",
      recoveryCodeFailureReason: "invalid",
    });
    expect(result.removedKeys.sort()).toEqual(
      ["actualOtpSecret", "actualSecretCode"].sort(),
    );
  });

  it("redacts GitHub PAT, Anthropic/OpenAI keys, OTP URIs, and synthetic secret markers in text", () => {
    const fakeGhp = ["ghp", "_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("");
    const fakePat = ["github", "_pat_11ABCDEFG_1234567890abcdef"].join("");
    const fakeAnt = ["sk", "-ant-api03-abcdef1234567890"].join("");
    const fakeProj = ["sk", "-proj-1234567890abcdef"].join("");
    const text = `GitHub: ${fakeGhp} and ${fakePat}. AI: ${fakeAnt} and ${fakeProj}. URI: otpauth://totp/LCSP:user@test.org?secret=JBSWY3DPEHPK3PXP&issuer=LCSP. Synthetic: synthetic-secret-token-value.`;
    const sanitized = sanitizeStringSecrets(text);

    expect(sanitized).not.toContain("ghp_");
    expect(sanitized).not.toContain("github_pat_");
    expect(sanitized).not.toContain("sk-ant-api03-");
    expect(sanitized).not.toContain("sk-proj-");
    expect(sanitized).not.toContain("otpauth://");
    expect(sanitized).not.toContain("synthetic-secret-token-value");
    expect(sanitized).toContain("[REDACTED]");
  });

  it("sanitizeRecordSecrets cleans string values across nested records and arrays", () => {
    const fakeBearer = ["Bearer ghp", "_token1234567890"].join("");
    const fakeAiKey = ["sk", "-ant-api03-secretkey123456789"].join("");
    const record = {
      safe: "hello",
      deep: {
        tokenString: fakeBearer,
        nestedList: [fakeAiKey, "clean-item"],
      },
    };

    const sanitized = sanitizeRecordSecrets(record);
    expect(sanitized.safe).toBe("hello");
    expect((sanitized.deep as { tokenString: string }).tokenString).toBe(
      "[REDACTED]",
    );
    expect((sanitized.deep as { nestedList: string[] }).nestedList[0]).toBe(
      "[REDACTED]",
    );
    expect((sanitized.deep as { nestedList: string[] }).nestedList[1]).toBe(
      "clean-item",
    );
  });
});
