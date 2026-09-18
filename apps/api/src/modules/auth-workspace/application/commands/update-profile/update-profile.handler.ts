import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { EmailAddress } from "../../../domain/value-objects/email-address.value-object.ts";
import type { UpdateProfileSuccess } from "../../contracts/auth-workspace/profile.contract.ts";
import {
  AUTH_WORKSPACE_REPOSITORIES,
  type AuthWorkspaceRepositories,
} from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import {
  type UpdateProfilePayload,
  UpdateProfileCommand,
} from "./update-profile.command.ts";

const MAX_DISPLAY_NAME_LENGTH = 120;

@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand> {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    @Inject(AUTH_WORKSPACE_REPOSITORIES)
    private readonly repositories: AuthWorkspaceRepositories,
  ) {}

  async execute(command: UpdateProfileCommand): Promise<UpdateProfileSuccess> {
    const { payload, userId, sessionId, requestMeta } = command;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (!userId || !sessionId) {
      throw problemException(AUTH_ERROR_CODES.authRequired, correlationId);
    }

    if (!this.hasUpdateField(payload)) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    if (
      typeof payload.display_name === "string" &&
      payload.display_name.trim().length > MAX_DISPLAY_NAME_LENGTH
    ) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    if (typeof payload.recovery_email === "string") {
      const trimmed = payload.recovery_email.trim();
      if (trimmed.length > 0 && !EmailAddress.isValid(trimmed)) {
        throw problemException(
          AUTH_ERROR_CODES.validationFailed,
          correlationId,
        );
      }
    }

    if (
      typeof payload.backup_recovery_email_policy === "string" &&
      !Object.values(AUTH_BACKUP_EMAIL_POLICIES).includes(
        payload.backup_recovery_email_policy,
      )
    ) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    if (
      typeof payload.primary_email_address_policy === "string" &&
      !Object.values(AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES).includes(
        payload.primary_email_address_policy,
      )
    ) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    const user = await this.support.resolveUserById(this.repositories, userId);
    if (!user) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const session = await this.repositories.sessions.findById(sessionId);
    if (
      !session ||
      !session.isActive(this.support.now()) ||
      session.userId !== user.id
    ) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const mfaEnrollment = await this.support.findMfaEnrollment(
      this.repositories,
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
      const userByEmail =
        await this.repositories.users.findByEmail(nextRecoveryEmail);
      if (userByEmail && userByEmail.id !== user.id) {
        throw problemException(
          AUTH_ERROR_CODES.validationFailed,
          correlationId,
        );
      }

      const userByRecoveryEmail =
        await this.repositories.users.findByRecoveryEmail(nextRecoveryEmail);
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

    await this.repositories.users.save(user);

    await this.support.recordAudit(this.repositories, {
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

  private hasUpdateField(payload: UpdateProfilePayload): boolean {
    return (
      typeof payload.display_name === "string" ||
      typeof payload.recovery_email === "string" ||
      typeof payload.primary_email_address_policy === "string" ||
      typeof payload.backup_recovery_email_policy === "string"
    );
  }
}
