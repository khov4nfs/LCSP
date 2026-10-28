import { randomUUID } from "node:crypto";

export type CandidateMfaEnrollment = {
  encryptedSecret: string;
  generationId: string;
  batchId: string;
  enrolledAt: number;
};

type SessionInput = {
  userId: string;
  accessVersion?: number;
  tokenHash: string;
  expiresAt: number;
  revokedAt?: number | null;
  mfaVerifiedAt?: number | null;
  mfaGenerationId?: string | null;
  sensitiveActionVerifiedAt?: number | null;
  passwordReauthenticatedAt?: number | null;
  candidateMfaEnrollment?: CandidateMfaEnrollment | null;
};

export const SENSITIVE_ACTION_REAUTH_TTL_MS = 5 * 60_000;

export class Session {
  readonly id: string;
  readonly userId: string;
  readonly accessVersion: number;
  readonly tokenHash: string;
  readonly expiresAt: number;
  revokedAt: number | null;
  mfaVerifiedAt: number | null;
  readonly mfaGenerationId: string | null;
  sensitiveActionVerifiedAt: number | null;
  passwordReauthenticatedAt: number | null;
  candidateMfaEnrollment: CandidateMfaEnrollment | null;

  constructor(input: SessionInput) {
    this.id = randomUUID();
    this.userId = input.userId;
    this.accessVersion = input.accessVersion ?? 0;
    this.tokenHash = input.tokenHash;
    this.expiresAt = input.expiresAt;
    this.revokedAt = input.revokedAt ?? null;
    this.mfaVerifiedAt = input.mfaVerifiedAt ?? null;
    this.mfaGenerationId = input.mfaGenerationId ?? null;
    this.sensitiveActionVerifiedAt = input.sensitiveActionVerifiedAt ?? null;
    this.passwordReauthenticatedAt = input.passwordReauthenticatedAt ?? null;
    this.candidateMfaEnrollment = input.candidateMfaEnrollment ?? null;
  }

  static rehydrate(input: SessionInput & { id: string }): Session {
    const entity = new Session(input);
    Object.assign(entity, { id: input.id });
    return entity;
  }

  isActive(now: number): boolean {
    return this.revokedAt === null && this.expiresAt > now;
  }

  /**
   * Business purpose: Accept a session's second-factor proof only for the active account generation.
   *
   * Business rules:
   * - Proof timestamps alone must never authorize an MFA generation that has been rotated or disabled.
   *
   * Execution flow:
   * 1. Verify the recorded proof timestamp and exact enrollment generation identity.
   *
   * Failure cases:
   * - A missing timestamp or stale generation is treated as unverified.
   *
   * Side effects:
   * - None: evaluates the stored proof identity without mutating state.
   */
  isMfaVerified(currentGenerationId: string): boolean {
    return (
      this.mfaVerifiedAt !== null &&
      this.mfaGenerationId === currentGenerationId
    );
  }

  /**
   * Business purpose: Determine whether the session has valid, non-expired step-up reauthentication proof.
   *
   * Business rules:
   * - Verification must be non-null and within the sensitive action TTL (5 minutes).
   * - If an active generation is provided, the session's generation must match.
   *
   * Execution flow:
   * 1. Check generation match if provided.
   * 2. Verify sensitiveActionVerifiedAt is fresh against current time.
   *
   * Failure cases:
   * - Expired timestamp or mismatched generation returns false.
   *
   * Side effects:
   * - None: evaluates the stored proof identity without mutating state.
   */
  isSensitiveActionVerified(
    now: number,
    currentGenerationId?: string,
  ): boolean {
    if (currentGenerationId && this.mfaGenerationId !== currentGenerationId) {
      return false;
    }
    return (
      this.sensitiveActionVerifiedAt !== null &&
      now - this.sensitiveActionVerifiedAt <= SENSITIVE_ACTION_REAUTH_TTL_MS
    );
  }

  /**
   * Business purpose: Verify whether the session holds a fresh password re-authentication proof.
   *
   * Business rules:
   * - Password proof must be set explicitly from successful password verification.
   * - Verification must be non-null, within the 5-minute TTL, and match current MFA generation.
   * - MFA OTP or recovery-code verification must never satisfy this requirement.
   *
   * Execution flow:
   * 1. Reject if session MFA generation does not match the account's active generation.
   * 2. Validate that passwordReauthenticatedAt is within 5 minutes of now.
   *
   * Failure cases:
   * - Mismatched generation, null timestamp, or timestamp older than 5 minutes returns false.
   *
   * Side effects:
   * - None: read-only evaluation of in-memory session proof.
   */
  isPasswordReauthenticated(
    now: number,
    currentGenerationId?: string,
  ): boolean {
    if (currentGenerationId && this.mfaGenerationId !== currentGenerationId) {
      return false;
    }
    return (
      this.passwordReauthenticatedAt !== null &&
      now - this.passwordReauthenticatedAt <= SENSITIVE_ACTION_REAUTH_TTL_MS
    );
  }

  revoke(now: number): void {
    this.revokedAt = now;
  }

  markMfaVerified(now: number): void {
    this.mfaVerifiedAt = now;
  }

  markSensitiveActionVerified(now: number): void {
    this.sensitiveActionVerifiedAt = now;
  }

  /**
   * Business purpose: Mark the session as having freshly re-authenticated with account password.
   *
   * Business rules:
   * - Must only be invoked following successful constant-time password verification.
   * - Sets both passwordReauthenticatedAt and sensitiveActionVerifiedAt to the current epoch time.
   *
   * Execution flow:
   * 1. Update passwordReauthenticatedAt and sensitiveActionVerifiedAt to now.
   *
   * Failure cases:
   * - None: in-memory mutation.
   *
   * Side effects:
   * - Mutates in-memory session proof timestamps.
   */
  markPasswordReauthenticated(now: number): void {
    this.passwordReauthenticatedAt = now;
    this.sensitiveActionVerifiedAt = now;
  }

  /**
   * Business purpose: Stage or clear an in-progress candidate MFA enrollment on the session.
   *
   * Business rules:
   * - Binds an unconfirmed replacement factor exclusively to the initiating session.
   * - Does not alter the user's primary MFA enrollment or factor verification state.
   *
   * Execution flow:
   * 1. Assign candidate enrollment payload or null to instance property.
   *
   * Failure cases:
   * - None: in-memory state assignment.
   *
   * Side effects:
   * - Mutates in-memory session candidate enrollment state.
   */
  setCandidateMfaEnrollment(candidate: CandidateMfaEnrollment | null): void {
    this.candidateMfaEnrollment = candidate;
  }
}
