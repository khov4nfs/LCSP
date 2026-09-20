import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  OAuthCallbackError,
  type OAuthAuthorizationRequest,
  type OAuthCallbackClaims,
  type OAuthCallbackInput,
  type OAuthProvider,
} from "./oauth-provider.interface.ts";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_ISSUER = "https://accounts.google.com";

@Injectable()
export class GoogleOAuthProvider implements OAuthProvider {
  readonly name = "google";
  readonly expectedIssuer = GOOGLE_ISSUER;

  constructor(private readonly configService: ConfigService) {}

  get expectedAudience(): string {
    return this.configService.get<string>("oauth.googleClientId", "");
  }

  get isConfigured(): boolean {
    return Boolean(
      this.expectedAudience &&
      this.configService.get<string>("oauth.googleClientSecret", ""),
    );
  }

  buildAuthorizationUrl(request: OAuthAuthorizationRequest): string {
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set("client_id", this.expectedAudience);
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", request.state);
    url.searchParams.set("nonce", request.nonce);
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  async handleCallback(
    input: OAuthCallbackInput,
  ): Promise<OAuthCallbackClaims> {
    const idToken = await this.exchangeCodeForIdToken(input);
    return this.verifyIdToken(idToken);
  }

  private async exchangeCodeForIdToken(
    input: OAuthCallbackInput,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.expectedAudience,
      client_secret: this.configService.get<string>(
        "oauth.googleClientSecret",
        "",
      ),
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    });

    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch {
      throw new OAuthCallbackError("google_token_exchange_unreachable");
    }

    if (!response.ok) {
      throw new OAuthCallbackError("google_token_exchange_failed");
    }

    const payload = (await response.json().catch(() => null)) as {
      id_token?: unknown;
    } | null;
    if (!payload || typeof payload.id_token !== "string" || !payload.id_token) {
      throw new OAuthCallbackError("google_token_exchange_failed");
    }
    return payload.id_token;
  }

  private async verifyIdToken(idToken: string): Promise<OAuthCallbackClaims> {
    const endpoint = new URL(GOOGLE_TOKEN_INFO_URL);
    endpoint.searchParams.set("id_token", idToken);

    let response: Response;
    try {
      response = await fetch(endpoint);
    } catch {
      throw new OAuthCallbackError("google_token_verification_unreachable");
    }

    if (!response.ok) {
      throw new OAuthCallbackError("google_token_verification_failed");
    }

    const payload = (await response.json().catch(() => null)) as {
      sub?: unknown;
      email?: unknown;
      email_verified?: unknown;
      nonce?: unknown;
      iss?: unknown;
      aud?: unknown;
      exp?: unknown;
    } | null;
    if (
      !payload ||
      typeof payload.sub !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.iss !== "string" ||
      typeof payload.aud !== "string" ||
      (typeof payload.exp !== "string" && typeof payload.exp !== "number")
    ) {
      throw new OAuthCallbackError("google_token_verification_failed");
    }

    const expiresAt = Number(payload.exp) * 1000;
    if (!Number.isFinite(expiresAt)) {
      throw new OAuthCallbackError("google_token_verification_failed");
    }

    return {
      providerAccountId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      emailVerified:
        payload.email_verified === true || payload.email_verified === "true",
      nonce: payload.nonce,
      issuer:
        payload.iss === "accounts.google.com" ? GOOGLE_ISSUER : payload.iss,
      audience: payload.aud,
      expiresAt,
    };
  }
}
