import type { OAuthIdentity } from "../../../domain/models/auth.models.ts";

export const AUTH_OAUTH_IDENTITY_REPOSITORY = Symbol(
  "AUTH_OAUTH_IDENTITY_REPOSITORY",
);

export interface OAuthIdentityRepository {
  findByProviderAccount(
    provider: string,
    providerAccountId: string,
  ): Promise<OAuthIdentity | null>;
  linkToUser(
    provider: string,
    providerAccountId: string,
    userId: string,
  ): Promise<OAuthIdentity>;
}
