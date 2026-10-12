import { afterEach, describe, expect, it } from "@jest/globals";

import { decryptMfaSecret, encryptMfaSecret } from "./security.utils.js";

describe("MFA secret encryption key", () => {
  const original = process.env.MFA_SECRET_ENCRYPTION_KEY;
  const legacy = process.env.MFA_ENCRYPTION_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.MFA_SECRET_ENCRYPTION_KEY;
    else process.env.MFA_SECRET_ENCRYPTION_KEY = original;
    if (legacy === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = legacy;
  });

  it("round-trips with the canonical MFA_SECRET_ENCRYPTION_KEY", () => {
    process.env.MFA_SECRET_ENCRYPTION_KEY = "ab".repeat(32);
    expect(decryptMfaSecret(encryptMfaSecret("JBSWY3DPEHPK3PXP"))).toBe(
      "JBSWY3DPEHPK3PXP",
    );
  });

  it("a different canonical key cannot decrypt", () => {
    process.env.MFA_SECRET_ENCRYPTION_KEY = "ab".repeat(32);
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
    process.env.MFA_SECRET_ENCRYPTION_KEY = "cd".repeat(32);
    expect(() => decryptMfaSecret(encrypted)).toThrow();
  });

  it("fails clearly when only the legacy MFA_ENCRYPTION_KEY is set", () => {
    delete process.env.MFA_SECRET_ENCRYPTION_KEY;
    process.env.MFA_ENCRYPTION_KEY = "ab".repeat(32);
    expect(() => encryptMfaSecret("x")).toThrow(
      "MFA_SECRET_ENCRYPTION_KEY must be set",
    );
  });
});
