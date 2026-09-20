import { randomUUID } from "node:crypto";

type OAuthStateInput = {
  state: string;
  nonce: string;
  provider: string;
  redirectUri: string;
  expiresAt: number;
  userId?: string | null;
  sessionId?: string | null;
};

export class OAuthState {
  readonly id: string;
  readonly state: string;
  readonly nonce: string;
  readonly provider: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
  readonly userId: string | null;
  readonly sessionId: string | null;

  constructor(input: OAuthStateInput) {
    this.id = randomUUID();
    this.state = input.state;
    this.nonce = input.nonce;
    this.provider = input.provider;
    this.redirectUri = input.redirectUri;
    this.expiresAt = input.expiresAt;
    this.userId = input.userId ?? null;
    this.sessionId = input.sessionId ?? null;
  }

  static rehydrate(input: OAuthStateInput & { id: string }): OAuthState {
    const entity = new OAuthState(input);
    Object.assign(entity, { id: input.id });
    return entity;
  }

  isExpired(now: number): boolean {
    return this.expiresAt <= now;
  }

  isLinkState(): boolean {
    return this.userId !== null || this.sessionId !== null;
  }
}
