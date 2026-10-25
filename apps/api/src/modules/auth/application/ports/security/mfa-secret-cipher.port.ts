/** Port for MFA secret encryption. Key material stays in the adapter. */
export const AUTH_MFA_SECRET_CIPHER = Symbol("AUTH_MFA_SECRET_CIPHER");

export interface MfaSecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}
