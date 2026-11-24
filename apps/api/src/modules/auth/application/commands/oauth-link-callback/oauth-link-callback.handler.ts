import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import type { OAuthCallbackClaims } from "../../ports/oauth/oauth-provider.port.ts";
import {
  AUTH_OAUTH_PROVIDER_RESOLVER,
  type OAuthProviderResolver,
} from "../../ports/oauth/oauth-provider.port.ts";
import type { OAuthLinkCallbackSuccess } from "../../contracts/auth/oauth.contract.ts";
import {
  AUTH_OAUTH_IDENTITY_REPOSITORY,
  AUTH_OAUTH_STATE_REPOSITORY,
  type OAuthIdentityRepository,
  type OAuthStateRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { OAuthLinkCallbackCommand } from "./oauth-link-callback.command.ts";

/**
 * Handles completing an OAuth linking flow to attach a third-party identity to the user's account.
 *
 * Enforces:
 * 1. Single-use atomic consumption of OAuth linking state.
 * 2. Validates state ownership (must match authenticated user and session ID).
 * 3. Exchanges code for claims and verifies token validity.
 * 4. Ensures external account is not already linked to a different local account.
 * 5. Links third-party provider identity and records audit trail.
 */
@CommandHandler(OAuthLinkCallbackCommand)
export class OAuthLinkCallbackHandler implements ICommandHandler<OAuthLinkCallbackCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_OAUTH_STATE_REPOSITORY)
    private readonly oauthStates: OAuthStateRepository,
    @Inject(AUTH_OAUTH_IDENTITY_REPOSITORY)
    private readonly oauthIdentities: OAuthIdentityRepository,
    @Inject(AUTH_OAUTH_PROVIDER_RESOLVER)
    private readonly providerRegistry: OAuthProviderResolver,
  ) {}

  /**
   * Business purpose: Complete the OAuth account linking flow and attach a verified third-party identity to the user's account.
   *
   * Business rules:
   * - Requires atomic single-use consumption of an unexpired OAuth state bound to the caller's userId and sessionId.
   * - Validates OAuth claims from the provider registry.
   * - Rejects linking if the third-party account is already owned by a different user.
   * - Prevents race conditions by verifying ownership of the returned identity post-persistence.
   * - Idempotent for repeated linking of the same provider account to the same user (returns linked: false).
   *
   * Execution flow:
   * 1. Atomically consume and validate the OAuth state matching state, provider, userId, and sessionId.
   * 2. Exchange authorization code for validated claims via the provider adapter.
   * 3. Verify pre-existing identity ownership in persistence.
   * 4. Persist identity link and verify returned identity ownership.
   * 5. Record audit event and return linking outcome.
   *
   * Failure cases:
   * - Invalid, expired, or mismatched OAuth state throws oauthStateInvalid.
   * - Unsupported provider throws unsupportedProvider.
   * - Invalid claims or external identity owned by another user throws oauthCallbackInvalid.
   *
   * Side effects:
   * - Consumes OAuth state record.
   * - Creates OAuth identity record if not previously linked.
   * - Writes audit log entry.
   */
  async execute(
    command: OAuthLinkCallbackCommand,
  ): Promise<OAuthLinkCallbackSuccess> {
    const { payload, requestMeta } = command;
    const { oauthStates, oauthIdentities } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const code = payload.code;
    const stateValue = payload.state;
    const providerParam = payload.provider;

    const oauthState = await oauthStates.consumeByState(stateValue);

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
      throw authFailure(AUTH_ERROR_CODES.oauthStateInvalid, correlationId);
    }

    const provider = this.providerRegistry.resolve(oauthState.provider);
    if (!provider) {
      await this.recordFailure(
        command,
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
      );
      throw authFailure(AUTH_ERROR_CODES.unsupportedProvider, correlationId);
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
      throw authFailure(AUTH_ERROR_CODES.oauthCallbackInvalid, correlationId);
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
      throw authFailure(AUTH_ERROR_CODES.oauthCallbackInvalid, correlationId);
    }

    const existingIdentity = await oauthIdentities.findByProviderAccount(
      oauthState.provider,
      claims.providerAccountId,
    );

    if (existingIdentity && existingIdentity.userId !== command.userId) {
      await this.recordFailure(
        command,
        correlationId,
        AUTH_ERROR_CODES.oauthCallbackInvalid,
      );
      throw authFailure(AUTH_ERROR_CODES.oauthCallbackInvalid, correlationId);
    }

    // Rationale: Prevent concurrent linking race conditions from associating a third-party account with multiple users.
    // Mechanism: Check pre-existing identity ownership, persist via upsert, and strictly verify post-persistence ownership of the returned record.
    // Invariant: An OAuth identity must never belong to more than one user, and existing links to the current user must remain idempotent without re-attributing ownership.
    let linked = false;
    if (existingIdentity) {
      linked = false;
    } else {
      const persistedIdentity = await oauthIdentities.linkToUser(
        oauthState.provider,
        claims.providerAccountId,
        command.userId,
      );

      if (persistedIdentity.userId !== command.userId) {
        await this.recordFailure(
          command,
          correlationId,
          AUTH_ERROR_CODES.oauthCallbackInvalid,
        );
        throw authFailure(AUTH_ERROR_CODES.oauthCallbackInvalid, correlationId);
      }

      linked = true;
    }

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkSucceeded,
      actor_id: command.userId,
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
    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkFailed,
      actor_id: command.userId,
      decision: AUDIT_DECISIONS.deny,
      reason_code: reasonCode,
      correlationId: correlationId,
    });
  }
}
