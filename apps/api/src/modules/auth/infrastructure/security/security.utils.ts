import * as crypto from "node:crypto";

export {
  hashSecret,
  verifySecret,
  issueOpaqueToken,
  issueOAuthStateToken,
  fingerprintToken,
  createCorrelationId,
} from "../../../../platform/security/crypto.utils.js";

export {
  generateTotpSecret,
  totpForTime,
  verifyTotpOtp,
} from "../../../../platform/security/totp.utils.js";

// ─── MFA Secret Encryption (AES-256-GCM) ──────────────────────────

function deriveMfaEncKey(): Buffer {
  const raw = process.env.MFA_SECRET_ENCRYPTION_KEY;
  // Same rule as the Joi schema in config.ts: exactly 64 hex characters.
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "MFA_SECRET_ENCRYPTION_KEY must be set to 64 hex characters — refusing to encrypt MFA secrets with a default key",
    );
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptMfaSecret(plaintext: string): string {
  const key = deriveMfaEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${ciphertext.toString("hex")}.${tag.toString("hex")}`;
}

export function decryptMfaSecret(encrypted: string): string {
  const parts = encrypted.split(".");
  if (parts.length !== 3) throw new Error("Invalid MFA secret ciphertext");
  const [ivHex, ciphertextHex, tagHex] = parts;
  const key = deriveMfaEncKey();
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
