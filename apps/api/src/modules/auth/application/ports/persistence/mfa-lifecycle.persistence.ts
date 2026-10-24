import type { AuthErrorCode } from "@lcsp/contracts/auth";
import type { MfaEnrollment } from "../../../domain/models/auth.models.ts";
import type { MfaRecoveryCodeCreateInput } from "./mfa.repository.ts";

export const AUTH_MFA_LIFECYCLE_PERSISTENCE = Symbol(
  "AUTH_MFA_LIFECYCLE_PERSISTENCE",
);

export type MfaTransactionResult =
  | { ok: true; recoveryCodesCreated: boolean }
  | { ok: false; code: AuthErrorCode };

export type MfaEnrollmentCommit = {
  userId: string;
  sessionId: string;
  now: number;
  correlationId: string;
  enrollment: MfaEnrollment;
  /** Optimistic check: disallow writes based on an obsolete enrollment snapshot. */
  expectedEncryptedSecret: string | null;
  /** Only used when the prior ciphertext is no longer decryptable. */
  allowUnverifiedReplacement: boolean;
  candidateBatchId: string;
  candidateCodes: readonly MfaRecoveryCodeCreateInput[];
};

export type MfaRecoveryCodesCommit = {
  userId: string;
  sessionId: string;
  now: number;
  correlationId: string;
  expectedEncryptedSecret: string;
  batchId: string;
  codes: readonly MfaRecoveryCodeCreateInput[];
};

export const MFA_PROOF_TYPES = {
  otp: "OTP",
  recoveryCode: "RECOVERY_CODE",
} as const;

export type MfaProofCommit = {
  userId: string;
  sessionId: string;
  expectedEncryptedSecret: string;
  now: number;
  correlationId: string;
  proof:
    | { kind: typeof MFA_PROOF_TYPES.otp; otp: string }
    | { kind: typeof MFA_PROOF_TYPES.recoveryCode; codeHash: string };
};

export type MfaProofCommitResult =
  { ok: true } | { ok: false; code: AuthErrorCode };

/** Transactional use-case operations, independent of Prisma clients. */
export interface MfaLifecyclePersistence {
  enroll(input: MfaEnrollmentCommit): Promise<MfaTransactionResult>;
  replaceRecoveryCodes(
    input: MfaRecoveryCodesCommit,
  ): Promise<MfaTransactionResult>;
  verifyProof(input: MfaProofCommit): Promise<MfaProofCommitResult>;
}
