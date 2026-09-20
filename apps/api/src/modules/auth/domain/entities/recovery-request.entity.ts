import { randomUUID } from "node:crypto";

type RecoveryRequestInput = {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  consumedAt?: number | null;
};

export class RecoveryRequest {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: number;
  consumedAt: number | null;

  constructor(input: RecoveryRequestInput) {
    this.id = randomUUID();
    this.userId = input.userId;
    this.tokenHash = input.tokenHash;
    this.expiresAt = input.expiresAt;
    this.consumedAt = input.consumedAt ?? null;
  }

  static rehydrate(
    input: RecoveryRequestInput & { id: string },
  ): RecoveryRequest {
    const entity = new RecoveryRequest(input);
    Object.assign(entity, { id: input.id });
    return entity;
  }

  isValid(now: number): boolean {
    return this.consumedAt === null && this.expiresAt > now;
  }

  consume(now: number): void {
    this.consumedAt = now;
  }
}
