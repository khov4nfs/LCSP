import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { OAuthState } from "../../../domain/models/auth.models.ts";
import { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import { issueOAuthStateToken } from "../../../infrastructure/security/security.utils.ts";
import type { OAuthStartSuccess } from "../../contracts/auth/oauth.contract.ts";
import {
  AUTH_OAUTH_STATE_REPOSITORY,
  type OAuthStateRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { OAuthStartCommand } from "./oauth-start.command.ts";

const OAUTH_STATE_TTL_MS = 10 * 60_000;

/**
 * Handles initiating an OAuth 2.0 / OIDC authentication flow.
 *
 * Enforces:
 * 1. Validates that requested provider is supported and configured in the provider registry.
 * 2. Whitelist-checks the `redirect_uri` origin against configured allowed redirect origins.
 * 3. Issues cryptographically secure state and nonce tokens with a 10-minute TTL.
 * 4. Persists ephemeral OAuthState in repository.
 * 5. Builds provider-specific authorization URL and records start audit event.
 */
@CommandHandler(OAuthStartCommand)
export class OAuthStartHandler implements ICommandHandler<OAuthStartCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_OAUTH_STATE_REPOSITORY)
    private readonly oauthStates: OAuthStateRepository,
    private readonly providerRegistry: OAuthProviderRegistry,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Executes OAuth initiation.
   *
   * @param command - Contains OAuth payload (provider, redirect_uri) and request metadata.
   * @returns Authorization redirect URL and correlation ID.
   */
  async execute(command: OAuthStartCommand): Promise<OAuthStartSuccess> {
    const { payload, requestMeta } = command;
    const { oauthStates } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const providerName = payload.provider;
    const redirectUri = payload.redirect_uri;

    const provider = this.providerRegistry.resolve(providerName);
    if (!provider) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
      );
      throw problemException(
        AUTH_ERROR_CODES.unsupportedProvider,
        correlationId,
      );
    }

    const allowedRedirectOrigins = this.configService.get<string[]>(
      "oauth.allowedRedirectOrigins",
      [],
    );
    if (!isAllowedRedirectOrigin(redirectUri, allowedRedirectOrigins)) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.invalidRedirectUri,
      );
      throw problemException(
        AUTH_ERROR_CODES.invalidRedirectUri,
        correlationId,
      );
    }

    const state = issueOAuthStateToken();
    const nonce = issueOAuthStateToken();
    const oauthState = new OAuthState({
      state,
      nonce,
      provider: providerName,
      redirectUri,
      expiresAt: this.support.now() + OAUTH_STATE_TTL_MS,
    });
    await oauthStates.save(oauthState);

    const authorizationUrl = provider.buildAuthorizationUrl({
      state,
      nonce,
      redirectUri,
    });

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartSucceeded,
      actor_id: null,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      provider: providerName,
    });

    return {
      ok: true,
      correlationId: correlationId,
      authorization_url: authorizationUrl,
    };
  }

  private async recordFailure(
    correlationId: string,
    reasonCode: string,
  ): Promise<void> {
    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed,
      actor_id: null,
      decision: AUDIT_DECISIONS.deny,
      reason_code: reasonCode,
      correlationId: correlationId,
    });
  }
}

function isAllowedRedirectOrigin(
  redirectUri: string,
  allowedOrigins: string[],
): boolean {
  try {
    return allowedOrigins.includes(new URL(redirectUri).origin);
  } catch {
    return false;
  }
}
