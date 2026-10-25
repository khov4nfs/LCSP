import { Injectable } from "@nestjs/common";

import type { MfaSecretCipher } from "../../application/ports/security/mfa-secret-cipher.port.ts";
import { decryptMfaSecret, encryptMfaSecret } from "./security.utils.ts";

@Injectable()
export class MfaSecretCipherService implements MfaSecretCipher {
  encrypt(plaintext: string): string {
    return encryptMfaSecret(plaintext);
  }

  decrypt(ciphertext: string): string {
    return decryptMfaSecret(ciphertext);
  }
}
