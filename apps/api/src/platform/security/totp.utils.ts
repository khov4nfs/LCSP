import * as crypto from "node:crypto";

// ─── TOTP (RFC 6238) ──────────────────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_WINDOW_STEPS = 2;

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase();
  let paddingStart = normalized.length;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "=") {
      paddingStart = index;
      break;
    }
  }
  for (let index = paddingStart; index < normalized.length; index += 1) {
    if (normalized[index] !== "=") {
      throw new Error("Invalid base32 padding");
    }
  }
  const str = normalized.slice(0, paddingStart);
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of str) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function hotp(secretBytes: Buffer, counter: bigint): string {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(counter);
  const hmac = crypto.createHmac("sha1", secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpForTime(secret: string, nowMs: number): string {
  const secretBytes = base32Decode(secret);
  const step = BigInt(Math.floor(nowMs / 1000 / 30));
  return hotp(secretBytes, step);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against a same-length buffer so the timing profile doesn't
    // reveal the expected length via an early bail-out.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyTotpOtp(
  secret: string,
  otp: string,
  nowMs: number,
): boolean {
  if (!/^\d{6}$/.test(otp)) return false;
  const secretBytes = base32Decode(secret);
  const step = Math.floor(nowMs / 1000 / 30);
  let matched = false;
  // Allow modest client clock skew beyond +/-30s. In practice authenticator
  // devices can drift by more than one window even when the user enters the
  // currently displayed code immediately.
  for (let i = -TOTP_WINDOW_STEPS; i <= TOTP_WINDOW_STEPS; i++) {
    if (timingSafeEqualStrings(hotp(secretBytes, BigInt(step + i)), otp)) {
      matched = true;
    }
  }
  return matched;
}
