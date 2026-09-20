export class MfaRateLimit {
  readonly userId: string;
  failedCount: number;
  lockedUntil: number | null;

  constructor(input: {
    userId: string;
    failedCount?: number;
    lockedUntil?: number | null;
  }) {
    this.userId = input.userId;
    this.failedCount = input.failedCount ?? 0;
    this.lockedUntil = input.lockedUntil ?? null;
  }

  isLocked(now: number): boolean {
    return this.lockedUntil !== null && this.lockedUntil > now;
  }

  recordFailedAttempt(now: number, limit: number, lockWindowMs: number): void {
    if (this.lockedUntil !== null && this.lockedUntil <= now) {
      this.failedCount = 0;
      this.lockedUntil = null;
    }

    this.failedCount += 1;
    if (this.failedCount >= limit) {
      this.lockedUntil = now + lockWindowMs;
    }
  }

  clearOnSuccess(): void {
    this.failedCount = 0;
    this.lockedUntil = null;
  }
}
