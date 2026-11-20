import * as crypto from "node:crypto";

// ─── TOTP (RFC 6238) ──────────────────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_WINDOW_STEPS = 2;
const STEP_WINDOW_TTL_MS = (TOTP_WINDOW_STEPS * 2 + 2) * 30_000; // 180 seconds TTL
const MAX_TRACKER_ENTRIES_BEFORE_PRUNE = 1000;

/**
 * In-memory replay tracking map for consumed TOTP time-steps.
 * Rationale (Why): RFC 6238 Section 5.2 explicitly requires that any TOTP token
 * can be used at most once. Without consumed-step tracking, an attacker intercepting
 * an OTP can replay it multiple times within the 150-second validity window.
 * Mechanism (How): Keyed by `${sha256(secret)}:${stepCounter}` with expiration TTL.
 * Invariants (What): Expired entries are pruned; replays within active window are rejected.
 */
const consumedTotpSteps = new Map<string, number>();

/**
 * Resets the in-memory TOTP replay tracker. Intended for test isolation.
 */
export function resetTotpReplayTracker(): void {
  consumedTotpSteps.clear();
}

/**
 * Unmarks a consumed TOTP time-step if the surrounding database transaction rolled back.
 * Rationale (Why): When audit or database write fails in verifyProof, the OTP
 * consumption is transactionally rolled back. This function allows the in-memory
 * tracker to stay consistent with the database rollback so valid retries succeed.
 * Mechanism (How): Deletes keys matching `${secretHash}:${candidateStep}` for candidate steps in window.
 * Invariants (What): Only unmarks candidate steps within the active TOTP_WINDOW_STEPS drift window.
 */
export function unconsumeTotpOtp(secret: string, nowMs: number): void {
  const secretHash = crypto.createHash("sha256").update(secret).digest("hex");
  const step = Math.floor(nowMs / 1000 / 30);
  for (let i = -TOTP_WINDOW_STEPS; i <= TOTP_WINDOW_STEPS; i++) {
    consumedTotpSteps.delete(`${secretHash}:${step + i}`);
  }
}

/**
 * Prunes expired step entries from the replay tracking map.
 */
function pruneExpiredTotpSteps(nowMs: number): void {
  for (const [key, expiresAt] of consumedTotpSteps.entries()) {
    if (expiresAt <= nowMs) {
      consumedTotpSteps.delete(key);
    }
  }
}

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

/**
 * Business purpose: Verify a time-based one-time password (TOTP) against a shared secret with replay attack defense.
 * Business rules:
 * - OTP must be a valid 6-digit numeric string.
 * - Secret must decode to valid base32 bytes.
 * - Current time window allows drift up to +/-2 steps (+/-60 seconds, 150-second total verification window).
 * - RFC 6238 Section 5.2 invariant: Any OTP verified for a specific time-step counter cannot be reused (consumed step rejection).
 * Execution flow:
 * 1. Validate that the OTP is a 6-digit string.
 * 2. Decode the base32 secret into raw bytes.
 * 3. Calculate current step counter: Math.floor(nowMs / 1000 / 30).
 * 4. Loop across window steps [-TOTP_WINDOW_STEPS, TOTP_WINDOW_STEPS].
 * 5. Compute HOTP code for each candidate step using constant-time comparison.
 * 6. If match is found, check replay tracker for candidate step key `${secretHash}:${candidateStep}`.
 * 7. If step was already consumed, reject verification (return false).
 * 8. If step is unconsumed, record step consumption with expiration TTL and return true.
 * Failure cases:
 * - Returns false if OTP format is invalid.
 * - Returns false if base32 secret is corrupted.
 * - Returns false if no step within window produces matching HOTP.
 * - Returns false if the matching step was previously consumed (replay attack).
 * Side effects:
 * - Records consumed step into in-memory consumedTotpSteps map.
 */
export function verifyTotpOtp(
  secret: string,
  otp: string,
  nowMs: number,
): boolean {
  if (!/^\d{6}$/.test(otp)) return false;

  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(secret);
  } catch {
    return false;
  }

  if (consumedTotpSteps.size > MAX_TRACKER_ENTRIES_BEFORE_PRUNE) {
    pruneExpiredTotpSteps(nowMs);
  }

  const secretHash = crypto.createHash("sha256").update(secret).digest("hex");
  const step = Math.floor(nowMs / 1000 / 30);

  // Rationale (Why): Allow modest client clock skew beyond +/-30s up to +/-60s.
  // Mechanism (How): Loop over relative step offsets [-2, +2].
  // Invariants (What): Constant-time string comparison protects against side-channel timing leaks.
  for (let i = -TOTP_WINDOW_STEPS; i <= TOTP_WINDOW_STEPS; i++) {
    const candidateStep = step + i;
    if (timingSafeEqualStrings(hotp(secretBytes, BigInt(candidateStep)), otp)) {
      const cacheKey = `${secretHash}:${candidateStep}`;
      const existingExpiration = consumedTotpSteps.get(cacheKey);

      // Rationale (Why): RFC 6238 Section 5.2 strict replay defense.
      // Mechanism (How): Reject any OTP verified previously for this counter step within active TTL.
      // Invariants (What): Multiple submissions of the same OTP return false.
      if (existingExpiration !== undefined && existingExpiration > nowMs) {
        return false;
      }

      // Mark the time-step as consumed until it rolls past the valid window
      consumedTotpSteps.set(cacheKey, nowMs + STEP_WINDOW_TTL_MS);
      return true;
    }
  }

  return false;
}
