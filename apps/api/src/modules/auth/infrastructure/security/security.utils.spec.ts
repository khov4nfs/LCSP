import { describe, expect, it } from "@jest/globals";

import {
  generateMfaRecoveryCode,
  normalizeMfaRecoveryCode,
} from "./mfa-recovery-code.utils.js";
import { totpForTime } from "./security.utils.js";

describe("authentication security primitives", () => {
  it("generates recovery codes in the established format", () => {
    const code = generateMfaRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/u);
    expect(normalizeMfaRecoveryCode(code)).toHaveLength(12);
  });

  it("retains RFC-compatible Base32 TOTP decoding", () => {
    expect(totpForTime("JBSWY3DPEHPK3PXP", 0)).toMatch(/^\d{6}$/u);
  });

  it("rejects non-terminal Base32 padding deterministically", () => {
    expect(() => totpForTime("JBS= WY3DPEHPK3PXP", 0)).toThrow(
      "Invalid base32 padding",
    );
  });
});
