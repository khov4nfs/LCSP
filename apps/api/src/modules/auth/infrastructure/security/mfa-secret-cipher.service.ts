import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../../../../config/config.types.js";
import type { MfaSecretCipher } from "../../application/ports/security/mfa-secret-cipher.port.ts";
import { decryptMfaSecret, encryptMfaSecret } from "./security.utils.ts";

@Injectable()
export class MfaSecretCipherService implements MfaSecretCipher {
  constructor(
    @Optional()
    private readonly configService?: ConfigService<AppConfig>,
  ) {}

  /**
   * Business purpose:
   * Encrypts plaintext MFA TOTP secrets using AES-256-GCM before database persistence.
   *
   * Business rules:
   * - Requires a validated 64-character hex encryption key from application configuration or environment.
   * - Ciphertext must include initialization vector, encrypted payload, and authentication tag.
   *
   * Execution flow:
   * 1. Retrieve the configured MFA encryption key from ConfigService or environment fallback.
   * 2. Delegate to AES-256-GCM cipher encryption utility.
   * 3. Return serialized dot-delimited IV, ciphertext, and tag string.
   *
   * Failure cases:
   * - Throws Error if encryption key is missing or not 64 hex characters.
   *
   * Side effects:
   * - None; pure cryptographic transformation.
   */
  encrypt(plaintext: string): string {
    const key = this.configService?.get("mfa", {
      infer: true,
    })?.secretEncryptionKey;
    return encryptMfaSecret(plaintext, key);
  }

  /**
   * Business purpose:
   * Decrypts persisted dot-delimited MFA TOTP ciphertext into plaintext for TOTP token validation.
   *
   * Business rules:
   * - Requires valid 3-part dot-delimited ciphertext (iv.ciphertext.tag).
   * - Verifies authentication tag integrity to detect tampering.
   *
   * Execution flow:
   * 1. Retrieve the configured MFA encryption key from ConfigService or environment fallback.
   * 2. Delegate to AES-256-GCM decipher utility.
   * 3. Return decoded UTF-8 plaintext MFA secret.
   *
   * Failure cases:
   * - Throws Error if ciphertext format is invalid, key is missing/invalid, or authentication tag verification fails.
   *
   * Side effects:
   * - None; pure cryptographic transformation.
   */
  decrypt(ciphertext: string): string {
    const key = this.configService?.get("mfa", {
      infer: true,
    })?.secretEncryptionKey;
    return decryptMfaSecret(ciphertext, key);
  }
}
