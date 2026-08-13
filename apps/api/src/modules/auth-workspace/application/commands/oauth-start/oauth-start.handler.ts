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
import type { OAuthStartSuccess } from "../../contracts/auth-workspace/oauth.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { OAuthStartCommand } from "./oauth-start.command.ts";

const OAUTH_STATE_TTL_MS = 10 * 60_000;

export class OAuthStartHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
    private readonly providerRegistry: OAuthProviderRegistry,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    command: OAuthStartCommand,
  ): Promise<AuthProblemResult | OAuthStartSuccess> {
    const { payload, requestMeta } = command;
    const { repositories } = this;
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
        repositories,
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
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
        repositories,
        correlationId,
        AUTH_ERROR_CODES.invalidRedirectUri,
      );
      return createProblemResult(
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
    await repositories.oauthStates.save(oauthState);

    const authorizationUrl = provider.buildAuthorizationUrl({
      state,
      nonce,
      redirectUri,
    });

    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartSucceeded,
      actor_id: null,
      organization_id: null,
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
    repositories: AuthWorkspaceRepositories,
    correlationId: string,
    reasonCode: string,
  ): Promise<void> {
    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed,
      actor_id: null,
      organization_id: null,
      decision: AUDIT_DECISIONS.deny,
      reason_code: reasonCode,
      correlationId: correlationId,
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
