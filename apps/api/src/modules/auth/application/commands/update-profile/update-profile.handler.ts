import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  type UpdateProfileInput,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import type { UpdateProfileSuccess } from "../../contracts/auth/profile.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { UpdateProfileCommand } from "./update-profile.command.ts";

/**
 * Handles updating authenticated user profile details, email policies, and recovery email.
 *
 * Enforces:
 * 1. Requires authenticated user context and active session.
 * 2. Enforces MFA verification if MFA is required for the user.
 * 3. Validates email policy consistency (e.g. policy requiring recovery email must have recovery email provided).
 * 4. Ensures recovery email is not already taken by another account as primary or recovery email.
 * 5. Applies field updates, persists changes, and logs structured audit trail.
 */
@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
  ) {}

  /**
   * Executes profile update.
   *
   * @param command - Contains profile payload, userId, sessionId, and request metadata.
   * @returns List of updated fields and correlation ID.
   */
  async execute(command: UpdateProfileCommand): Promise<UpdateProfileSuccess> {
    const { payload, userId, sessionId, requestMeta } = command;
    const { users, sessions, mfaEnrollments } = this;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (!userId || !sessionId) {
      throw problemException(AUTH_ERROR_CODES.authRequired, correlationId);
    }

    if (!payload || !this.hasUpdateField(payload)) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    const user = await users.findById(userId);
    if (!user) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const session = await sessions.findById(sessionId);
    if (
      !session ||
      !session.isActive(this.support.now()) ||
      session.userId !== user.id
    ) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const mfaEnrollment = await this.support.findMfaEnrollment(
      mfaEnrollments,
      user.id,
    );
    if (
      this.support.isMfaRequired(user, mfaEnrollment) &&
      !session.isMfaVerified()
    ) {
      throw problemException(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const nextRecoveryEmail =
      typeof payload.recovery_email === "string"
        ? payload.recovery_email.trim().toLowerCase() || null
        : user.recoveryEmail;
    const nextPrimaryEmailPolicy =
      typeof payload.primary_email_address_policy === "string"
        ? payload.primary_email_address_policy
        : user.primaryEmailAddressPolicy;

    if (
      nextPrimaryEmailPolicy ===
        AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail &&
      !nextRecoveryEmail
    ) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    if (nextRecoveryEmail) {
      const userByEmail = await users.findByEmail(nextRecoveryEmail);
      if (userByEmail && userByEmail.id !== user.id) {
        throw problemException(
          AUTH_ERROR_CODES.validationFailed,
          correlationId,
        );
      }

      const userByRecoveryEmail =
        await users.findByRecoveryEmail(nextRecoveryEmail);
      if (userByRecoveryEmail && userByRecoveryEmail.id !== user.id) {
        throw problemException(
          AUTH_ERROR_CODES.validationFailed,
          correlationId,
        );
      }
    }

    const updatedFields: string[] = [];

    if (typeof payload.display_name === "string") {
      user.displayName = payload.display_name.trim() || null;
      updatedFields.push("display_name");
    }

    if (typeof payload.recovery_email === "string") {
      user.recoveryEmail = nextRecoveryEmail;
      updatedFields.push("recovery_email");
    }

    if (typeof payload.primary_email_address_policy === "string") {
      user.primaryEmailAddressPolicy = payload.primary_email_address_policy;
      updatedFields.push("primary_email_address_policy");
    }

    if (typeof payload.backup_recovery_email_policy === "string") {
      user.backupEmailPolicy = payload.backup_recovery_email_policy;
      updatedFields.push("backup_recovery_email_policy");
    }

    await users.save(user);

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.profileUpdated,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      updated_fields: updatedFields,
      correlationId: correlationId,
    });

    return {
      ok: true,
      correlationId: correlationId,
      updated_fields: updatedFields,
    };
  }

  private hasUpdateField(payload: UpdateProfileInput): boolean {
    return (
      typeof payload.display_name === "string" ||
      typeof payload.recovery_email === "string" ||
      typeof payload.primary_email_address_policy === "string" ||
      typeof payload.backup_recovery_email_policy === "string"
    );
  }
}
