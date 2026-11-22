import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { RecoveryRequest } from "../../../domain/models/auth.models.ts";
import {
  fingerprintToken,
  hashSecret,
  issueOpaqueToken,
} from "../../../../../platform/security/crypto.utils.js";
import type { RequestRecoverySuccess } from "../../contracts/auth/recovery.contract.ts";
import {
  AUTH_RECOVERY_NOTIFIER,
  type RecoveryNotifier,
} from "../../ports/notification/recovery-notifier.ts";
import {
  AUTH_RECOVERY_REQUEST_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type RecoveryRequestRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { RequestPasswordRecoveryCommand } from "./request-password-recovery.command.ts";

const RECOVERY_TOKEN_TTL_MS = 30 * 60_000;

/**
 * Handles requesting a password reset email token.
 *
 * Enforces:
 * 1. Constant-time hashing execution on missing user to prevent email enumeration timing side-channels.
 * 2. Issues cryptographically secure opaque recovery token with 30-minute TTL.
 * 3. Saves recovery request indexed by token fingerprint and hashed secret.
 * 4. Resolves destination email based on user backup email policy.
 * 5. Dispatches recovery email via notification adapter.
 * 6. Emits audit trail for recovery request.
 */
@CommandHandler(RequestPasswordRecoveryCommand)
export class RequestPasswordRecoveryHandler implements ICommandHandler<RequestPasswordRecoveryCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_RECOVERY_REQUEST_REPOSITORY)
    private readonly recoveryRequests: RecoveryRequestRepository,
    @Inject(AUTH_RECOVERY_NOTIFIER)
    private readonly notifier: RecoveryNotifier,
  ) {}

  /**
   * Business purpose: Initiate account password recovery by generating an opaque single-use token and dispatching notification.
   * Business rules:
   * - Target user account must exist and have an active access status.
   * - Missing or suspended accounts trigger constant-time decoy hashing to prevent account enumeration.
   * - Recovery tokens are time-bounded by RECOVERY_TOKEN_TTL_MS and hashed before persistence.
   * Execution flow:
   * 1. Normalize recipient email and lookup user by primary email.
   * 2. If user is absent or suspended, perform constant-time decoy hash and return generic success.
   * 3. Generate secure random opaque token and compute its hash asynchronously.
   * 4. Persist recovery request with token fingerprint and expiration timestamp.
   * 5. Dispatch recovery notification containing raw token to verified destination.
   * 6. Record audit event and return correlation metadata.
   * Failure cases:
   * - None exposed to client (generic success returned on missing accounts to prevent enumeration).
   * Side effects:
   * - Saves new recovery request to database, emits email notification, and records audit log.
   *
   * @param command - Contains target email and request correlation metadata.
   * @returns Success response with correlation ID.
   */
  async execute(
    command: RequestPasswordRecoveryCommand,
  ): Promise<RequestRecoverySuccess> {
    const { payload, requestMeta } = command;
    const { users, recoveryRequests } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const email = payload.email.trim().toLowerCase();
    const user = await users.findByPrimaryEmail(email);

    if (!user || user.accessStatus !== USER_ACCESS_STATUSES.active) {
      // Rationale (Why): Asynchronous scrypt prevents blocking event loop while masking account existence.
      // Mechanism (How): Await non-blocking hashSecret.
      // Invariants (What): Response latency remains consistent with found-user paths.
      await hashSecret("decoy-recovery-lookup-for-constant-time-compare");
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryRequested,
        actor_id: user?.id ?? null,
        decision: AUDIT_DECISIONS.allow,
        correlationId: correlationId,
      });
      return { ok: true, correlationId: correlationId };
    }

    const now = this.support.now();
    const token = issueOpaqueToken();
    const recoveryRequest = new RecoveryRequest({
      userId: user.id,
      tokenHash: await hashSecret(token),
      expiresAt: now + RECOVERY_TOKEN_TTL_MS,
    });
    await recoveryRequests.save(recoveryRequest, fingerprintToken(token));

    await this.notifier.notify({
      userId: user.id,
      email: this.resolveRecoveryDestination(user),
      token,
      correlationId,
      appOrigin: requestMeta.app_origin,
    });

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryRequested,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    return { ok: true, correlationId: correlationId };
  }

  private resolveRecoveryDestination(user: {
    recoveryEmail: string | null;
    email: { toString(): string };
    backupEmailPolicy: string;
  }) {
    if (
      user.backupEmailPolicy === AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail &&
      user.recoveryEmail
    ) {
      return user.recoveryEmail;
    }

    return user.email.toString();
  }
}
