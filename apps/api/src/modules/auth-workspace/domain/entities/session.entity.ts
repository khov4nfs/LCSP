import { randomUUID } from "node:crypto";

type SessionInput = {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  revokedAt?: number | null;
  mfaVerifiedAt?: number | null;
  sensitiveActionVerifiedAt?: number | null;
};

export class Session {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: number;
  revokedAt: number | null;
  mfaVerifiedAt: number | null;
  sensitiveActionVerifiedAt: number | null;

  constructor(input: SessionInput) {
    this.id = randomUUID();
    this.userId = input.userId;
    this.tokenHash = input.tokenHash;
    this.expiresAt = input.expiresAt;
    this.revokedAt = input.revokedAt ?? null;
    this.mfaVerifiedAt = input.mfaVerifiedAt ?? null;
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

  isMfaVerified(): boolean {
    return this.mfaVerifiedAt !== null;
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
