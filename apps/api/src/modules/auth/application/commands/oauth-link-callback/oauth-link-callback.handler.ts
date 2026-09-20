import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.ts";
import type { OAuthCallbackClaims } from "../../../infrastructure/oauth/oauth-provider.interface.ts";
import { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import type { OAuthLinkCallbackSuccess } from "../../contracts/auth/oauth.contract.ts";
import {
  AUTH_OAUTH_IDENTITY_REPOSITORY,
  AUTH_OAUTH_STATE_REPOSITORY,
  type OAuthIdentityRepository,
  type OAuthStateRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { OAuthLinkCallbackCommand } from "./oauth-link-callback.command.ts";

@CommandHandler(OAuthLinkCallbackCommand)
export class OAuthLinkCallbackHandler implements ICommandHandler<OAuthLinkCallbackCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_OAUTH_STATE_REPOSITORY)
    private readonly oauthStates: OAuthStateRepository,
    @Inject(AUTH_OAUTH_IDENTITY_REPOSITORY)
    private readonly oauthIdentities: OAuthIdentityRepository,
    private readonly providerRegistry: OAuthProviderRegistry,
  ) {}

  async execute(
    command: OAuthLinkCallbackCommand,
  ): Promise<OAuthLinkCallbackSuccess> {
    const { payload, requestMeta } = command;
    const { oauthStates, oauthIdentities } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const code = asNonEmptyString(payload?.code);
    const stateValue = asNonEmptyString(payload?.state);
    const providerParam = asNonEmptyString(payload?.provider);

    if (!code || !stateValue || !providerParam) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

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
      throw problemException(AUTH_ERROR_CODES.oauthStateInvalid, correlationId);
    }

    const provider = this.providerRegistry.resolve(oauthState.provider);
    if (!provider) {
      await this.recordFailure(
        command,
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
      );
      throw problemException(
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
      throw problemException(
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
      throw problemException(
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        correlationId,
      );
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
      throw problemException(
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        correlationId,
      );
    }

    const linked = existingIdentity
      ? false
      : Boolean(
          await oauthIdentities.linkToUser(
            oauthState.provider,
            claims.providerAccountId,
            command.userId,
          ),
        );

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

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
