import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { AuditSanitizer } from "./audit-sanitizer.js";

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
});
