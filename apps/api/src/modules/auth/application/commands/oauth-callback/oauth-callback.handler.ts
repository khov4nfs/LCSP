import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.ts";
import type { OAuthCallbackClaims } from "../../../infrastructure/oauth/oauth-provider.interface.ts";
import { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import type { OAuthCallbackSuccess } from "../../contracts/auth/oauth.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_OAUTH_IDENTITY_REPOSITORY,
  AUTH_OAUTH_STATE_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type OAuthIdentityRepository,
  type OAuthStateRepository,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { OAuthCallbackCommand } from "./oauth-callback.command.ts";

@CommandHandler(OAuthCallbackCommand)
export class OAuthCallbackHandler implements ICommandHandler<OAuthCallbackCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_OAUTH_STATE_REPOSITORY)
    private readonly oauthStates: OAuthStateRepository,
    @Inject(AUTH_OAUTH_IDENTITY_REPOSITORY)
    private readonly oauthIdentities: OAuthIdentityRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
    private readonly providerRegistry: OAuthProviderRegistry,
  ) {}

  async execute(command: OAuthCallbackCommand): Promise<OAuthCallbackSuccess> {
    const { payload, requestMeta } = command;
    const { oauthStates, oauthIdentities, users, sessions, mfaEnrollments } =
      this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const code = asNonEmptyString(payload?.code);
    const stateValue = asNonEmptyString(payload?.state);
    const providerParam = asNonEmptyString(payload?.provider);

    if (!code || !stateValue || !providerParam) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    // Atomic delete-and-return: a state value can only ever be consumed once,
    // closing the replay window even under concurrent callback requests.
    const oauthState = await oauthStates.consumeByState(stateValue);

    if (
      !oauthState ||
      oauthState.isExpired(this.support.now()) ||
      oauthState.provider !== providerParam ||
      oauthState.isLinkState()
    ) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.oauthStateInvalid,
        null,
      );
      throw problemException(AUTH_ERROR_CODES.oauthStateInvalid, correlationId);
    }

    const provider = this.providerRegistry.resolve(oauthState.provider);
    if (!provider) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.unsupportedProvider,
        null,
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
      // Never leak provider-specific error detail (token exchange failure
      // reason, network error, etc.) to the caller or the audit trail.
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        null,
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
        correlationId,
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        null,
      );
      throw problemException(
        AUTH_ERROR_CODES.oauthCallbackInvalid,
        correlationId,
      );
    }

    const identity = await oauthIdentities.findByProviderAccount(
      oauthState.provider,
      claims.providerAccountId,
    );
    if (!identity) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.accountNotFound,
        null,
      );
      throw problemException(AUTH_ERROR_CODES.accountNotFound, correlationId);
    }

    const user = await users.findById(identity.userId);
    if (!user || !user.emailVerified) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.accountNotFound,
        identity.userId,
      );
      throw problemException(AUTH_ERROR_CODES.accountNotFound, correlationId);
    }

    if (user.accessStatus !== USER_ACCESS_STATUSES.active) {
      await this.recordFailure(
        correlationId,
        AUTH_ERROR_CODES.accountSuspended,
        user.id,
      );
      throw problemException(AUTH_ERROR_CODES.accountSuspended, correlationId);
    }

    const sessionState = await this.support.createSession(
      sessions,
      user,
      correlationId,
    );

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginSucceeded,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      provider: oauthState.provider,
    });

    const mfaEnrollment = await this.support.findMfaEnrollment(
      mfaEnrollments,
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
    correlationId: string,
    reasonCode: string,
    actorId: string | null,
  ): Promise<void> {
    await this.support.recordAudit({
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
