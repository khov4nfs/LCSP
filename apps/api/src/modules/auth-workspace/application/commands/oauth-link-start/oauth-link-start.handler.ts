import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";
import type { ConfigService } from "@nestjs/config";

import { OAuthState } from "../../../domain/models/auth-workspace.models.ts";
import type { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import { issueOAuthStateToken } from "../../../infrastructure/security/security.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { OAuthLinkStartSuccess } from "../../contracts/auth-workspace/oauth.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { OAuthLinkStartCommand } from "./oauth-link-start.command.ts";

const OAUTH_STATE_TTL_MS = 10 * 60_000;

export class OAuthLinkStartHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
    private readonly providerRegistry: OAuthProviderRegistry,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    command: OAuthLinkStartCommand,
  ): Promise<AuthProblemResult | OAuthLinkStartSuccess> {
    const { payload, requestMeta } = command;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const providerName = asNonEmptyString(payload?.provider);
    const redirectUri = asNonEmptyString(payload?.redirect_uri);

    if (!providerName || !redirectUri) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    const provider = this.providerRegistry.resolve(providerName);
    if (!provider) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
        command.userId,
      );
      return createProblemResult(
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
      return createProblemResult(
        AUTH_ERROR_CODES.invalidRedirectUri,
        correlationId,
      );
    }

    const state = issueOAuthStateToken();
    const nonce = issueOAuthStateToken();
    await this.repositories.oauthStates.save(
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

    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartSucceeded,
      actor_id: command.userId,
      organization_id: null,
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
    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed,
      actor_id: actorId,
      organization_id: null,
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
