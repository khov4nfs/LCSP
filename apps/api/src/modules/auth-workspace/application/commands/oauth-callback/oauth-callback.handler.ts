import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import type { OAuthCallbackClaims } from "../../../infrastructure/oauth/oauth-provider.interface.ts";
import type { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { OAuthCallbackSuccess } from "../../contracts/auth-workspace/oauth.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { OAuthCallbackCommand } from "./oauth-callback.command.ts";

export class OAuthCallbackHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
    private readonly providerRegistry: OAuthProviderRegistry,
  ) {}

  async execute(
    command: OAuthCallbackCommand,
  ): Promise<AuthProblemResult | OAuthCallbackSuccess> {
    const { payload, requestMeta } = command;
    const { repositories } = this;
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

    // Atomic delete-and-return: a state value can only ever be consumed once,
    // closing the replay window even under concurrent callback requests.
    const oauthState =
      await repositories.oauthStates.consumeByState(stateValue);

    if (
      !oauthState ||
      oauthState.isExpired(this.support.now()) ||
      oauthState.provider !== providerParam ||
      oauthState.isLinkState()
    ) {
      await this.recordFailure(
        repositories,
        correlationId,
        AUTH_ERROR_CODES.oauthStateInvalid,
        null,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.oauthStateInvalid,
        correlationId,
      );
    }

    const provider = this.providerRegistry.resolve(oauthState.provider);
    if (!provider) {
      await this.recordFailure(
        repositories,
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
        null,
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
      // Never leak provider-specific error detail (token exchange failure
      // reason, network error, etc.) to the caller or the audit trail.
      await this.recordFailure(
        repositories,
        correlationId,
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        null,
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
        repositories,
        correlationId,
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        null,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        correlationId,
      );
    }

    const identity = await repositories.oauthIdentities.findByProviderAccount(
      oauthState.provider,
      claims.providerAccountId,
    );
    if (!identity) {
      await this.recordFailure(
        repositories,
        correlationId,
        AUTH_ERROR_CODES.accountNotFound,
        null,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.accountNotFound,
        correlationId,
      );
    }

    const user = await repositories.users.findById(identity.userId);
    if (!user || !user.emailVerified) {
      await this.recordFailure(
        repositories,
        correlationId,
        AUTH_ERROR_CODES.accountNotFound,
        identity.userId,
      );
      return createProblemResult(
        AUTH_ERROR_CODES.accountNotFound,
        correlationId,
      );
    }

    const sessionState = await this.support.createSession(
      repositories,
      user,
      correlationId,
    );

    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginSucceeded,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      provider: oauthState.provider,
    });

    const mfaEnrollment = await this.support.findMfaEnrollment(
      repositories,
      user.id,
    );
    const mfaRequired = this.support.isMfaRequired(user, mfaEnrollment);

    return {
      ok: true,
      correlationId: correlationId,
      session_token: sessionState.token,
      expires_at: sessionState.session.expiresAt,
      mfa_required: mfaRequired,
      mfa_enrolled: this.support.isMfaEnrolled(mfaEnrollment),
    };
  }

  private async recordFailure(
    repositories: AuthWorkspaceRepositories,
    correlationId: string,
    reasonCode: string,
    actorId: string | null,
  ): Promise<void> {
    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      actor_id: actorId,
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
