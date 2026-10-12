import { randomUUID } from "node:crypto";

type OAuthIdentityInput = {
  userId: string;
  provider: string;
  providerAccountId: string;
  createdAt: number;
};

export class OAuthIdentity {
  readonly id: string;
  readonly userId: string;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly createdAt: number;

  constructor(input: OAuthIdentityInput) {
    this.id = randomUUID();
    this.userId = input.userId;
    this.provider = input.provider;
    this.providerAccountId = input.providerAccountId;
    this.createdAt = input.createdAt;
  }

  static rehydrate(input: OAuthIdentityInput & { id: string }): OAuthIdentity {
    const entity = new OAuthIdentity(input);
    Object.assign(entity, { id: input.id });
    return entity;
  }
}
