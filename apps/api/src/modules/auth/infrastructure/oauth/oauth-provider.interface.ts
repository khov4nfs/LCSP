export type OAuthAuthorizationRequest = {
  state: string;
  nonce: string;
  redirectUri: string;
};

export type OAuthCallbackInput = {
  code: string;
  redirectUri: string;
  expectedNonce: string;
};

/**
 * Claims recovered from the provider's callback. `nonce`/`issuer`/`audience`/
 * `expiresAt` are `null` only for providers that cannot cryptographically
 * source that claim. Real OIDC providers should populate each verifiable claim.
 */
export type OAuthCallbackClaims = {
  providerAccountId: string;
  /** A provider-verified email, when the provider exposes one. */
  email?: string | null;
  emailVerified?: boolean;
  nonce: string | null;
  issuer: string | null;
  audience: string | null;
  expiresAt: number | null;
};

export class OAuthCallbackError extends Error {}

export interface OAuthProvider {
  readonly name: string;
  /** Issuer this provider's claims must match; `null` if not verifiable for this provider. */
  readonly expectedIssuer: string | null;
  /** Audience this provider's claims must match; `null` if not verifiable for this provider. */
  readonly expectedAudience: string | null;

  buildAuthorizationUrl(request: OAuthAuthorizationRequest): string;

  /** Exchanges the callback code for claims. Throws OAuthCallbackError on any failure — never leaks provider error detail to the caller. */
  handleCallback(input: OAuthCallbackInput): Promise<OAuthCallbackClaims>;
}
