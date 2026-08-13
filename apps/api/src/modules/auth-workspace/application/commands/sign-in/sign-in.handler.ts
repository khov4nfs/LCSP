import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import {
  hashSecret,
  verifySecret,
} from "../../../infrastructure/security/security.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { SignInSuccess } from "../../contracts/auth-workspace/sign-in.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { SignInCommand } from "./sign-in.command.ts";

const DECOY_PASSWORD_HASH = hashSecret(
  "decoy-password-for-constant-time-compare",
);

export class SignInHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(
    command: SignInCommand,
  ): Promise<AuthProblemResult | SignInSuccess> {
    const { payload, requestMeta } = command;
    const { repositories } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();
    const validationError = this.support.validateCredentialPayload(
      payload,
      correlationId,
    );
    if (validationError) {
      return validationError;
    }

    const email = payload.email as string;
    const password = payload.password as string;
    let organizationId =
      typeof payload.organization_id === "string" &&
      payload.organization_id.trim().length > 0
        ? payload.organization_id.trim()
        : null;

    const user = await repositories.users.findByPrimaryEmail(
      email.toLowerCase(),
    );
    if (!user) {
      // Run the same scrypt-based comparison as the found-user path so the
      // response latency doesn't reveal whether the email is registered.
      verifySecret(password, DECOY_PASSWORD_HASH);
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: null,
        organization_id: organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidCredentials,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
      );
    }

    if (user.isLocked(this.support.now())) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        organization_id: organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.temporaryLock,
        correlationId: correlationId,
      });
      return createTemporaryLockProblem(user.lockUntil, correlationId);
    }

    if (!verifySecret(password, user.passwordHash)) {
      user.recordFailedLogin(
        this.support.now(),
        this.support.failedLoginLimit,
        this.support.lockWindowMs,
      );
      await repositories.users.save(user);
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        organization_id: organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: user.lockUntil
          ? AUTH_ERROR_CODES.temporaryLock
          : AUTH_ERROR_CODES.invalidCredentials,
        correlationId: correlationId,
      });
      return createProblemResult(
        user.lockUntil
          ? AUTH_ERROR_CODES.temporaryLock
          : AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
        user.lockUntil
          ? temporaryLockProblemOverrides(user.lockUntil, this.support.now())
          : undefined,
      );
    }

    user.clearFailedLogins();
    await repositories.users.save(user);

    if (!user.emailVerified) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        organization_id: organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.emailVerificationRequired,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.emailVerificationRequired,
        correlationId,
      );
    }

    if (!organizationId) {
      const activeMemberships =
        await repositories.memberships.findActiveByUserId(user.id);
      if (activeMemberships.length > 0) {
        organizationId = activeMemberships[0].organizationId;
      }
    }

    const targetOrgId = organizationId ?? "";
    const membership = await this.support.findMembership(
      repositories,
      user.id,
      targetOrgId,
    );
    if (!membership) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        organization_id: organizationId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.membershipMissing,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.membershipMissing,
        correlationId,
      );
    }

    if (!membership.isActive()) {
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        organization_id: targetOrgId,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidInviteState,
        correlationId: correlationId,
      });
      return createProblemResult(
        AUTH_ERROR_CODES.invalidInviteState,
        correlationId,
      );
    }

    const sessionState = await this.support.createSession(
      repositories,
      user,
      targetOrgId,
      correlationId,
    );
    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
      actor_id: user.id,
      organization_id: targetOrgId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    const mfaEnrollment = await this.support.findMfaEnrollment(
      repositories,
      user.id,
    );
    const organization = await this.support.resolveOrganizationById(
      repositories,
      targetOrgId,
    );
    const mfaRequired = this.support.isMfaRequired(
      user,
      organization,
      mfaEnrollment,
    );

    return {
      ok: true,
      correlationId: correlationId,
      session_token: sessionState.token,
      user: this.support.safeUserProjection(user, targetOrgId, membership),
      mfa_enrolled: this.support.isMfaEnrolled(mfaEnrollment),
      ...(mfaRequired ? { mfa_required: true } : {}),
    };
  }
}

function createTemporaryLockProblem(
  lockUntil: number | null,
  correlationId: string,
): AuthProblemResult {
  return createProblemResult(
    AUTH_ERROR_CODES.temporaryLock,
    correlationId,
    temporaryLockProblemOverrides(lockUntil, Date.now()),
  );
}

function temporaryLockProblemOverrides(lockUntil: number | null, now: number) {
  if (lockUntil === null) {
    return undefined;
  }

  return {
    meta: {
      lockedUntil: new Date(lockUntil).toISOString(),
      retryAfterSeconds: Math.max(0, Math.ceil((lockUntil - now) / 1000)),
    },
  };
}
