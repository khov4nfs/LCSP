import type { MfaRecoveryCodeAccessAction } from "@lcsp/contracts/auth";

export type { MfaRecoveryCodeAccessAction };

export type EnrollMfaSuccess = {
  ok: true;
  correlationId: string;
  totp_uri: string;
  recovery_codes: string[];
};

export type VerifyMfaOtpSuccess = {
  ok: true;
  correlationId: string;
};

export type VerifyMfaRecoveryCodeSuccess = {
  ok: true;
  correlationId: string;
};

export type GenerateMfaRecoveryCodesSuccess = {
  ok: true;
  correlationId: string;
  recovery_codes: string[];
};

export type RecordMfaRecoveryCodeAccessSuccess = {
  ok: true;
  correlationId: string;
};

export type DisableMfaSuccess = {
  ok: true;
  correlationId: string;
};
