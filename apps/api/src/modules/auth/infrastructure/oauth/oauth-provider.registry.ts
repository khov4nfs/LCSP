import { Injectable } from "@nestjs/common";

import { GoogleOAuthProvider } from "./google-oauth.provider.ts";
import type {
  OAuthProvider,
  OAuthProviderResolver,
} from "../../application/ports/oauth/oauth-provider.port.ts";

@Injectable()
export class OAuthProviderRegistry implements OAuthProviderResolver {
  private readonly providers: ReadonlyMap<string, OAuthProvider>;

  constructor(googleProvider: GoogleOAuthProvider) {
    const providers: [string, OAuthProvider][] = [];
    if (googleProvider.isConfigured) {
      providers.push([googleProvider.name, googleProvider]);
    }
    this.providers = new Map(providers);
  }

  resolve(name: string): OAuthProvider | null {
    return this.providers.get(name) ?? null;
  }
}
