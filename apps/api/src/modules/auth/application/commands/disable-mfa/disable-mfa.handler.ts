import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import type { DisableMfaSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_SECURITY_PERSISTENCE,
  type AuthSecurityPersistence,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { DisableMfaCommand } from "./disable-mfa.command.ts";

/**
 * Handles disabling multi-factor authentication (MFA) for the acting user.
 *
 * Enforces:
 * 1. Active, unexpired session belonging to the user.
 * 2. Session has verified MFA status (step-up verified).
 * 3. Deletes TOTP secret enrollment and revokes all active backup recovery codes.
 * 4. Resets user.mfaRequired to false and clears session mfaVerifiedAt.
 * 5. Emits audit trail event.
 */
@CommandHandler(DisableMfaCommand)
export class DisableMfaHandler implements ICommandHandler<DisableMfaCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SECURITY_PERSISTENCE)
    private readonly security: AuthSecurityPersistence,
  ) {}

  /**
   * Business purpose: Disable MFA without leaving usable recovery codes or elevated sessions.
   *
   * Business rules:
   * - Requires active, unexpired session belonging to user.
   * - Initiator must present current-generation verified MFA proof.
   * - Must present fresh password re-authentication proof (sensitive-action step-up).
   * - Deletes TOTP enrollment, revokes recovery codes, clears session MFA proofs and resets mfaRequired.
   *
   * Execution flow:
   * 1. Validate session and user IDs.
   * 2. Execute atomic disable operation in security persistence with User lock.
   * 3. Return success correlation.
   *
   * Failure cases:
   * - Invalid session, unverified MFA, or expired password re-auth rejects disable.
   *
   * Side effects:
   * - Clears credentials and active proofs, records security audit event.
   */
  async execute(command: DisableMfaCommand): Promise<DisableMfaSuccess> {
    const { userId, sessionId, requestMeta } = command;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (!userId || !sessionId) {
      throw authFailure(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const result = await this.security.disableMfa({
      userId,
      sessionId,
      now: this.support.now(),
      correlationId,
    });
    if (!result.ok) {
      throw authFailure(result.code, correlationId);
    }

    return { ok: true, correlationId: correlationId };
  }
}
