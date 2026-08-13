import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import type { OAuthCallbackClaims } from "../../../infrastructure/oauth/oauth-provider.interface.ts";
import type { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { OAuthLinkCallbackSuccess } from "../../contracts/auth-workspace/oauth.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { OAuthLinkCallbackCommand } from "./oauth-link-callback.command.ts";

export class OAuthLinkCallbackHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
    private readonly providerRegistry: OAuthProviderRegistry,
  ) {}

  async execute(
    command: OAuthLinkCallbackCommand,
  ): Promise<AuthProblemResult | OAuthLinkCallbackSuccess> {
    const { payload, requestMeta } = command;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const code = asNonEmptyString(payload?.code);
    const stateValue = asNonEmptyString(payload?.state);
    const providerParam = asNonEmptyString(payload?.provider);

    if (!code || !stateValue || !providerParam) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    const oauthState =
      await this.repositories.oauthStates.consumeByState(stateValue);

    if (
      !oauthState ||
      oauthState.isExpired(this.support.now()) ||
      oauthState.provider !== providerParam ||
      oauthState.userId !== command.userId ||
      oauthState.sessionId !== command.sessionId
    ) {
      await this.recordFailure(
        command,
        correlationId,
        AUTH_ERROR_CODES.oauthStateInvalid,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.oauthStateInvalid,
        correlationId,
      );
    }

    const provider = this.providerRegistry.resolve(oauthState.provider);
    if (!provider) {
      await this.recordFailure(
        command,
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.unsupportedProvider,
        correlationId,
      );
    }

    let claims: OAuthCallbackClaims;
    try {
      claims = await provider.handleCallback({
        code,
        redirectUri: oauthState.redirectUri,
        expectedNonce: oauthState.nonce,
      });
    } catch {
      await this.recordFailure(
        command,
        correlationId,
        AUTH_ERROR_CODES.oauthCallbackInvalid,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        correlationId,
      );
    }

    const claimsValid =
      Boolean(claims.providerAccountId) &&
      (provider.expectedIssuer === null ||
        claims.issuer === provider.expectedIssuer) &&
      (provider.expectedAudience === null ||
        claims.audience === provider.expectedAudience) &&
      (claims.nonce === null || claims.nonce === oauthState.nonce) &&
      (claims.expiresAt === null || claims.expiresAt >= this.support.now());

    if (!claimsValid) {
      await this.recordFailure(
        command,
        correlationId,
        AUTH_ERROR_CODES.oauthCallbackInvalid,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        correlationId,
      );
    }

    const existingIdentity =
      await this.repositories.oauthIdentities.findByProviderAccount(
        oauthState.provider,
        claims.providerAccountId,
      );

    if (existingIdentity && existingIdentity.userId !== command.userId) {
      await this.recordFailure(
        command,
        correlationId,
        AUTH_ERROR_CODES.oauthCallbackInvalid,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        correlationId,
      );
    }

    const linked = existingIdentity
      ? false
      : Boolean(
          await this.repositories.oauthIdentities.linkToUser(
            oauthState.provider,
            claims.providerAccountId,
            command.userId,
          ),
        );

    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkSucceeded,
      actor_id: command.userId,
      organization_id: command.organizationId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      provider: oauthState.provider,
      linked,
    });

    return {
      ok: true,
      correlationId: correlationId,
      provider: oauthState.provider,
      linked,
    };
  }

  private async recordFailure(
    command: OAuthLinkCallbackCommand,
    correlationId: string,
    reasonCode: string,
  ): Promise<void> {
    await this.support.recordAudit(this.repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkFailed,
      actor_id: command.userId,
      organization_id: command.organizationId,
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
