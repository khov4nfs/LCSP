import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
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
   * Executes MFA disabling.
   *
   * @param command - Contains userId, sessionId, and request correlation metadata.
   * @returns Success response with correlation ID.
   */
  async execute(command: DisableMfaCommand): Promise<DisableMfaSuccess> {
    const { userId, sessionId, requestMeta } = command;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (!userId || !sessionId) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const result = await this.security.disableMfa({
      userId,
      sessionId,
      now: this.support.now(),
      correlationId,
    });
    if (!result.ok) {
      throw problemException(result.code, correlationId);
    }

    return { ok: true, correlationId: correlationId };
  }
}
