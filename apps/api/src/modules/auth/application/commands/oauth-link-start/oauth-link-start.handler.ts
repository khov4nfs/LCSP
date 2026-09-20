import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.ts";
import { OAuthState } from "../../../domain/models/auth.models.ts";
import { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import { issueOAuthStateToken } from "../../../infrastructure/security/security.utils.ts";
import type { OAuthLinkStartSuccess } from "../../contracts/auth/oauth.contract.ts";
import {
  AUTH_OAUTH_STATE_REPOSITORY,
  type OAuthStateRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { OAuthLinkStartCommand } from "./oauth-link-start.command.ts";

const OAUTH_STATE_TTL_MS = 10 * 60_000;

@CommandHandler(OAuthLinkStartCommand)
export class OAuthLinkStartHandler implements ICommandHandler<OAuthLinkStartCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_OAUTH_STATE_REPOSITORY)
    private readonly oauthStates: OAuthStateRepository,
    private readonly providerRegistry: OAuthProviderRegistry,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    command: OAuthLinkStartCommand,
  ): Promise<OAuthLinkStartSuccess> {
    const { payload, requestMeta } = command;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const providerName = asNonEmptyString(payload?.provider);
    const redirectUri = asNonEmptyString(payload?.redirect_uri);

    if (!providerName || !redirectUri) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    const provider = this.providerRegistry.resolve(providerName);
    if (!provider) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
        command.userId,
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
        command.userId,
      );
      throw problemException(
        AUTH_ERROR_CODES.invalidRedirectUri,
        correlationId,
      );
    }

    const state = issueOAuthStateToken();
    const nonce = issueOAuthStateToken();
    await this.oauthStates.save(
      new OAuthState({
        state,
        nonce,
        provider: providerName,
        redirectUri,
        expiresAt: this.support.now() + OAUTH_STATE_TTL_MS,
        userId: command.userId,
        sessionId: command.sessionId,
      }),
    );

    const authorizationUrl = provider.buildAuthorizationUrl({
      state,
      nonce,
      redirectUri,
    });

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartSucceeded,
      actor_id: command.userId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      provider: providerName,
      flow: "link",
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
    actorId: string,
  ): Promise<void> {
    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed,
      actor_id: actorId,
      decision: AUDIT_DECISIONS.deny,
      reason_code: reasonCode,
      correlationId: correlationId,
      flow: "link",
    });
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
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
