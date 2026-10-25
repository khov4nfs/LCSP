/** Compatibility facade for existing infrastructure and test imports. */
export {
  MFA_RECOVERY_CODE_COUNT,
  generateMfaRecoveryCode,
  generateMfaRecoveryCodes,
  normalizeMfaRecoveryCode,
  hashMfaRecoveryCode,
} from "../../application/security/mfa-recovery-code.utils.ts";
