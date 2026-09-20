import * as crypto from "node:crypto";

import { fingerprintToken } from "./security.utils.ts";

const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_SEGMENT_LENGTH = 4;
const RECOVERY_CODE_SEGMENT_COUNT = 3;

export const MFA_RECOVERY_CODE_COUNT = 10;

export function generateMfaRecoveryCode(): string {
  const chars: string[] = [];
  const byteCount = RECOVERY_CODE_SEGMENT_LENGTH * RECOVERY_CODE_SEGMENT_COUNT;
  for (const byte of crypto.randomBytes(byteCount)) {
    chars.push(RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length]);
  }
  const segments: string[] = [];
  for (
    let index = 0;
    index < chars.length;
    index += RECOVERY_CODE_SEGMENT_LENGTH
  ) {
    segments.push(
      chars.slice(index, index + RECOVERY_CODE_SEGMENT_LENGTH).join(""),
    );
  }
  return segments.join("-");
}

export function generateMfaRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < MFA_RECOVERY_CODE_COUNT) {
    codes.add(generateMfaRecoveryCode());
  }
  return [...codes];
}

export function normalizeMfaRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replaceAll(/\s+/g, "").replaceAll("-", "");
}

export function hashMfaRecoveryCode(code: string): string {
  return fingerprintToken(normalizeMfaRecoveryCode(code));
}
