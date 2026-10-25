import { randomUUID } from "node:crypto";

type SessionInput = {
  userId: string;
  accessVersion?: number;
  tokenHash: string;
  expiresAt: number;
  revokedAt?: number | null;
  mfaVerifiedAt?: number | null;
  mfaGenerationId?: string | null;
  sensitiveActionVerifiedAt?: number | null;
};

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

  revoke(now: number): void {
    this.revokedAt = now;
  }

  markMfaVerified(now: number): void {
    this.mfaVerifiedAt = now;
  }

  markSensitiveActionVerified(now: number): void {
    this.sensitiveActionVerifiedAt = now;
  }
}
