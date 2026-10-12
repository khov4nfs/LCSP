export const MFA_VERIFY_METHODS = {
  otp: "otp",
  recoveryCode: "recovery_code",
} as const;

export type MfaVerifyMethod =
  (typeof MFA_VERIFY_METHODS)[keyof typeof MFA_VERIFY_METHODS];
