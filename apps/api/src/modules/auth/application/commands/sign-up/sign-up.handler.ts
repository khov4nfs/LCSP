import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_USER_ROLES,
  SIGN_UP_ERROR_CODES,
} from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import {
  AUTH_FAILURE_REASONS,
  authFailure,
} from "../../errors/auth-application.error.ts";
import { Session } from "../../../domain/entities/session.entity.ts";
import { User } from "../../../domain/entities/user.entity.ts";
import {
  createCorrelationId,
  fingerprintToken,
  hashSecret,
  issueOpaqueToken,
} from "../../../../../platform/security/crypto.utils.js";
import type { SignUpResponse } from "../../contracts/auth/sign-up.contract.ts";
import {
  AUTH_SIGN_UP_PERSISTENCE,
  type SignUpPersistence,
} from "../../ports/persistence/sign-up.persistence.ts";
import { AuthAuditService } from "../../services/auth/auth-audit.service.ts";
import { SignUpCommand } from "./sign-up.command.ts";

const SESSION_TTL_MS = 8 * 60 * 60_000;

/** Orchestrates sign-up; atomic persistence is owned by the infrastructure port. */
@CommandHandler(SignUpCommand)
export class SignUpHandler implements ICommandHandler<SignUpCommand> {
  constructor(
    @Inject(AUTH_SIGN_UP_PERSISTENCE)
    private readonly signUps: SignUpPersistence,
    private readonly authAudit: AuthAuditService,
  ) {}

  /**
   * Business purpose: Register an eligible customer and issue their first authenticated session.
   *
   * Business rules:
   * - One account and one initial session must share exactly the same MFA proof generation.
   * - Duplicate normalized email addresses are rejected; creation, session issuance and audit are atomic.
   * - Newly registered sessions have no MFA or sensitive-action step-up proof until verified.
   *
   * Execution flow:
   * 1. Normalize the email and reject an existing account before preparing credentials.
   * 2. Create the account and bind its initial session to the account's MFA generation.
   * 3. Persist the account, session and success audit transactionally, then return the session token.
   *
   * Failure cases:
   * - Duplicate emails return the shared EMAIL_ALREADY_EXISTS conflict problem.
   * - An invalid generation or persistence/audit failure must not commit a partial sign-up.
   *
   * Side effects:
   * - Creates a user, an unverified initial session and an audit event in one transaction.
   *
   * @param command - Registration input and request correlation context.
   * @returns The newly registered user ID, session token and expiration.
   */
  async execute(command: SignUpCommand): Promise<SignUpResponse> {
    const { email, displayName, password } = command.input;
    const correlationId = command.input.correlationId ?? createCorrelationId();
    const normalizedEmail = email.trim().toLowerCase();

    if (await this.signUps.emailExists(normalizedEmail)) {
      await this.recordFailure(
        correlationId,
        SIGN_UP_ERROR_CODES.emailAlreadyExists,
      );
      throw authFailure(SIGN_UP_ERROR_CODES.emailAlreadyExists, correlationId, {
        reason: AUTH_FAILURE_REASONS.resourceAlreadyExists,
      });
    }

    // scryptSync is deliberately performed outside the transaction/DB lock.
    const user = new User({
      email: normalizedEmail,
      displayName: displayName.trim(),
      passwordHash: hashSecret(password),
      emailVerified: true,
      role: AUTH_USER_ROLES.customer,
    });
    const sessionToken = issueOpaqueToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = new Session({
      userId: user.id,
      accessVersion: user.accessVersion,
      mfaGenerationId: user.mfaGenerationId,
      tokenHash: hashSecret(sessionToken),
      expiresAt: expiresAt.getTime(),
    });

    try {
      await this.signUps.createWithSessionAndAudit({
        user,
        session,
        tokenFingerprint: fingerprintToken(sessionToken),
        correlationId,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        await this.recordFailure(
          correlationId,
          SIGN_UP_ERROR_CODES.emailAlreadyExists,
        );
        throw authFailure(
          SIGN_UP_ERROR_CODES.emailAlreadyExists,
          correlationId,
          { reason: AUTH_FAILURE_REASONS.resourceAlreadyExists },
        );
      }
      throw error;
    }

    return {
      user_id: user.id,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      correlationId,
    };
  }

  private recordFailure(
    correlationId: string,
    reasonCode: string,
  ): Promise<void> {
    return this.authAudit.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignUpFailed,
      actorId: null,
      resourceType: AUDIT_RESOURCE_TYPES.authSession,
      resourceId: null,
      decision: AUDIT_DECISIONS.deny,
      correlationId,
      reasonCode,
      payload: {
        event_type: AUTH_AUDIT_EVENT_TYPES.authSignUpFailed,
        decision: AUDIT_DECISIONS.deny,
        reason_code: reasonCode,
        correlationId,
      },
    });
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
